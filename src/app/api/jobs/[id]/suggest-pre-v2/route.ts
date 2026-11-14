/*
 * POST /api/jobs/[id]/suggest-pre-v2
 *
 * Staff-only: draft a multi-part Post Remediation Evaluation. The report states
 * what was done, so each section is drafted from its verified record (Contents
 * Disposal Record, House Survey, Biohazard Cleaning Record) plus its technician
 * note; whole-job sections from the job context. Quotes are not facts here: only
 * Biohazard Cleaning on a fixed-price BCQ (no record) still reads its quote's
 * scope. Does NOT persist. NON-FINANCIAL — no money, no totals.
 *
 * Body: { pre: PostRemediationEvaluationV2, only?: 'a' | 'b' | 'c' }
 * `only` drafts just that part and skips the whole-job sections.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForEvidenceSuggest, inferCapturePhaseFromCategory, progressEvidencePhotos } from '@/lib/photoCapturePhase'
import { PRE_PART_DEFS, PRE_PART_KEYS, quoteScopeSummary } from '@/lib/postRemediationEvaluations'
import { prePartSources, preVerifiedRecords } from '@/lib/preVerifiedRecords'
import type { AssessmentData, JobType, Photo, PostRemediationEvaluationV2, PrePartKey } from '@/lib/types'

const SYSTEM = `You draft a Biohazard Remediation Completion Report for an Australian remediation company. The report is client-facing and states what was done.

You receive JOB_CONTEXT with:
- whole_job: TECHNICIAN_BRIEF for the whole job, job details, Scope of Work (including its exclusions), progress notes, room notes, progress photo metadata.
- sections: one entry per section to draft, keyed a/b/c, each with a title (Biohazard Cleaning, Contents Clearance, Surface Area Cleaning), its own technician_brief, and verified_records: figures recorded on site.
  - Contents Clearance verified_records: volume_m3 (counted volume removed), loads (date, vehicles, facility per load), facilities.
  - Surface Area Cleaning verified_records: rooms (name and measured m²), total_m2.
  - Biohazard Cleaning verified_records: zones (name and measured m²), atp_tests and lab_tests done.
  - Biohazard Cleaning may instead have verified_records null and agreed_scope (what the job covered, without figures).

VOICE & STYLE:
- First-person, plain tradesperson language ("we", "I"). Past tense. Factual, defensible, no embellishment.
- Australian English. Describe the actual works performed, not marketing copy.

RULES:
- Technician briefs, progress notes and photos are verified on site and are ground truth for what happened. Reflect confirmations, complexities, variations, and recommendations from them.
- Every figure (volumes, loads, areas, m², test counts, dates, facilities) comes only from verified_records or the technician briefs. If a figure is not there, leave it out. Never estimate, round up, or say a figure is "to be confirmed".
- Never mention quotes, quoted or estimated figures, scope assumptions, prices, rates, totals, or variance figures.
- Each section describes ONLY its own work. Do not repeat another section's work inside a section.
- Contents Clearance: what was removed, the counted volume, the number of loads and the vehicles used, containment, and the disposal facility from verified_records.
- Surface Area Cleaning: works room by room, using the rooms and measured m² from verified_records.
- Biohazard Cleaning: zone setup, contamination removal, treatment, biohazard waste containment, and the zones, measured m² and tests done from verified_records. With agreed_scope only, describe the works from the briefs and agreed_scope without any figures.
- Refer to another section by its title only, e.g. "Contents Clearance". Never write the word "Part" and never label sections with letters or numbers.
- Ground every statement in the provided data. Do NOT invent incidents, clearance/lab results, quantities, dates, products, or commitments.
- Use photo metadata only as internal context; never output raw metadata.
- Whole-job limitations: the Scope of Work exclusions when given, areas not accessed (from the briefs and notes), plus a standard disclaimer that no laboratory or clearance testing is implied beyond the tests recorded.

Respond ONLY with valid JSON (no markdown fences). Shape exactly:
{
  "executive_summary": "",
  "site_conditions": [""],
  "recommendations": [""],
  "compliance": "",
  "limitations": "",
  "parts": {
    "<section key a|b|c>": {
      "works": [{ "stage_name": "", "description": "" }],
      "methodology": "",
      "products": [{ "item_name": "", "usage_note": "" }],
      "waste": { "waste_type": "", "volume": "", "containment": "", "disposal": "" },
      "outcome_verification": ""
    }
  }
}
Include a "parts" entry for every section you were given, keyed by its key. If ONLY_PART is set, return only "parts" for that key and leave the whole-job fields empty.
Use empty string / empty array when there is nothing defensible from context. Never fabricate to fill a field.`

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
}

function asRows<K extends string>(v: unknown, keys: readonly K[]): Record<K, string>[] {
  if (!Array.isArray(v)) return []
  const out: Record<K, string>[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const row = {} as Record<K, string>
    let any = false
    for (const k of keys) {
      const s = typeof obj[k] === 'string' ? (obj[k] as string).trim() : ''
      row[k] = s
      if (s) any = true
    }
    if (any) out.push(row)
  }
  return out
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** A fixed-price BCQ's scope without its estimated figures. */
function agreedScope(summary: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!summary) return null
  const names = (v: unknown) => (Array.isArray(v) ? v.map(r => (r as { name: string }).name) : undefined)
  const out: Record<string, unknown> = { ...summary, rooms: names(summary.rooms), secondary_rooms: names(summary.secondary_rooms) }
  for (const k of ['estimated_m2', 'estimated_m3', 'estimated_tonnes', 'assumptions']) delete out[k]
  return out
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json({ error: 'Organisation inactive or you have no active organisation' }, { status: 403 })
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local, then restart the dev server.' },
        { status: 503 },
      )
    }

    const { id: jobId } = await params
    const body = (await req.json().catch(() => ({}))) as { pre?: PostRemediationEvaluationV2; only?: string }
    const pre = body.pre
    if (!pre || typeof pre !== 'object' || !pre.parts) {
      return NextResponse.json({ error: 'pre is required' }, { status: 400 })
    }
    const only = PRE_PART_KEYS.includes(body.only as PrePartKey) ? (body.only as PrePartKey) : undefined

    const supabase = createServiceClient()
    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select('id, job_type, site_address, urgency, client_name, client_organization_name, notes, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const job = jobRow as {
      job_type: JobType
      site_address: string
      urgency: string | null
      client_name: string
      client_organization_name: string | null
      notes: string | null
      assessment_data: AssessmentData | null
    }
    const ad = job.assessment_data
    const records = preVerifiedRecords(ad)
    const sources = prePartSources(ad, records)
    const partKeys = (only ? [only] : PRE_PART_KEYS).filter(k => pre.parts[k]?.enabled && sources[k])
    if (partKeys.length === 0) {
      return NextResponse.json({ error: 'Switch on at least one section that has its record first.' }, { status: 400 })
    }

    const fixedPriceQuoteId = partKeys.includes('a') && sources.a === 'fixed_price' ? pre.parts.a.source_quote_document_id : undefined
    const [quotesRes, sowRes, photosRes, pnRes, prnRes] = await Promise.all([
      fixedPriceQuoteId
        ? supabase.from('documents').select('id, type, content').eq('job_id', jobId).eq('id', fixedPriceQuoteId)
        : Promise.resolve({ data: [] as { id: string; type: string; content: unknown }[] }),
      supabase
        .from('documents')
        .select('content')
        .eq('job_id', jobId)
        .eq('type', 'sow')
        .order('created_at', { ascending: false })
        .limit(1),
      fetchPhotosForEvidenceSuggest(supabase, jobId),
      supabase
        .from('progress_notes')
        .select('room, body')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('progress_room_notes')
        .select('room_name, note')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .order('room_name', { ascending: true }),
    ])

    const fixedPriceQuote = (quotesRes.data ?? []).find(d => d.type === PRE_PART_DEFS.a.docType)
    const parts = partKeys.map(k => {
      const part = pre.parts[k]
      return {
        key: k,
        title: PRE_PART_DEFS[k].title,
        technician_brief: (part.generation_brief ?? '').trim() || null,
        verified_records: records[k],
        ...(k === 'a' && sources.a === 'fixed_price'
          ? { agreed_scope: agreedScope(quoteScopeSummary(fixedPriceQuote?.content as Record<string, unknown> | undefined)) }
          : {}),
      }
    })

    const photos = (photosRes.data ?? []) as Pick<Photo, 'id' | 'area_ref' | 'category' | 'caption' | 'capture_phase'>[]
    const sow = mergedSowCapture(ad)
    const sowDocExclusions = asString(asObject(sowRes.data?.[0]?.content).exclusions).replace(/<[^>]+>/g, ' ').trim()
    const wholeJob = {
      technician_brief: (pre.generation_brief ?? '').trim() || null,
      attendance: (pre.attendance ?? '').trim() || null,
      job: {
        job_type: job.job_type,
        site_address: job.site_address,
        urgency: job.urgency,
        client_name: job.client_name,
        client_organization_name: (job.client_organization_name ?? '').trim() || null,
        notes: job.notes,
      },
      areas: (ad?.areas ?? []).map(a => (a.name || '').trim()).filter(Boolean),
      sow_planned: {
        objective: sow.objective.trim(),
        scope_work: sow.scope_work.trim(),
        methodology: sow.methodology.trim(),
        exclusions: [sow.exclusions.trim(), sowDocExclusions].filter((s, i, all) => s && all.indexOf(s) === i),
        caveats: sow.caveats.trim(),
      },
      progress_notes: (pnRes.data ?? []).map((n: { room: string; body: string }) => ({ room: (n.room || '').trim(), body: (n.body || '').trim() })),
      progress_room_notes: (prnRes.data ?? []).map((n: { room_name: string; note: string }) => ({
        room_name: (n.room_name || '').trim(),
        note: (n.note || '').trim(),
      })),
      progress_photo_metadata: progressEvidencePhotos(photos, ad?.areas ?? [], [...(pre.before_photo_ids ?? []), ...(pre.after_photo_ids ?? []), ...(pre.report_images_chosen ? pre.report_image_ids ?? [] : [])]).map(p => ({
        area_ref: (p.area_ref || '').trim() || null,
        caption: (p.caption || '').trim() || null,
        capture_phase: p.capture_phase != null ? p.capture_phase : inferCapturePhaseFromCategory(p.category),
      })),
    }

    const hasSignal =
      !!wholeJob.technician_brief ||
      parts.some(p => p.technician_brief || p.verified_records || p.agreed_scope) ||
      wholeJob.progress_notes.some(n => n.body) ||
      wholeJob.progress_room_notes.some(n => n.note) ||
      wholeJob.progress_photo_metadata.length > 0 ||
      !!wholeJob.sow_planned.objective ||
      !!wholeJob.sow_planned.scope_work ||
      (job.notes ?? '').trim().length > 0
    if (!hasSignal) {
      return NextResponse.json(
        { error: 'Add a technician note, a record, or progress notes or photos before drafting.' },
        { status: 400 },
      )
    }

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 16384,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `ONLY_PART: ${only ?? 'none'}\n\nDraft the completion report from this data:\n\n${JSON.stringify({ whole_job: wholeJob, sections: parts }, null, 2)}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
    }

    const root = asObject(parsed)
    const rawParts = asObject(root.parts)
    const outParts: Record<string, unknown> = {}
    for (const k of partKeys) {
      const p = asObject(rawParts[k])
      const waste = asObject(p.waste)
      outParts[k] = {
        works_rows: asRows(p.works, ['stage_name', 'description'] as const),
        methodology: asString(p.methodology),
        products_rows: asRows(p.products, ['item_name', 'usage_note'] as const),
        waste: {
          waste_type: asString(waste.waste_type),
          volume: asString(waste.volume),
          containment: asString(waste.containment),
          disposal: asString(waste.disposal),
        },
        outcome_verification: asString(p.outcome_verification),
      }
    }

    if (only) return NextResponse.json({ parts: outParts })
    return NextResponse.json({
      executive_summary: asString(root.executive_summary),
      site_conditions: asStringArray(root.site_conditions),
      recommendations: asStringArray(root.recommendations),
      compliance: asString(root.compliance),
      limitations: asString(root.limitations),
      parts: outParts,
    })
  } catch (e: unknown) {
    console.error('[suggest-pre-v2]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Suggest failed' }, { status: 500 })
  }
}
