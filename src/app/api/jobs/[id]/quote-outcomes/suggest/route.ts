import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import type { AssessmentData, JobType, OutcomeQuoteRow } from '@/lib/types'

const SYSTEM = `You draft outcome-based quote rows for Australian biohazard remediation jobs.

You will receive three things:
1. A structured "context" object with all known facts about the job (assessment data, scope of work, photos, documents). This is your ONLY data source — never invent rooms, hazards, or scope that do not appear in the context.
2. An optional "instruction" string from the staff member telling you how to structure the quote (e.g. phasing, grouping, pricing approach). Follow it closely when provided; if empty, use your best professional judgment.
3. Zero or more image attachments — these are job photos (assessment/before stage, including any client-supplied photos attached to a Fast Quote brief). Use them as primary visual evidence: confirm rooms/areas, surface contamination, materials, access constraints, and PPE/waste implications you can actually see. Do NOT invent details that are not visible in the photos or stated in the context. If a visible condition is uncertain, capture it as an assumption or exclusion rather than a confirmed scope item.

Return ONLY valid JSON with this shape:
{
  "rows": [
    {
      "areas": ["Kitchen", "Hallway"],
      "outcome_title": "",
      "outcome_description": "",
      "acceptance_criteria": "",
      "price": 0,
      "status": "suggested",
      "included": [""],
      "excluded": [""],
      "assumptions": [""],
      "verification_method": "",
      "metrics": [{"label":"", "value":""}]
    }
  ]
}

Rules:
- Outcome-first language (value/results), not labour breakdown.
- Keep room/area context in each row.
- No graphic detail; professional scientific wording.
- status must be "suggested" for every row.
- price must be >= 0 and represented as number.
- All facts (areas, hazards, contamination, PPE, waste, methodology) must come from the context object. Do not hallucinate data.
- The instruction steers structure and emphasis, not facts.
- If context.fast_quote.enabled is true, FAST QUOTE MODE applies:
  - Treat the quote as limited-information and possibly sight-unseen.
  - Do not imply a full site inspection, site verification, or confirmed contamination unless explicitly stated in context.
  - Expect sparse information and draft usable outcomes from the voice brief, but keep unknowns as assumptions or staff-pricing items.
  - Use conservative, conditional wording with strong exclusions, concealed-condition caveats, access limitations, and variation rights.
  - If pricing is not stated or clearly inferable from staff instruction, set price to 0 rather than inventing an amount.
  - Add assumption/exclusion lines that make the limited-information basis clear.
`

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

function parseRows(raw: unknown): OutcomeQuoteRow[] {
  const root = raw as { rows?: Array<Record<string, unknown>> }
  const rows = root.rows ?? []
  return rows
    .map((row, idx) => {
      const areasRaw = Array.isArray(row.areas) ? row.areas : []
      const includedRaw = Array.isArray(row.included) ? row.included : []
      const excludedRaw = Array.isArray(row.excluded) ? row.excluded : []
      const assumptionsRaw = Array.isArray(row.assumptions) ? row.assumptions : []
      const metricsRaw = Array.isArray(row.metrics) ? row.metrics : []
      return {
        id: `suggested_${idx + 1}`,
        areas: areasRaw.map(a => String(a ?? '').trim()).filter(Boolean),
        outcome_title: String(row.outcome_title ?? '').trim(),
        outcome_description: String(row.outcome_description ?? '').trim(),
        acceptance_criteria: String(row.acceptance_criteria ?? '').trim(),
        price: Math.max(0, Math.round(safeNumber(row.price, 0) * 100) / 100),
        status: 'suggested',
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Anthropic is not configured' }, { status: 503 })
    const client = new Anthropic({ apiKey })

    const body = (await req.json().catch(() => ({}))) as { instruction?: string }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

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

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })

    const parsed = JSON.parse(jsonMatch[0]) as unknown
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
