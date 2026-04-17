/*
 * POST /api/jobs/[id]/suggest-chemicals
 *
 * Staff-only. Asks Claude to extract / suggest CHEMICALS the tech is using (or
 * should use) on this job. Combines evidence from:
 *   - Presentation context (job type, site, hazards, areas)
 *   - Approved hazards
 *   - Progress notes (e.g. "wiped down with Benefect Decon 30")
 *   - Photo captions
 *   - ORG_CATALOGUE: the chemicals already in the team's catalogue, each with
 *     hazard_classes and — where uploaded — a parsed SDS summary. The AI is
 *     told to prefer matching catalogue_id over proposing a new row.
 *
 * Body: { mode: 'identify' | 'generate' }
 *   identify — only chemicals EXPLICITLY named in the source text.
 *   generate — broader suggestion grounded in hazard profile (e.g. Cat 3 water
 *              → antimicrobial; mould → fungicidal detergent).
 *
 * Persists to assessment_data.suggested_chemicals_ai. HITL: tech ticks a
 * catalogue match, promotes a new chemical into the catalogue (optionally
 * with SDS upload), or adds as ad-hoc (this job only).
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
  ChemicalApplication,
  ChemicalCatalogueItem,
  ChemicalHazardClass,
  JobType,
  SuggestedChemicalItem,
} from '@/lib/types'

const HAZARD_CLASSES: ChemicalHazardClass[] = [
  'corrosive', 'flammable', 'toxic', 'oxidiser', 'biohazard',
  'irritant', 'health_hazard', 'environmental', 'compressed_gas', 'other',
]

const APPLICATIONS: ChemicalApplication[] = [
  'surface_wipe', 'spray', 'fogging', 'immersion', 'injection', 'poultice', 'other',
]

function slugId(name: string, i: number) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `chem_${i}`
}

function sanitizeHazardClasses(raw: unknown): ChemicalHazardClass[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<ChemicalHazardClass>()
  for (const r of raw) {
    const c = String(r).toLowerCase() as ChemicalHazardClass
    if (HAZARD_CLASSES.includes(c)) out.add(c)
  }
  return Array.from(out)
}

type RawItem = {
  id?: string
  name?: string
  hazard_classes?: unknown
  application?: string
  dilution?: string
  rationale?: string
  catalogue_id?: string
}

function normalize(
  raw: RawItem,
  i: number,
  catalogueIds: Set<string>,
): SuggestedChemicalItem | null {
  const name = (raw.name ?? '').trim()
  if (!name || name.length > 80) return null
  const hazard_classes = sanitizeHazardClasses(raw.hazard_classes)
  const appRaw = (raw.application ?? '').toLowerCase() as ChemicalApplication
  const application: ChemicalApplication = APPLICATIONS.includes(appRaw) ? appRaw : 'other'
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 240) : ''
  const dilution = typeof raw.dilution === 'string' ? raw.dilution.trim().slice(0, 40) : ''
  const id = ((raw.id ?? '').trim() || slugId(name, i)).slice(0, 64)
  const matchedCatalogueId =
    typeof raw.catalogue_id === 'string' && catalogueIds.has(raw.catalogue_id)
      ? raw.catalogue_id
      : undefined
  return {
    id,
    name: name.slice(0, 80),
    hazard_classes,
    application,
    ...(dilution ? { dilution } : {}),
    ...(rationale ? { rationale } : {}),
    ...(matchedCatalogueId ? { catalogue_id: matchedCatalogueId } : {}),
  }
}

type Mode = 'identify' | 'generate'

const SYSTEM_IDENTIFY = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation, approved hazards, progress notes, photo captions) and ORG_CATALOGUE (the team's existing chemicals list with parsed SDS summaries where available).

Your job: EXTRACT chemicals that are EXPLICITLY named or unambiguously implied in the source text (e.g. "wiped down with Benefect Decon 30", "sprayed Sporicidin on the subfloor", "hydrogen peroxide fogging in the ensuite").

RULES:
- Never invent. Every item MUST map to something named or clearly implied in JOB_CONTEXT.
- If an extracted chemical matches an ORG_CATALOGUE entry (same trade name or clearly equivalent active ingredient), set "catalogue_id" to that entry's id.
- "application": one of surface_wipe, spray, fogging, immersion, injection, poultice, other.
- "hazard_classes": array of zero or more from: corrosive, flammable, toxic, oxidiser, biohazard, irritant, health_hazard, environmental, compressed_gas, other. When the chemical matches a catalogue entry, COPY its hazard_classes.
- Optional "dilution" (<=40 chars): e.g. "1:10", "neat", "500 ppm" — only if stated in source.
- Optional "rationale" (<=240 chars): one sentence quoting / paraphrasing the source.
- Short names only (2–5 words). No marketing fluff. Maximum 12 items. No duplicate names.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"name":"Benefect Decon 30","hazard_classes":["irritant"],"application":"surface_wipe","dilution":"neat","rationale":"Progress note: wiped ensuite vanity with Benefect Decon 30.","catalogue_id":"benefect_decon_30_xy12","id":"benefect_decon_30"}]}`

const SYSTEM_GENERATE = `You assist biohazard remediation technicians in Australia.

You receive JOB_CONTEXT (presentation, approved hazards, progress notes, photo captions) and ORG_CATALOGUE (the team's existing chemicals list with parsed SDS summaries where available).

Your job: SUGGEST chemicals a competent IICRC-trained biohazard remediator would deploy given the hazard profile — but stay within scope. Don't propose chemistry for unrelated hazards.

RULES:
- Prefer ORG_CATALOGUE entries — when an appropriate product already exists, set "catalogue_id" to that entry's id so the tech can one-click tick it.
- Only propose new (catalogue_id omitted) items when nothing in the catalogue covers the need.
- Hazard-to-chemistry mapping examples:
    Cat 3 water / sewage → antimicrobial / sanitiser (quat-amine or peroxide).
    Mould → fungicidal detergent; encapsulant after remediation.
    Blood / OPIM → peracetic-acid or hypochlorite-based disinfectant.
    Methamphetamine residues → alkaline detergent + oxidising cleaner.
- "application": surface_wipe, spray, fogging, immersion, injection, poultice, other.
- "hazard_classes": array from corrosive, flammable, toxic, oxidiser, biohazard, irritant, health_hazard, environmental, compressed_gas, other. When the chemical matches a catalogue entry, COPY its hazard_classes.
- Optional "dilution" (<=40 chars) when you have high confidence (e.g. "1:10" for bleach sanitising).
- Optional "rationale" (<=240 chars) explaining why.
- Short names (2–5 words). Maximum 15 items. No duplicate names.

Respond ONLY with valid JSON (no markdown fences):
{"suggestions":[{"name":"...","hazard_classes":["..."],"application":"spray","dilution":"1:10","rationale":"...","catalogue_id":"...","id":"..."}]}`

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      supabase
        .from('company_profile')
        .select('chemicals_catalogue')
        .eq('org_id', orgId)
        .maybeSingle(),
    ])

    if (!jobRes.data) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

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

    const catalogue = ((profileRes.data?.chemicals_catalogue as ChemicalCatalogueItem[] | null) ?? [])
      .filter(i => !i.archived)
    const catalogueIds = new Set(catalogue.map(i => i.id))
    const cataloguePayload = catalogue.map(i => ({
      id: i.id,
      name: i.name,
      ...(i.manufacturer ? { manufacturer: i.manufacturer } : {}),
      ...(i.active_ingredient ? { active_ingredient: i.active_ingredient } : {}),
      hazard_classes: i.hazard_classes,
      ...(i.sds_parsed
        ? {
            sds_summary: {
              signal_word: i.sds_parsed.signal_word ?? null,
              ppe_required: i.sds_parsed.ppe_required,
              handling_precautions: i.sds_parsed.handling_precautions ?? null,
            },
          }
        : {}),
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

    const baseSystem = mode === 'identify' ? SYSTEM_IDENTIFY : SYSTEM_GENERATE

    const vocabulary = await loadOrgVocabulary(supabase, orgId, { kinds: ['chemical'] })
    const vocabularyBlock = orgVocabularyBlock('chemical', vocabulary.chemical)
    const system = vocabularyBlock ? `${baseSystem}\n\n${vocabularyBlock}` : baseSystem

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system,
      messages: [
        {
          role: 'user',
          content: `Extract chemicals (mode: ${mode}) from this job context:\n\n${userBlock}`,
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
    const cap = mode === 'identify' ? 12 : 15
    const items: SuggestedChemicalItem[] = []
    const seenNames = new Set<string>()
    for (let i = 0; i < list.length && items.length < cap; i++) {
      const n = normalize(list[i] as RawItem, i, catalogueIds)
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
      suggested_chemicals_ai: payload,
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

    return NextResponse.json({ job: updated, suggested_chemicals_ai: payload })
  } catch (e: unknown) {
    console.error('[suggest-chemicals]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest chemicals failed' },
      { status: 500 },
    )
  }
}
