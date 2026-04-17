/*
 * POST /api/jobs/[id]/suggest-contents
 *
 * Staff-only. Asks Claude to extract / suggest household CONTENTS (furniture,
 * belongings, appliances, personal effects) from a job's evidence: Presentation
 * context (including areas), approved hazards, progress notes, and photo captions.
 *
 * Body: { mode: 'identify' | 'generate' }
 *   identify — only items EXPLICITLY mentioned in text (e.g. "leather couch in
 *              the living room was saturated"). Never invents.
 *   generate — broader inventory the AI plausibly expects in the described rooms
 *              that sits within documented scope (still grounded in JOB_CONTEXT).
 *
 * Persists to assessment_data.suggested_contents_ai. The HITL chain is:
 *   AI proposes → tech "Accept" moves row into contents_items (confirmed)
 *              → or tech edits-then-accepts / dismisses.
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
  ContentsCategory,
  ContentsDisposition,
  ContentsItem,
  JobType,
} from '@/lib/types'

const CATEGORIES: ContentsCategory[] = [
  'furniture', 'electronics', 'clothing', 'kitchenware', 'bedding',
  'personal_effects', 'decor', 'appliances', 'documents', 'other',
]

const DISPOSITIONS: ContentsDisposition[] = ['salvage', 'decontaminate', 'discard', 'undetermined']

function slugId(name: string, i: number) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `content_${i}`
}

type RawItem = {
  id?: string
  name?: string
  room?: string
  category?: string
  disposition?: string
  quantity?: number | string
  notes?: string
}

function normalize(raw: RawItem, i: number): ContentsItem | null {
  const name = (raw.name ?? '').trim()
  if (!name || name.length > 80) return null
  const room = (raw.room ?? '').trim().slice(0, 64) || 'Unspecified'
  const catRaw = (raw.category ?? '').toLowerCase() as ContentsCategory
  const category: ContentsCategory = CATEGORIES.includes(catRaw) ? catRaw : 'other'
  const dispRaw = (raw.disposition ?? '').toLowerCase() as ContentsDisposition
  const disposition: ContentsDisposition = DISPOSITIONS.includes(dispRaw) ? dispRaw : 'undetermined'
  const qtyRaw = Number(raw.quantity)
  const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 9999) : 1
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 240) : ''
  const id = ((raw.id ?? '').trim() || slugId(name, i)).slice(0, 64)
  return {
    id,
    name: name.slice(0, 80),
    room,
    category,
    quantity,
    disposition,
    ...(notes ? { notes } : {}),
    source: 'ai',
  }
}

type Mode = 'identify' | 'generate'

const SYSTEM_IDENTIFY = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation including areas, approved hazards, progress notes, photo captions).

Your job: EXTRACT personal property / CONTENTS (furniture, electronics, bedding, clothing, appliances, decor, documents) that are EXPLICITLY named or unambiguously implied in the source text (e.g. "leather couch in the living room was saturated", "queen mattress discarded").

RULES:
- Never invent. Every item MUST map to something named or clearly implied in JOB_CONTEXT.
- Tag "room" with the best-matching area name from JOB_CONTEXT.areas when possible; otherwise use a short free-text room label the source uses.
- Use one of these categories: furniture, electronics, clothing, kitchenware, bedding, personal_effects, decor, appliances, documents, other.
- Use one of these dispositions: salvage, decontaminate, discard, undetermined. If the text indicates the item was binned / destroyed / thrown out → discard. If "clean / wipe / launder" → decontaminate. If "unaffected / fine" → salvage. Otherwise undetermined.
- "quantity": integer ≥ 1. Default 1.
- Short names only (2–6 words). Optional "notes" (<=240 chars): one short sentence quoting / paraphrasing the source. Omit if unsupported.
- Maximum 20 items. No duplicates (same name + room = duplicate).

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"name":"Leather couch","room":"Living room","category":"furniture","quantity":1,"disposition":"decontaminate","notes":"Progress note: couch saturated, wiping down.","id":"leather_couch"}]}`

const SYSTEM_GENERATE = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation including areas, approved hazards, progress notes, photo captions).

Your job: PROPOSE a plausible CONTENTS inventory the technician is likely to encounter in the documented areas given the described biohazard/scope — but stay inside documented scope (don't invent items for rooms not in JOB_CONTEXT.areas).

RULES:
- Use only room names that appear in JOB_CONTEXT.areas. If an area has no obvious contents scope, skip it.
- Use one of these categories: furniture, electronics, clothing, kitchenware, bedding, personal_effects, decor, appliances, documents, other.
- Default "disposition" to "undetermined" unless hazards clearly force discard (e.g. porous bedding soaked in biological matter → discard).
- "quantity": integer ≥ 1. Short names (2–6 words). Optional "notes" (<=240 chars) explaining why.
- Maximum 25 items. No duplicates (name + room).

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"name":"Queen mattress","room":"Master bedroom","category":"bedding","quantity":1,"disposition":"discard","notes":"Porous item in documented category 3 water intrusion.","id":"queen_mattress"}]}`

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

    const existingContents = (ad?.contents_items ?? []).map(i => ({
      room: i.room, name: i.name, category: i.category,
    }))

    const userBlock = JSON.stringify(
      {
        mode,
        presentation_context: presentationContext,
        approved_hazards: approvedHazards.map(h => ({ id: h.id, label: h.label })),
        progress_notes: progressNotes,
        existing_contents: existingContents,
      },
      null,
      2,
    )

    const baseSystem = mode === 'identify' ? SYSTEM_IDENTIFY : SYSTEM_GENERATE

    const vocabulary = await loadOrgVocabulary(supabase, orgId, { kinds: ['contents_item'] })
    const vocabularyBlock = orgVocabularyBlock('contents_item', vocabulary.contents_item)
    const system = vocabularyBlock ? `${baseSystem}\n\n${vocabularyBlock}` : baseSystem

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3072,
      system,
      messages: [
        {
          role: 'user',
          content: `Extract CONTENTS (mode: ${mode}). Skip anything present in existing_contents.\n\n${userBlock}`,
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
    const cap = mode === 'identify' ? 20 : 25
    const items: ContentsItem[] = []
    const seen = new Set<string>()
    for (let i = 0; i < list.length && items.length < cap; i++) {
      const n = normalize(list[i] as RawItem, i)
      if (!n) continue
      const key = `${n.room.toLowerCase()}::${n.name.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(n)
    }

    const payload = { items, generated_at: new Date().toISOString() }

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_contents_ai: payload,
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

    return NextResponse.json({ job: updated, suggested_contents_ai: payload })
  } catch (e: unknown) {
    console.error('[suggest-contents]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest contents failed' },
      { status: 500 },
    )
  }
}
