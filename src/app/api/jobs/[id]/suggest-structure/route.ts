/*
 * POST /api/jobs/[id]/suggest-structure
 *
 * Staff-only. Asks Claude to extract / suggest STRUCTURAL element assessments
 * (walls, floors, subfloor, HVAC, plumbing, framing, etc.) from a job's
 * evidence: Presentation context (areas), approved hazards, progress notes,
 * photo captions.
 *
 * Each row carries { room, element, condition, action, notes } — what the tech
 * needs to scope a restoration estimate and flag structural risks to crew.
 *
 * Body: { mode: 'identify' | 'generate' }
 *   identify — elements EXPLICITLY mentioned as affected (e.g. "plasterboard
 *              soft along wet wall", "subfloor heavily stained").
 *   generate — broader assessment of likely affected elements given hazards
 *              and documented areas (still grounded in JOB_CONTEXT).
 *
 * Persists to assessment_data.suggested_structure_ai. HITL: AI proposes →
 * tech "Accept" moves row into structure_items.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { buildPresentationContext } from '@/lib/jobPresentationContext'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { loadOrgVocabulary } from '@/lib/orgVocabularyLoader'
import { orgVocabularyBlock } from '@/lib/orgVocabulary'
import type {
  AssessmentData,
  JobType,
  StructureAction,
  StructureCondition,
  StructureElement,
  StructureItem,
} from '@/lib/types'

const ELEMENTS: StructureElement[] = [
  'wall', 'ceiling', 'floor', 'subfloor', 'framing', 'insulation',
  'drywall', 'tile', 'carpet', 'hvac', 'plumbing', 'electrical',
  'roof', 'window', 'door', 'cabinetry', 'other',
]
const CONDITIONS: StructureCondition[] = ['intact', 'affected', 'heavily_affected', 'compromised']
const ACTIONS: StructureAction[] = ['monitor', 'clean', 'remediate', 'replace', 'demolish']

function slugId(base: string, i: number) {
  const s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `struct_${i}`
}

type RawItem = {
  id?: string
  room?: string
  element?: string
  condition?: string
  action?: string
  notes?: string
}

function normalize(raw: RawItem, i: number): StructureItem | null {
  const room = (raw.room ?? '').trim().slice(0, 64)
  if (!room) return null
  const elRaw = (raw.element ?? '').toLowerCase() as StructureElement
  const element: StructureElement = ELEMENTS.includes(elRaw) ? elRaw : 'other'
  const condRaw = (raw.condition ?? '').toLowerCase() as StructureCondition
  const condition: StructureCondition = CONDITIONS.includes(condRaw) ? condRaw : 'affected'
  const actRaw = (raw.action ?? '').toLowerCase() as StructureAction
  const action: StructureAction = ACTIONS.includes(actRaw) ? actRaw : 'clean'
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 240) : ''
  const id = ((raw.id ?? '').trim() || slugId(`${room}_${element}`, i)).slice(0, 64)
  return {
    id,
    room,
    element,
    condition,
    action,
    ...(notes ? { notes } : {}),
    source: 'ai',
  }
}

type Mode = 'identify' | 'generate'

const SYSTEM_IDENTIFY = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation including areas, approved hazards, progress notes, photo captions).

Your job: EXTRACT structural element assessments EXPLICITLY described in the source text (e.g. "plasterboard along wet wall is soft", "subfloor heavily stained in ensuite", "HVAC return grille biologically soiled").

RULES:
- Never invent. Every row MUST map to something named or clearly implied in JOB_CONTEXT.
- Tag "room" with the best-matching area name from JOB_CONTEXT.areas when possible; otherwise use the room label the source uses.
- "element": one of wall, ceiling, floor, subfloor, framing, insulation, drywall, tile, carpet, hvac, plumbing, electrical, roof, window, door, cabinetry, other.
- "condition": intact, affected, heavily_affected, or compromised. Map language like "soft / saturated / stained" → affected, "rotted / failing / soaked" → heavily_affected, "structural integrity at risk" → compromised.
- "action": monitor, clean, remediate, replace, or demolish. Map "wipe / sanitise" → clean, "cut out and replace" → replace, "full demolition" → demolish, unsure → remediate.
- Optional "notes" (<=240 chars): one short sentence quoting / paraphrasing the source. Omit if unsupported.
- Maximum 15 rows. No duplicate (room + element) pairs.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"room":"Ensuite","element":"drywall","condition":"heavily_affected","action":"replace","notes":"Progress note: plasterboard on wet wall soft to touch, water-stained.","id":"ensuite_drywall"}]}`

const SYSTEM_GENERATE = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation including areas, approved hazards, progress notes, photo captions).

Your job: PROPOSE the structural elements most likely needing attention given the documented hazards and areas — but stay within documented scope. Don't invent rooms, don't propose work on elements with zero grounding in the hazard profile.

RULES:
- Use only room names that appear in JOB_CONTEXT.areas.
- Propose the element(s) likely affected per room given the hazard profile (e.g. category 3 water → drywall, carpet, subfloor, insulation in affected rooms).
- "condition": default to "affected" unless evidence is stronger.
- "action": choose the minimum appropriate action. "remediate" is a safe fallback.
- Optional "notes" (<=240 chars) explaining why.
- Maximum 20 rows. No duplicate (room + element) pairs.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"room":"Master bathroom","element":"subfloor","condition":"heavily_affected","action":"replace","notes":"Category 3 water intrusion: porous subfloor non-salvageable.","id":"master_bath_subfloor"}]}`

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

    const progressNotes = (notesRes.data ?? [])
      .map(n => ({ room: (n.room || '').trim() || null, body: (n.body || '').trim() }))
      .filter(n => n.body.length > 0)

    const existingStructure = (ad?.structure_items ?? []).map(i => ({
      room: i.room, element: i.element,
    }))

    const userBlock = JSON.stringify(
      {
        mode,
        presentation_context: presentationContext,
        approved_hazards: approvedHazards.map(h => ({ id: h.id, label: h.label })),
        progress_notes: progressNotes,
        existing_structure: existingStructure,
      },
      null,
      2,
    )

    const baseSystem = mode === 'identify' ? SYSTEM_IDENTIFY : SYSTEM_GENERATE

    const vocabulary = await loadOrgVocabulary(supabase, orgId, { kinds: ['structure_element'] })
    const vocabularyBlock = orgVocabularyBlock('structure_element', vocabulary.structure_element)
    const system = vocabularyBlock ? `${baseSystem}\n\n${vocabularyBlock}` : baseSystem

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3072,
      system,
      messages: [
        {
          role: 'user',
          content: `Extract STRUCTURE (mode: ${mode}). Skip anything present in existing_structure.\n\n${userBlock}`,
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
    const cap = mode === 'identify' ? 15 : 20
    const items: StructureItem[] = []
    const seen = new Set<string>()
    for (let i = 0; i < list.length && items.length < cap; i++) {
      const n = normalize(list[i] as RawItem, i)
      if (!n) continue
      const key = `${n.room.toLowerCase()}::${n.element}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(n)
    }

    const payload = { items, generated_at: new Date().toISOString() }

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_structure_ai: payload,
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

    return NextResponse.json({ job: updated, suggested_structure_ai: payload })
  } catch (e: unknown) {
    console.error('[suggest-structure]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest structure failed' },
      { status: 500 },
    )
  }
}
