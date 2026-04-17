/*
 * POST /api/jobs/[id]/suggest-risks
 *
 * Staff-only: brainstorm risk themes tied to approved presenting biohazards, with
 * presentation context for plausibility. Persists suggested_risks_ai + source_hazard_ids.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { presentingHealthHazardsFromAssessment } from '@/lib/documentGenerationDrivers'
import { buildPresentationContext, hasPresentationGrounding } from '@/lib/jobPresentationContext'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import type { AssessmentData, JobType, SuggestedRiskAiItem, SuggestedRiskCategory } from '@/lib/types'

const CATEGORIES: SuggestedRiskCategory[] = [
  'biological',
  'chemical',
  'physical',
  'environmental',
  'operational',
]

function slugId(label: string, i: number) {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `risk_${i}`
}

function normalizeItem(
  raw: { id?: string; label?: string; category?: string; source_hazard_ids?: unknown },
  i: number,
  approvedIds: Set<string>
): SuggestedRiskAiItem | null {
  const label = (raw.label ?? '').trim()
  if (!label || label.length > 120) return null
  const cat = (raw.category ?? '').toLowerCase() as SuggestedRiskCategory
  const category = CATEGORIES.includes(cat) ? cat : 'operational'
  const id = (raw.id ?? '').trim() || slugId(label, i)
  let source_hazard_ids: string[] | undefined
  if (Array.isArray(raw.source_hazard_ids)) {
    source_hazard_ids = raw.source_hazard_ids.filter(
      (x): x is string => typeof x === 'string' && approvedIds.has(x)
    )
  }
  if (!source_hazard_ids?.length) return null
  return { id: id.slice(0, 64), label: label.slice(0, 120), category, source_hazard_ids }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      )
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local (see .env.local.example), then restart the dev server.',
        },
        { status: 503 }
      )
    }
    const client = new Anthropic({ apiKey })

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const [jobRes, photosRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_type, site_address, urgency, notes, assessment_data')
        .eq('id', jobId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase.from('photos').select('area_ref, category, caption').eq('job_id', jobId),
    ])

    if (!jobRes.data) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobRes.data as {
      id: string
      job_type: JobType
      site_address: string
      urgency: string | null
      notes: string | null
      assessment_data: AssessmentData | null
    }
    const ad = job.assessment_data

    const presentationContext = buildPresentationContext({
      job_type: job.job_type,
      site_address: job.site_address,
      urgency: job.urgency,
      notes: job.notes,
      assessment_data: ad,
      photos: (photosRes.data ?? []).map(p => ({
        area_ref: (p.area_ref || '').trim() || null,
        category: p.category,
        caption: (p.caption || '').trim() || null,
      })),
    })

    const approvedHazards = presentingHealthHazardsFromAssessment(ad)
    if (approvedHazards.length === 0) {
      return NextResponse.json(
        {
          error:
            'Promote at least one approved hazard on Assessment → Health Hazards (Presenting) before generating risks.',
        },
        { status: 400 }
      )
    }

    if (
      !hasPresentationGrounding({
        biohazard_type: presentationContext.biohazard_type,
        observations: presentationContext.observations,
        access_restrictions: presentationContext.access_restrictions,
        areas: presentationContext.areas.map(a => ({ name: a.name, description: a.description })),
        photos: presentationContext.photos.map(p => ({ area_ref: p.area_ref, caption: p.caption })),
        special_risks: presentationContext.special_risks,
        ppe_required: presentationContext.ppe_required,
      })
    ) {
      return NextResponse.json(
        {
          error:
            'Not enough on Presentation to ground suggested risks. Add observations, areas, biohazard type, photo captions, or checklist flags first.',
        },
        { status: 400 }
      )
    }

    const approvedIds = new Set(approvedHazards.map(h => h.id))
    const userBlock = JSON.stringify(
      {
        approved_hazards: approvedHazards.map(h => ({ id: h.id, label: h.label, category: h.category })),
        presentation_context: presentationContext,
      },
      null,
      2
    )

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You assist biohazard remediation technicians in Australia.

You receive APPROVED_HAZARDS (human-promoted chips) and PRESENTATION_CONTEXT (assessment + photo metadata).

Brainstorm DISTINCT additional risk themes (2–7 words each) so the team considers a wide range of plausible outcomes — still within reason for biohazard remediation.

RULES:
- Every item MUST include "source_hazard_ids": one or more ids copied EXACTLY from approved_hazards. Tie each risk theme to at least one approved hazard.
- Use presentation_context to stay plausible — do not assert specific site incidents not supported by the JSON, but you MAY propose reasonable secondary/operational risks that commonly pair with the approved hazards for this type of work.
- Do NOT output risk themes that cannot be linked to an approved hazard id.
- Categories: biological, chemical, physical, environmental, operational (same meanings as standard SWMS-style groupings).
- Maximum 18 suggestions. No duplicate labels. Optional "id" snake_case.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"label":"...","category":"biological","source_hazard_ids":["id1"],"id":"optional_slug"}]}`,
      messages: [
        {
          role: 'user',
          content: `Brainstorm risk themes from approved hazards, grounded in presentation context:\n\n${userBlock}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    }

    let parsed: { suggestions?: unknown }
    try {
      parsed = JSON.parse(jsonMatch[0]) as { suggestions?: unknown }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
    }

    const list = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    const items: SuggestedRiskAiItem[] = []
    const seen = new Set<string>()
    for (let i = 0; i < list.length && items.length < 18; i++) {
      const n = normalizeItem(
        list[i] as { id?: string; label?: string; category?: string; source_hazard_ids?: unknown },
        i,
        approvedIds
      )
      if (!n) continue
      const key = n.label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push(n)
    }

    const suggested_risks_ai = {
      items,
      generated_at: new Date().toISOString(),
    }

    const itemIdSet = new Set([
      ...items.map(i => i.id),
      ...(ad?.identified_risks_ai?.items ?? []).map(i => i.id),
      ...(ad?.manual_risk_chips ?? []).map(i => i.id),
    ])
    const presenting_risk_ids = (ad?.presenting_risk_ids ?? []).filter(id => itemIdSet.has(id))

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_risks_ai,
      presenting_risk_ids,
    }

    const { data: updated, error } = await supabase
      .from('jobs')
      .update({
        assessment_data: nextAssessment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ job: updated, suggested_risks_ai })
  } catch (e: unknown) {
    console.error('[suggest-risks]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest risks failed' },
      { status: 500 }
    )
  }
}
