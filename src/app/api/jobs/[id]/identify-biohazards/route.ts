/*
 * POST /api/jobs/[id]/identify-biohazards
 *
 * Staff-only: Presentation-only payload. Strict prompt: all hazard themes
 * grounded in that text (biological, chemical, physical, environmental, operational).
 * Persists assessment_data.identified_biohazards_ai (field name unchanged).
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { loadOrgVocabulary } from '@/lib/orgVocabularyLoader'
import { orgVocabularyBlock } from '@/lib/orgVocabulary'
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
  return s || `ibh_${i}`
}

function normalizeItem(raw: { id?: string; label?: string; category?: string }, i: number): SuggestedRiskAiItem | null {
  const label = (raw.label ?? '').trim()
  if (!label || label.length > 120) return null
  const cat = (raw.category ?? '').toLowerCase() as SuggestedRiskCategory
  const category = CATEGORIES.includes(cat) ? cat : 'operational'
  const base = (raw.id ?? '').trim() || slugId(label, i)
  const id = `ident_${base.replace(/^ident_/, '').slice(0, 56)}`
  return { id, label: label.slice(0, 120), category }
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

    if (!hasIdentifiableContent(payload)) {
      return NextResponse.json(
        {
          error:
            'Not enough on Presentation to identify hazards. Add observations, areas, contamination type, photo captions, or checklist flags first.',
        },
        { status: 400 }
      )
    }

    const userBlock = JSON.stringify(payload, null, 2)

    const vocabulary = await loadOrgVocabulary(supabase, orgId, { kinds: ['health_hazard'] })
    const vocabularyBlock = orgVocabularyBlock('health_hazard', vocabulary.health_hazard)

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You assist biohazard remediation and specialist cleaning technicians in Australia.

You receive ONLY structured JSON from the Assessment Presentation tab (areas, text fields, checklist flags, photo metadata). There is NO separate risk list.

Your task: list DISTINCT workplace HAZARD themes as SHORT labels (2–7 words) that are STRICTLY grounded in the JSON — include ALL hazard types mentioned or clearly implied, not only biological agents.

CATEGORIES (pick the best fit for each label):
- biological: pathogens, blood, bodily fluids, decomposition, infection
- chemical: solvents, cleaning agents, unknown substances, spills
- physical: sharps, slips/trips/falls, manual handling, noise, equipment, structural
- environmental: sewage, odour, waste, ventilation, mould, dust
- operational: access, communication, lone work, time pressure, documentation, client interface

STRICT RULES:
- Only include a hazard if it is directly supported by explicit words or clearly checked items in the JSON (e.g. blood, sharps, sewage, trip hazard, heavy lifting, chemicals named in text).
- Do NOT infer hazards from job_type or site_address alone.
- Do NOT duplicate the same idea with different wording.
- If the JSON does not support distinct hazard themes, return an empty suggestions array.
- Maximum 12 items.
- Each item: "label", "category" one of: biological, chemical, physical, environmental, operational.
- Optional "id": snake_case; if omitted the server will assign one with an "ident_" prefix.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"label":"...","category":"physical","id":"optional_slug"}]}

${vocabularyBlock}`,
      messages: [
        {
          role: 'user',
          content: `Identify hazard themes supported ONLY by this Presentation payload:\n\n${userBlock}`,
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
      const n = normalizeItem(list[i] as { id?: string; label?: string; category?: string }, i)
      if (!n) continue
      const key = n.label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push(n)
    }

    const identified_biohazards_ai = {
      items,
      generated_at: new Date().toISOString(),
    }

    const suggestedIds = new Set((ad?.suggested_biohazards_ai?.items ?? []).map(i => i.id))
    const identIds = new Set(items.map(i => i.id))
    const manualIds = (ad?.manual_biohazard_chips ?? []).map(i => i.id)
    const itemIdSet = new Set([...suggestedIds, ...identIds, ...manualIds])
    const presenting_biohazard_ids = (ad?.presenting_biohazard_ids ?? []).filter(id => itemIdSet.has(id))

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      identified_biohazards_ai,
      presenting_biohazard_ids,
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

    return NextResponse.json({ job: updated, identified_biohazards_ai })
  } catch (e: unknown) {
    console.error('[identify-biohazards]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Identify hazards failed' },
      { status: 500 }
    )
  }
}
