/*
 * POST /api/jobs/[id]/identify-risks
 *
 * Staff-only: risks are derived only from human-approved presenting hazards, with
 * plausibility grounded in Presentation JSON. Persists identified_risks_ai + source_hazard_ids.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { presentingBiohazardsFromAssessment } from '@/lib/documentGenerationDrivers'
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
    .slice(0, 40)
  return s || `irk_${i}`
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
  const base = (raw.id ?? '').trim() || slugId(label, i)
  const id = `ident_${base.replace(/^ident_/, '').slice(0, 56)}`
  let source_hazard_ids: string[] | undefined
  if (Array.isArray(raw.source_hazard_ids)) {
    source_hazard_ids = raw.source_hazard_ids.filter(
      (x): x is string => typeof x === 'string' && approvedIds.has(x)
    )
  }
  if (!source_hazard_ids?.length) return null
  return { id, label: label.slice(0, 120), category, source_hazard_ids }
}

function presentationPayload(ad: AssessmentData | null, photos: { area_ref: string | null; category: string; caption: string | null }[]) {
  return {
    job_type: null as JobType | null,
    site_address: null as string | null,
    areas: (ad?.areas ?? []).map(a => ({
      name: (a.name || '').trim(),
      description: (a.description || '').trim(),
      hazard_level: a.hazard_level ?? 1,
    })),
    contamination_level: ad?.contamination_level ?? null,
    biohazard_type: (ad?.biohazard_type || '').trim() || null,
    observations: (ad?.observations || '').trim() || null,
    access_restrictions: (ad?.access_restrictions || '').trim() || null,
    special_risks: ad?.special_risks ?? null,
    ppe_required: ad?.ppe_required ?? null,
    photos: photos.map(p => ({
      area_ref: (p.area_ref || '').trim() || null,
      category: p.category,
      caption: (p.caption || '').trim() || null,
    })),
  }
}

function hasIdentifiableContent(payload: ReturnType<typeof presentationPayload>): boolean {
  const t = [
    payload.biohazard_type,
    payload.observations,
    payload.access_restrictions,
    ...payload.areas.flatMap(a => [a.name, a.description]),
    ...payload.photos.flatMap(p => [p.caption, p.area_ref].filter(Boolean) as string[]),
  ]
    .join(' ')
    .trim()
  if (t.length >= 8) return true
  const sr = payload.special_risks
  if (sr && Object.values(sr).some(Boolean)) return true
  const ppe = payload.ppe_required
  if (ppe && Object.values(ppe).some(Boolean)) return true
  return false
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
      supabase.from('jobs').select('id, job_type, site_address, assessment_data').eq('id', jobId).eq('org_id', orgId).maybeSingle(),
      supabase.from('photos').select('area_ref, category, caption').eq('job_id', jobId),
    ])

    if (!jobRes.data) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobRes.data as { id: string; job_type: JobType; site_address: string; assessment_data: AssessmentData | null }
    const ad = job.assessment_data

    const payload = presentationPayload(ad, photosRes.data ?? [])
    payload.job_type = job.job_type
    payload.site_address = job.site_address

    const approvedHazards = presentingBiohazardsFromAssessment(ad)
    if (approvedHazards.length === 0) {
      return NextResponse.json(
        {
          error:
            'Promote at least one approved hazard on Assessment → Hazards (Presenting) before identifying risks.',
        },
        { status: 400 }
      )
    }

    if (!hasIdentifiableContent(payload)) {
      return NextResponse.json(
        {
          error:
            'Not enough on Presentation to ground risks. Add observations, areas, biohazard type, photo captions, or checklist flags first.',
        },
        { status: 400 }
      )
    }

    const approvedIds = new Set(approvedHazards.map(h => h.id))
    const userBlock = JSON.stringify(
      {
        approved_hazards: approvedHazards.map(h => ({ id: h.id, label: h.label, category: h.category })),
        presentation_context: payload,
      },
      null,
      2
    )

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You assist biohazard remediation technicians in Australia.

You receive (1) APPROVED_HAZARDS: human-promoted hazard chips from Assessment → Hazards — these are the ONLY hazard sources you may tie risks to.
You receive (2) PRESENTATION_CONTEXT: Assessment Presentation JSON — use this ONLY to judge whether each risk theme is real or highly probable for this job (explicit or clearly implied). Do not invent site facts.

RULES:
- Every suggestion MUST include "source_hazard_ids": an array of one or more "id" values copied EXACTLY from approved_hazards. Each risk must plausibly follow from those hazard(s) AND be supportable from presentation_context.
- Do NOT introduce risk themes that cannot be tied to at least one approved hazard id.
- Do NOT infer from job_type or site_address alone.
- Do NOT duplicate the same idea with different wording.
- Maximum 12 items.
- Each item: "label" (2–7 words), "category" one of: biological, chemical, physical, environmental, operational, "source_hazard_ids" (required, non-empty subset of approved ids), optional "id" snake_case (server may prefix ident_).

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"label":"...","category":"operational","source_hazard_ids":["hazard_id_here"],"id":"optional_slug"}]}`,
      messages: [
        {
          role: 'user',
          content: `Propose risk themes from approved hazards, grounded in presentation context:\n\n${userBlock}`,
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
    for (let i = 0; i < list.length && items.length < 12; i++) {
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

    const identified_risks_ai = {
      items,
      generated_at: new Date().toISOString(),
    }

    const suggestedIds = new Set((ad?.suggested_risks_ai?.items ?? []).map(i => i.id))
    const identIds = new Set(items.map(i => i.id))
    const manualIds = (ad?.manual_risk_chips ?? []).map(i => i.id)
    const itemIdSet = new Set([...suggestedIds, ...identIds, ...manualIds])
    const presenting_risk_ids = (ad?.presenting_risk_ids ?? []).filter(id => itemIdSet.has(id))

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      identified_risks_ai,
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

    return NextResponse.json({ job: updated, identified_risks_ai })
  } catch (e: unknown) {
    console.error('[identify-risks]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Identify risks failed' },
      { status: 500 }
    )
  }
}
