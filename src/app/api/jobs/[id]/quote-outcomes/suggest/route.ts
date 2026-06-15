/*
 * POST /api/jobs/[id]/quote-outcomes/suggest
 *
 * Staff-only: AI draft for quote pricing sections from job context + instruction.
 * Body: { instruction?: string, section?: 'outcomes' | 'volume' | 'surface' }
 *   outcomes (default) → Section 1 mobilisation/fee rows
 *   volume            → Section 2 contents m³ lines + optional section terms
 *   surface           → Section 3 per-room surface include/rate patches + terms
 */
import { NextRequest, NextResponse } from 'next/server'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { derivePricingLayoutFromCapture } from '@/lib/quoteSections'
import type {
  AssessmentData,
  JobType,
  CustomPricingRow,
  OutcomeKind,
  OutcomeQuoteRow,
  SectionTerms,
  SurfaceKind,
  VolumePricingRow,
} from '@/lib/types'

const SYSTEM = `You draft Section 1 ("Mobilisation, Fees & Fixed-Rate Items") rows for an Australian biohazard remediation quote.

Australian quotes are split into three independent sections:
  Section 1 — Mobilisation, Fees & Fixed-Rate Items   (value-based; YOUR JOB)
  Section 2 — Contents Removal                         (per-cubic-metre; staff-only)
  Section 3 — Remediation, Cleaning & Sanitisation     (per-square-metre; staff-only)

You ONLY draft Section 1 rows. Do NOT estimate contents volume, weight, m3, disposal
quantity, or per-m3 pricing. Contents are visual/reported items only. You may draft
fixed-fee proposed actions tied to a nominated room/zone, but never duplicate a
separate Section 2/3 pricing table row or imply a measured quantity you do not have.

You will receive:
1. A "context" object with all known facts (assessment data, scope, photos, documents,
   pricing_layout flags). This is your ONLY data source — never invent rooms, hazards,
   or scope that don't appear in the context.
2. An optional "instruction" string from the staff member. Follow it closely when
   provided; otherwise use professional judgment.
3. Zero or more image attachments (assessment/before, including Fast Quote client
   photos). Use them as primary visual evidence. Don't invent details not visible
   or stated; capture uncertainty as assumption/exclusion.

Each row must classify itself with a "kind" so the printed quote can group it:
  - "mobilisation"  — Callout, dispatch, set-up, demobilisation, travel.
  - "project_mgmt"  — Project / case management, coordination, scheduling, reporting.
  - "surcharge"     — After-hours, weekend, public holiday, hazard surcharge, urgency premium.
  - "fixed_scope"   — Whole-job fixed-fee scopes (e.g. "Trauma scene attendance, single room, fixed-fee").
  - "other"         — Use sparingly when none of the above fit.

Return ONLY valid JSON with this shape:
{
  "rows": [
    {
      "kind": "mobilisation",
      "areas": ["Kitchen", "Hallway"],
      "outcome_title": "",
      "outcome_description": "",
      "acceptance_criteria": "",
      "price": 0,
      "status": "suggested",
      "contents": [""],
      "included": [""],
      "excluded": [""],
      "assumptions": [""],
      "verification_method": "",
      "metrics": [{"label":"", "value":""}]
    }
  ]
}

Rules:
- Output Section 1 rows only — fees, mobilisation, PM, surcharges, fixed scopes.
- Use proposed-action language only. Do not state achieved outcomes, standards,
  completion, clearance, safety, certification, or remediation results.
- Treat legacy JSON names this way:
  - "outcome_title" = short proposed action heading.
  - "outcome_description" = action details / proposed activities.
  - "contents" = observed or reported contents/items in the nominated room/zone;
    never an estimated volume, weight, or quantity.
- "areas" is optional for Section 1 rows that aren't tied to a specific room
  (most fees aren't); leave as [] when general.
- "kind" is REQUIRED on every row. Choose the best fit from the enum above.
- No graphic detail; professional scientific wording.
- status must be "suggested" for every row.
- price must be >= 0 and a number.
- All facts come from the context object — do not hallucinate.
- The instruction steers structure and emphasis, not facts.
- Avoid absolute/finality/outcome words and phrases, including:
  "total", "complete", "completely", "entire", "all", "fully", "full",
  "guaranteed", "guarantee", "eliminate", "eliminated", "clear", "cleared",
  "safe", "make safe", "restore", "restored", "decontaminate",
  "decontaminated", "disinfected", "sanitised", "remediated", "certified",
  "certify", "odour elimination", "odour removal", "remove odour",
  "death odour removal", "odour-free", and similar certainty/finality wording.
- Prefer bounded action verbs and target wording: "attend", "establish",
  "relocate", "remove visibly affected", "bag", "apply", "transport",
  "document", "reported", "visible", "accessible", "nominated",
  "target odour/source", "primary contamination zone".
- Odour wording must be action + target only. Acceptable: "Apply odour-control
  treatment products to the nominated target odour/source." Do not explain or
  broaden odour caveats unless staff specifically instructs it.
- If context.fast_quote.enabled is true, FAST QUOTE MODE applies:
  - Treat as limited-information / possibly sight-unseen.
  - Do not imply a full site inspection or confirmed contamination unless context says so.
  - Conservative, conditional wording with strong exclusions, concealed-condition
    caveats, access limitations, and variation rights.
  - If pricing isn't stated or clearly inferable, set price to 0 rather than inventing.
  - Add assumption/exclusion lines that make the limited-info basis clear.
`

