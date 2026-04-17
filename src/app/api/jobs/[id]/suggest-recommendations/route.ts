/*
 * POST /api/jobs/[id]/suggest-recommendations
 *
 * Staff-only. Extracts recommendation chips from a job's evidence: Presentation
 * context, approved hazards/risks, progress notes, and photo captions.
 *
 * Body: { mode: 'identify' | 'generate' }
 *   identify  — only extract things that are quotable from text/flags ("I recommend…",
 *               observations, access restrictions, progress notes). Never invents.
 *   generate  — broader brainstorm of plausible next-steps tied to the evidence.
 *
 * Persists to assessment_data.identified_recommendations_ai or .suggested_recommendations_ai.
 * Preserves manual chips + presenting_recommendation_ids; prunes ids that no longer exist.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { buildPresentationContext } from '@/lib/jobPresentationContext'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import type {
  AssessmentData,
  JobType,
  RecommendationAudience,
  RecommendationItem,
} from '@/lib/types'

const AUDIENCES: RecommendationAudience[] = ['client', 'insurer', 'occupant', 'internal']

function slugId(label: string, i: number) {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `rec_${i}`
}

function normalizeItem(
  raw: { id?: string; label?: string; audience?: string; rationale?: string },
  i: number
): RecommendationItem | null {
  const label = (raw.label ?? '').trim()
  if (!label || label.length > 140) return null
  const aud = (raw.audience ?? '').toLowerCase() as RecommendationAudience
  const audience = AUDIENCES.includes(aud) ? aud : 'client'
  const id = (raw.id ?? '').trim() || slugId(label, i)
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 400) : ''
  return {
    id: id.slice(0, 64),
    label: label.slice(0, 140),
    audience,
    ...(rationale ? { rationale } : {}),
  }
}

type Mode = 'identify' | 'generate'

const SYSTEM_IDENTIFY = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation, approved hazards, progress notes, photo captions).

Your job: EXTRACT recommendations that are already IMPLICITLY OR EXPLICITLY PRESENT in the source text (phrases like "I recommend…", "we should…", "needs to be replaced", "requires further testing", or obvious follow-ups implied by observations).

RULES:
- Never invent: every recommendation MUST be traceable to the JOB_CONTEXT.
- Each item is a short, action-oriented sentence fragment (5–18 words), starting with a verb where possible.
- Choose "audience": client, insurer, occupant, or internal (default client).
- Optional "rationale": one short sentence (<=200 chars) from/paraphrasing the source. Omit if unsupported.
- Maximum 15 items. No duplicates. Optional snake_case "id".

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"label":"Replace affected plasterboard in ensuite","audience":"client","rationale":"Observations note soft, water-stained plasterboard in ensuite wet wall.","id":"replace_ensuite_plasterboard"}]}`

const SYSTEM_GENERATE = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation, approved hazards, progress notes, photo captions).

Your job: BRAINSTORM a broader set of plausible next-step recommendations that a competent IICRC-trained remediator would propose for this evidence. Stay within scope — don't invent unrelated issues, but you MAY propose common paired follow-ups (post-remediation verification, occupant relocation, insurer scope clarification, etc.).

RULES:
- Each item is a short, action-oriented sentence fragment (5–18 words), starting with a verb.
- Choose "audience": client, insurer, occupant, or internal.
- Optional "rationale": one short sentence (<=200 chars) explaining why.
- Maximum 18 items. No duplicate labels. Optional snake_case "id".

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"label":"...","audience":"client","rationale":"...","id":"..."}]}`

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

    const body = (await req.json().catch(() => ({}))) as { mode?: Mode }
    const mode: Mode = body.mode === 'generate' ? 'generate' : 'identify'

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const [jobRes, photosRes, notesRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_type, site_address, urgency, notes, assessment_data')
        .eq('id', jobId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase.from('photos').select('area_ref, category, caption').eq('job_id', jobId),
      supabase
        .from('progress_notes')
        .select('room, body, created_at')
        .eq('job_id', jobId)
        .is('archived_at', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(80),
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

    const approvedHazards = (() => {
      const all = [
        ...(ad?.identified_biohazards_ai?.items ?? []),
        ...(ad?.suggested_biohazards_ai?.items ?? []),
        ...(ad?.manual_biohazard_chips ?? []),
      ]
      const approved = new Set(ad?.presenting_biohazard_ids ?? [])
      const seen = new Set<string>()
      return all.filter(h => {
        if (!approved.has(h.id) || seen.has(h.id)) return false
        seen.add(h.id)
        return true
      })
    })()

    const approvedRisks = (() => {
      const all = [
        ...(ad?.identified_risks_ai?.items ?? []),
        ...(ad?.suggested_risks_ai?.items ?? []),
        ...(ad?.manual_risk_chips ?? []),
      ]
      const approved = new Set(ad?.presenting_risk_ids ?? [])
      const seen = new Set<string>()
      return all.filter(r => {
        if (!approved.has(r.id) || seen.has(r.id)) return false
        seen.add(r.id)
        return true
      })
    })()

    const progressNotes = (notesRes.data ?? []).map(n => ({
      room: (n.room || '').trim() || null,
      body: (n.body || '').trim(),
    })).filter(n => n.body.length > 0)

    const userBlock = JSON.stringify(
      {
        mode,
        presentation_context: presentationContext,
        approved_hazards: approvedHazards.map(h => ({ id: h.id, label: h.label })),
        approved_risks: approvedRisks.map(r => ({ id: r.id, label: r.label, category: r.category })),
        progress_notes: progressNotes,
      },
      null,
      2
    )

    const system = mode === 'identify' ? SYSTEM_IDENTIFY : SYSTEM_GENERATE

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system,
      messages: [
        {
          role: 'user',
          content: `Extract recommendations (mode: ${mode}) from this job context:\n\n${userBlock}`,
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
    const cap = mode === 'identify' ? 15 : 18
    const items: RecommendationItem[] = []
    const seenLabels = new Set<string>()
    for (let i = 0; i < list.length && items.length < cap; i++) {
      const n = normalizeItem(
        list[i] as { id?: string; label?: string; audience?: string; rationale?: string },
        i
      )
      if (!n) continue
      const key = n.label.toLowerCase()
      if (seenLabels.has(key)) continue
      seenLabels.add(key)
      items.push(n)
    }

    const payload = { items, generated_at: new Date().toISOString() }

    const storeKey: keyof Pick<
      AssessmentData,
      'identified_recommendations_ai' | 'suggested_recommendations_ai'
    > = mode === 'identify' ? 'identified_recommendations_ai' : 'suggested_recommendations_ai'

    // Preserve ids that still exist across every source.
    const retainedIdSet = new Set<string>([
      ...items.map(i => i.id),
      ...(mode === 'identify'
        ? ad?.suggested_recommendations_ai?.items ?? []
        : ad?.identified_recommendations_ai?.items ?? []
      ).map(i => i.id),
      ...(ad?.manual_recommendation_chips ?? []).map(i => i.id),
    ])
    const presenting_recommendation_ids = (ad?.presenting_recommendation_ids ?? []).filter(id =>
      retainedIdSet.has(id)
    )

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      [storeKey]: payload,
      presenting_recommendation_ids,
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

    return NextResponse.json({ job: updated, [storeKey]: payload })
  } catch (e: unknown) {
    console.error('[suggest-recommendations]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest recommendations failed' },
      { status: 500 }
    )
  }
}
