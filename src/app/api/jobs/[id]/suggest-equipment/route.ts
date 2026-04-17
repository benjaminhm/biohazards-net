/*
 * POST /api/jobs/[id]/suggest-equipment
 *
 * Staff-only. Extracts equipment chips from a job's evidence: Presentation
 * context, approved hazards, progress notes, photo captions. The org's
 * existing equipment_catalogue is passed in so the AI can MATCH to existing
 * catalogue rows (returned as `catalogue_id`) before proposing new additions.
 *
 * Body: { mode: 'identify' | 'generate' }
 *   identify — only flag equipment explicitly named in text (e.g. "HEPA air scrubber",
 *              "moisture meter reading 28%"). Never invents.
 *   generate — broader suggestion of tools a competent IICRC-trained remediator
 *              would bring for this work.
 *
 * Persists to assessment_data.suggested_equipment_ai (single bucket — the Equipment
 * tab keeps the HITL chain simple: AI proposes → tech adds to catalogue or ticks
 * as ad-hoc → suggestion chip is consumed).
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
  EquipmentCatalogueItem,
  EquipmentCategory,
  JobType,
  SuggestedEquipmentItem,
} from '@/lib/types'

const CATEGORIES: EquipmentCategory[] = [
  'ppe', 'containment', 'cleaning', 'air', 'tools', 'instruments', 'waste', 'other',
]

function slugId(name: string, i: number) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `equip_${i}`
}

function normalizeItem(
  raw: { id?: string; name?: string; category?: string; rationale?: string; catalogue_id?: string },
  i: number,
  catalogueIds: Set<string>,
): SuggestedEquipmentItem | null {
  const name = (raw.name ?? '').trim()
  if (!name || name.length > 80) return null
  const cat = (raw.category ?? '').toLowerCase() as EquipmentCategory
  const category: EquipmentCategory = CATEGORIES.includes(cat) ? cat : 'other'
  const id = (raw.id ?? '').trim() || slugId(name, i)
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 240) : ''
  const matchedCatalogueId =
    typeof raw.catalogue_id === 'string' && catalogueIds.has(raw.catalogue_id)
      ? raw.catalogue_id
      : undefined
  return {
    id: id.slice(0, 64),
    name: name.slice(0, 80),
    category,
    ...(rationale ? { rationale } : {}),
    ...(matchedCatalogueId ? { catalogue_id: matchedCatalogueId } : {}),
  }
}

type Mode = 'identify' | 'generate'

const SYSTEM_IDENTIFY = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation, approved hazards, progress notes, photo captions) and ORG_CATALOGUE (the team's existing equipment list).

Your job: EXTRACT equipment items that are EXPLICITLY named or unambiguously implied in the source text (e.g. "HEPA air scrubber running in bedroom", "moisture meter reading 28%", "negative air machine in containment").

RULES:
- Never invent. Every item MUST map to something named or clearly implied in JOB_CONTEXT.
- If an extracted item matches an ORG_CATALOGUE entry (same or near-identical name), set "catalogue_id" to that entry's id so the tech can one-click tick it. Otherwise omit catalogue_id — the tech will decide to add it.
- Use one of these categories: ppe, containment, cleaning, air, tools, instruments, waste, other.
- Short names only (2–5 words), no marketing fluff, no model numbers unless given.
- Optional "rationale": one short sentence quoting / paraphrasing the source. Omit if unsupported.
- Maximum 15 items. No duplicate names.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"name":"HEPA air scrubber","category":"air","rationale":"Progress note: HEPA scrubber running in kitchen overnight.","catalogue_id":"hepa_scrubber_xy12","id":"hepa_air_scrubber"}]}`

const SYSTEM_GENERATE = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation, approved hazards, progress notes, photo captions) and ORG_CATALOGUE (the team's existing equipment list).

Your job: SUGGEST equipment a competent IICRC-trained biohazard remediator would bring for this work — stay within scope (don't propose equipment for unrelated trades).

RULES:
- Prefer ORG_CATALOGUE entries — when an appropriate tool already exists in the catalogue, set "catalogue_id" to that entry's id so the tech can one-click tick it.
- Only propose new (catalogue_id omitted) items when nothing in the catalogue covers the need.
- Use one of these categories: ppe, containment, cleaning, air, tools, instruments, waste, other.
- Short names (2–5 words). Optional "rationale": one short sentence explaining why.
- Maximum 18 items. No duplicate names.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"name":"...","category":"air","rationale":"...","catalogue_id":"...","id":"..."}]}`

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
        { status: 403 },
      )
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local (see .env.local.example), then restart the dev server.',
        },
        { status: 503 },
      )
    }
    const client = new Anthropic({ apiKey })

    const body = (await req.json().catch(() => ({}))) as { mode?: Mode }
    const mode: Mode = body.mode === 'generate' ? 'generate' : 'identify'

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const [jobRes, photosRes, notesRes, profileRes] = await Promise.all([
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
      supabase.from('company_profile').select('equipment_catalogue').eq('org_id', orgId).maybeSingle(),
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

    const progressNotes = (notesRes.data ?? [])
      .map(n => ({ room: (n.room || '').trim() || null, body: (n.body || '').trim() }))
      .filter(n => n.body.length > 0)

    const catalogue = ((profileRes.data?.equipment_catalogue as EquipmentCatalogueItem[] | null) ?? [])
      .filter(i => !i.archived)
    const catalogueIds = new Set(catalogue.map(i => i.id))
    const cataloguePayload = catalogue.map(i => ({
      id: i.id,
      name: i.name,
      category: i.category,
      ...(i.notes ? { notes: i.notes } : {}),
    }))

    const userBlock = JSON.stringify(
      {
        mode,
        presentation_context: presentationContext,
        approved_hazards: approvedHazards.map(h => ({ id: h.id, label: h.label })),
        progress_notes: progressNotes,
        org_catalogue: cataloguePayload,
      },
      null,
      2,
    )

    const system = mode === 'identify' ? SYSTEM_IDENTIFY : SYSTEM_GENERATE

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system,
      messages: [
        {
          role: 'user',
          content: `Extract equipment (mode: ${mode}) from this job context:\n\n${userBlock}`,
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
    const items: SuggestedEquipmentItem[] = []
    const seenNames = new Set<string>()
    for (let i = 0; i < list.length && items.length < cap; i++) {
      const n = normalizeItem(
        list[i] as {
          id?: string
          name?: string
          category?: string
          rationale?: string
          catalogue_id?: string
        },
        i,
        catalogueIds,
      )
      if (!n) continue
      const key = n.name.toLowerCase()
      if (seenNames.has(key)) continue
      seenNames.add(key)
      items.push(n)
    }

    const payload = { items, generated_at: new Date().toISOString() }

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_equipment_ai: payload,
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

    return NextResponse.json({ job: updated, suggested_equipment_ai: payload })
  } catch (e: unknown) {
    console.error('[suggest-equipment]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest equipment failed' },
      { status: 500 },
    )
  }
}