const SYSTEM_VOLUME = `You draft Section 2 ("Contents Removal") rows for an Australian biohazard remediation quote.

Section 2 bills estimated cubic-metre (m³) volume per room or free-form line. You ONLY draft Section 2 — do NOT draft Section 1 fees or Section 3 surface m² pricing.

Return ONLY valid JSON:
{
  "volume_rows": [
    {
      "description": "",
      "area_name": "",
      "estimated_volume_m3": 0,
      "notes": ""
    }
  ],
  "terms": {
    "observed_contents": [""],
    "included": [""],
    "excluded": [""],
    "assumptions": [""]
  }
}

Rules:
- Ground estimates in context (assessment areas, photos, notes, instruction). Do NOT invent rooms.
- "area_name" must match an assessment area when the row is room-specific; leave "" for free-form lines (e.g. skip hire).
- "description" is required (e.g. "Bedroom contents", "Garage hoarding pile").
- "estimated_volume_m3" is a conservative estimate >= 0. Use 0 when truly unknown rather than guessing wildly.
- "notes" optional — access limits, mixed waste, staged uplift, etc.
- "terms" optional section-level inclusions/exclusions/assumptions for Section 2 only.
- Proposed-action / estimate language only — no achieved outcomes or clearance claims.
- Follow the staff instruction when provided.`

const SYSTEM_SURFACE = `You draft Section 3 ("Remediation, Cleaning & Sanitisation") surface-pricing suggestions for an Australian biohazard remediation quote.

Section 3 prices Floor / Walls / Ceiling per room at $/m². You suggest which surfaces to include and optional $/m² rates — staff edit before saving.

Return ONLY valid JSON:
{
  "surface_patches": [
    {
      "area_name": "",
      "surfaces": [
        { "kind": "floor", "included": true, "unit_price_per_sqm": 0 },
        { "kind": "walls", "included": false, "unit_price_per_sqm": 0 },
        { "kind": "ceiling", "included": false, "unit_price_per_sqm": 0 }
      ]
    }
  ],
  "terms": {
    "observed_contents": [""],
    "included": [""],
    "excluded": [""],
    "assumptions": [""]
  }
}

Rules:
- Only patch areas that exist in context.assessment_data.areas — do NOT invent rooms.
- "kind" must be exactly "floor", "walls", or "ceiling".
- Set "included" true/false per surface based on contamination scope and instruction.
- "unit_price_per_sqm" >= 0; use context.global_surface_rate_per_m2 when set, else 0 for staff to fill.
- Omit surfaces you have no basis to change.
- "terms" optional section-level inclusions/exclusions/assumptions for Section 3 only.
- Proposed pricing language only — no achieved outcomes or clearance claims.
- Follow the staff instruction when provided.`

const SYSTEM_CUSTOM = `You draft Section 4 (a custom / wildcard pricing section) for an Australian biohazard remediation quote.

The staff member sets the printed section title separately. You will receive custom_section_title in the context or instruction — use it to steer scope, but do NOT repeat Sections 1–3 (mobilisation/fees, contents m³, surface m²).

Return ONLY valid JSON:
{
  "rows": [
    {
      "scope_title": "",
      "scope_description": "",
      "price": 0,
      "status": "suggested",
      "included": [""],
      "excluded": [""],
      "assumptions": [""]
    }
  ],
  "terms": {
    "observed_contents": [""],
    "included": [""],
    "excluded": [""],
    "assumptions": [""]
  }
}

Rules:
- Draft value-based scope lines only for this custom section.
- Proposed-action language — no achieved outcomes, clearance, or certification claims.
- price >= 0; use 0 when not inferable from context.
- status must be "suggested" on every row.
- scope_title and scope_description required on each row.
- Optional "terms" for section-level bullets.
- Facts must come from context — do not hallucinate rooms or scope.
- Follow the staff instruction when provided.`

type QuoteSuggestSection = 'outcomes' | 'volume' | 'surface' | 'custom'

const VALID_SECTIONS: QuoteSuggestSection[] = ['outcomes', 'volume', 'surface', 'custom']
const VALID_SURFACE_KINDS: SurfaceKind[] = ['floor', 'walls', 'ceiling']

function safeNumber(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Anthropic image media types we'll attach. Supabase compresses uploads to JPEG, but
 *  fall through to png/webp/gif if the URL extension says so. */
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function imageMediaTypeFromUrl(url: string): ImageMediaType {
  const lower = url.split('?')[0].toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

/** Anthropic accepts up to ~5 MB per image. Skip anything larger to avoid 4xx. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

async function fetchImageBase64(
  url: string,
): Promise<{ data: string; media_type: ImageMediaType } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    return {
      data: Buffer.from(buf).toString('base64'),
      media_type: imageMediaTypeFromUrl(url),
    }
  } catch {
    return null
  }
}

interface SuggestPhotoRow {
  id: string
  file_url: string
  area_ref: string | null
  category: string
  caption: string | null
  include_in_composed_reports: boolean | null
  uploaded_at: string
}

const FAST_QUOTE_AREA_REF = 'Fast Quote'
const MAX_SUGGEST_IMAGES = 8

/** Prefer Fast Quote photos, then other assessment-stage photos, then "before" photos.
 *  Drop anything the staff has marked as excluded from composed reports. */
function pickPhotosForVision(rows: SuggestPhotoRow[]): SuggestPhotoRow[] {
  const eligible = rows.filter(p => {
    if (p.include_in_composed_reports === false) return false
    return p.category === 'assessment' || p.category === 'before'
  })
  const score = (p: SuggestPhotoRow): number => {
    if ((p.area_ref ?? '').trim() === FAST_QUOTE_AREA_REF) return 0
    if (p.category === 'assessment') return 1
    return 2
  }
  return [...eligible]
    .sort((a, b) => {
      const s = score(a) - score(b)
      if (s !== 0) return s
      return b.uploaded_at.localeCompare(a.uploaded_at)
    })
    .slice(0, MAX_SUGGEST_IMAGES)
}

const VALID_KINDS: OutcomeKind[] = ['mobilisation', 'project_mgmt', 'surcharge', 'fixed_scope', 'other']

function parseKind(raw: unknown): OutcomeKind {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (VALID_KINDS as readonly string[]).includes(v) ? (v as OutcomeKind) : 'other'
}

function parseRows(raw: unknown): OutcomeQuoteRow[] {
  const root = raw as { rows?: Array<Record<string, unknown>> }
  const rows = root.rows ?? []
  return rows
    .map((row, idx) => {
      const areasRaw = Array.isArray(row.areas) ? row.areas : []
      const contentsRaw = Array.isArray(row.contents) ? row.contents : []
      const includedRaw = Array.isArray(row.included) ? row.included : []
      const excludedRaw = Array.isArray(row.excluded) ? row.excluded : []
      const assumptionsRaw = Array.isArray(row.assumptions) ? row.assumptions : []
      const metricsRaw = Array.isArray(row.metrics) ? row.metrics : []
      return {
        id: `suggested_${idx + 1}`,
        kind: parseKind(row.kind),
        areas: areasRaw.map(a => String(a ?? '').trim()).filter(Boolean),
        outcome_title: String(row.outcome_title ?? '').trim(),
        outcome_description: String(row.outcome_description ?? '').trim(),
        acceptance_criteria: String(row.acceptance_criteria ?? '').trim(),
        price: Math.max(0, Math.round(safeNumber(row.price, 0) * 100) / 100),
        status: 'suggested',
        contents: contentsRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        included: includedRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        excluded: excludedRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        assumptions: assumptionsRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        verification_method: String(row.verification_method ?? '').trim(),
        metrics: metricsRaw
          .map(m => {
            const x = m as Record<string, unknown>
            return { label: String(x.label ?? '').trim(), value: String(x.value ?? '').trim() }
          })
          .filter(m => m.label || m.value),
      } satisfies OutcomeQuoteRow
    })
    .filter(row => row.outcome_title && row.outcome_description)
}

function parseCustomRows(raw: unknown): CustomPricingRow[] {
  const root = raw as { rows?: Array<Record<string, unknown>> }
  return (root.rows ?? [])
    .map((row, idx) => ({
      id: `custom_${idx + 1}`,
      scope_title: String(row.scope_title ?? row.title ?? '').trim(),
      scope_description: String(row.scope_description ?? row.description ?? '').trim(),
      price: Math.max(0, Math.round(safeNumber(row.price, 0) * 100) / 100),
      status: 'suggested' as const,
      included: parseStringList(row.included),
      excluded: parseStringList(row.excluded),
      assumptions: parseStringList(row.assumptions),
    }))
    .filter(row => row.scope_title && row.scope_description)
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(v => String(v ?? '').trim()).filter(Boolean)
}

function parseSectionTerms(raw: unknown): SectionTerms | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const included = parseStringList(o.included)
  const excluded = parseStringList(o.excluded)
  const assumptions = parseStringList(o.assumptions)
  const observed_contents = parseStringList(o.observed_contents)
  if (!included.length && !excluded.length && !assumptions.length && !observed_contents.length) return undefined
  return {
    ...(observed_contents.length ? { observed_contents } : {}),
    ...(included.length ? { included } : {}),
    ...(excluded.length ? { excluded } : {}),
    ...(assumptions.length ? { assumptions } : {}),
  }
}

function parseVolumeRows(raw: unknown): VolumePricingRow[] {
  const root = raw as { volume_rows?: Array<Record<string, unknown>> }
  return (root.volume_rows ?? [])
    .map(row => ({
      description: String(row.description ?? '').trim(),
      area_name: String(row.area_name ?? '').trim(),
      estimated_volume_m3: Math.max(0, Math.round(safeNumber(row.estimated_volume_m3, 0) * 10) / 10),
      notes: String(row.notes ?? '').trim() || undefined,
    }))
    .filter(row => row.description)
}

function parseSurfacePatches(raw: unknown): Array<{
  area_name: string
  surfaces: Array<{ kind: SurfaceKind; included: boolean; unit_price_per_sqm: number }>
}> {
  const root = raw as { surface_patches?: Array<Record<string, unknown>> }
  return (root.surface_patches ?? [])
    .map(patch => {
      const area_name = String(patch.area_name ?? '').trim()
      const surfacesRaw = Array.isArray(patch.surfaces) ? patch.surfaces : []
      const surfaces = surfacesRaw
        .map(s => {
          const o = s as Record<string, unknown>
          const kind = String(o.kind ?? '').trim() as SurfaceKind
          if (!VALID_SURFACE_KINDS.includes(kind)) return null
          return {
            kind,
            included: o.included === true,
            unit_price_per_sqm: Math.max(0, Math.round(safeNumber(o.unit_price_per_sqm, 0) * 100) / 100),
          }
        })
        .filter((s): s is { kind: SurfaceKind; included: boolean; unit_price_per_sqm: number } => !!s)
      return { area_name, surfaces }
    })
    .filter(p => p.area_name && p.surfaces.length > 0)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Anthropic is not configured' }, { status: 503 })
    const client = new Anthropic({ apiKey })

    const body = (await req.json().catch(() => ({}))) as {
      instruction?: string
      section?: string
      custom_section_title?: string
    }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    const customSectionTitleFromBody = typeof body.custom_section_title === 'string'
      ? body.custom_section_title.trim()
      : ''
    const sectionRaw = typeof body.section === 'string' ? body.section.trim() : 'outcomes'
    const section: QuoteSuggestSection = (VALID_SECTIONS as readonly string[]).includes(sectionRaw)
      ? (sectionRaw as QuoteSuggestSection)
      : 'outcomes'

    const { id: jobId } = await params
    const supabase = createServiceClient()
    const { data: job } = await supabase
      .from('jobs')
      .select('id, job_type, urgency, notes, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const ad = (job.assessment_data ?? null) as AssessmentData | null
    const sow = mergedSowCapture(ad)
    const capture = ad?.outcome_quote_capture
    const pricingLayout = derivePricingLayoutFromCapture(capture)
    const [photosRes, docsRes] = await Promise.all([
      supabase
        .from('photos')
        .select('id, file_url, area_ref, category, caption, include_in_composed_reports, uploaded_at')
        .eq('job_id', jobId)
        .order('uploaded_at', { ascending: false })
        .limit(150),
      supabase
        .from('documents')
        .select('id, type, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(80),
    ])

    const photoRows = (photosRes.data ?? []) as SuggestPhotoRow[]

    const context = {
      job: {
        id: job.id,
        job_type: job.job_type as JobType,
        urgency: job.urgency ?? null,
        notes: job.notes ?? '',
      },
      fast_quote: ad?.fast_quote?.enabled
        ? {
            enabled: true,
            transcript: ad.fast_quote.transcript ?? '',
            limitations_acknowledged: ad.fast_quote.limitations_acknowledged === true,
            updated_at: ad.fast_quote.updated_at ?? null,
          }
        : { enabled: false },
      pricing_layout: pricingLayout,
      global_mobilisation_fee: Math.max(0, Number(capture?.global_mobilisation_fee ?? 0)),
      global_surface_rate_per_m2: Math.max(0, Number(capture?.global_surface_rate_per_m2 ?? 0)),
      global_contents_rate_per_m3: Math.max(0, Number(capture?.global_contents_rate_per_m3 ?? 0)),
      custom_section_title: customSectionTitleFromBody
        || (capture?.custom_section_title ?? '').trim()
        || undefined,
      assessment_data: ad,
      scope_of_work: {
        objective: sow.objective,
        scope_work: sow.scope_work,
        methodology: sow.methodology,
        timeline: sow.timeline,
        safety: sow.safety,
        waste: sow.waste,
        exclusions: sow.exclusions,
        caveats: sow.caveats,
      },
      photo_metadata: photoRows.map(p => ({
        area_ref: (p.area_ref ?? '').trim() || null,
        category: p.category,
        caption: (p.caption ?? '').trim() || null,
      })),
      document_metadata: (docsRes.data ?? []).map((d: { id: string; type: string; created_at: string }) => ({
        id: d.id,
        type: d.type,
        created_at: d.created_at,
      })),
    }

    const userPayload = instruction
      ? JSON.stringify({ instruction, context })
      : JSON.stringify({ context })

    type ImageBlock = {
      type: 'image'
      source: { type: 'base64'; media_type: ImageMediaType; data: string }
    }
    type TextBlock = { type: 'text'; text: string }

    const visionPicks = pickPhotosForVision(photoRows)
    const fetched = await Promise.all(visionPicks.map(p => fetchImageBase64(p.file_url)))
    const imageBlocks: ImageBlock[] = []
    const imageRefLines: string[] = []
    fetched.forEach((img, idx) => {
      if (!img) return
      const photo = visionPicks[idx]
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type, data: img.data },
      })
      const area = (photo.area_ref ?? '').trim() || 'Unassigned'
      const cap = (photo.caption ?? '').trim()
      imageRefLines.push(
        `Image ${imageBlocks.length}: [${photo.category}] area="${area}"${cap ? ` · caption: ${cap}` : ''}`,
      )
    })

    const userContent: Array<ImageBlock | TextBlock> = [
      ...imageBlocks,
      {
        type: 'text',
        text: imageRefLines.length
          ? `${imageRefLines.join('\n')}\n\n${userPayload}`
          : userPayload,
      },
    ]

    const system =
      section === 'volume' ? SYSTEM_VOLUME
        : section === 'surface' ? SYSTEM_SURFACE
          : section === 'custom' ? SYSTEM_CUSTOM
            : SYSTEM

    const msg = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })

    const parsed = JSON.parse(jsonMatch[0]) as unknown

    if (section === 'volume') {
      const volume_rows = parseVolumeRows(parsed)
      const terms = parseSectionTerms((parsed as Record<string, unknown>).terms)
      if (!volume_rows.length && !terms) {
        return NextResponse.json({ error: 'AI did not return usable contents lines' }, { status: 500 })
      }
      return NextResponse.json({ volume_rows, ...(terms ? { terms } : {}) })
    }

    if (section === 'surface') {
      const surface_patches = parseSurfacePatches(parsed)
      const terms = parseSectionTerms((parsed as Record<string, unknown>).terms)
      if (!surface_patches.length && !terms) {
        return NextResponse.json({ error: 'AI did not return usable surface pricing' }, { status: 500 })
      }
      return NextResponse.json({ surface_patches, ...(terms ? { terms } : {}) })
    }

    if (section === 'custom') {
      const custom_rows = parseCustomRows(parsed)
      const terms = parseSectionTerms((parsed as Record<string, unknown>).terms)
      if (!custom_rows.length && !terms) {
        return NextResponse.json({ error: 'AI did not return usable custom scope lines' }, { status: 500 })
      }
      return NextResponse.json({ custom_rows, ...(terms ? { terms } : {}) })
    }

    const rows = parseRows(parsed)
    if (!rows.length) {
      return NextResponse.json({ error: 'AI did not return usable outcome rows' }, { status: 500 })
    }

    return NextResponse.json({ rows })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not suggest quote outcomes' },
      { status: 500 }
    )
  }
}
