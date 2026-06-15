/*
 * POST /api/jobs/[id]/suggest-pre
 *
 * Staff-only: draft Post Remediation Evaluation prose from job context + the
 * PRE's source quote document. Returns opening/closing narrative, per-line notes
 * (keyed by source_line_id), and per-area intros. Does NOT set status pills
 * (human-only) and does NOT persist. NON-FINANCIAL — no money, no totals.
 *
 * Body: { preId: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForEvidenceSuggest, inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'
import { resolveQuotedLineContext } from '@/lib/postRemediationEvaluations'
import type { AssessmentData, JobType, Photo, PostRemediationEvaluation, QuoteContent } from '@/lib/types'

const SYSTEM = `You draft a Biohazard Remediation Completion Report for an Australian remediation company. The report is client-facing.

You receive JOB_CONTEXT: a TECHNICIAN_BRIEF (the attending technician's first-hand account), the quoted/agreed scope, Scope of Work, progress notes, room notes, and progress photo metadata.

VOICE & STYLE:
- First-person, plain tradesperson language ("we", "I"). Past tense. Factual, defensible, no embellishment.
- Australian English. Professional but human — describe the actual works performed, not marketing copy.

RULES:
- TECHNICIAN_BRIEF is authoritative ground truth for what actually happened. Reflect confirmations, complexities, variations, and recommendations from it.
- Ground every statement in the provided data. Do NOT invent incidents, clearance/lab results, quantities, dates, products, or commitments not supported by the JSON.
- NEVER include money, prices, totals, or variance figures — this report is non-financial.
- Use photo metadata only as internal context; never output raw metadata (category labels, capture_phase, timestamps, file IDs).

Respond ONLY with valid JSON (no markdown fences). Shape exactly:
{
  "executive_summary": "",
  "site_conditions": [""],
  "works": [{ "stage_name": "", "description": "" }],
  "methodology": "",
  "products": [{ "item_name": "", "usage_note": "" }],
  "waste": { "waste_type": "", "volume": "", "containment": "", "disposal": "" },
  "outcome_verification": "",
  "recommendations": [""],
  "compliance": "",
  "limitations": ""
}

Field intent:
- executive_summary: 2-4 sentences — site attended, scope per the linked quote, rooms/areas covered, duration, and headline waste volume if known.
- site_conditions: bullet strings — pre-existing conditions / staging observed on arrival, before any work began.
- works: rows of work carried out, per authorised scope. stage_name is a short stage (e.g. Mobilisation, Zone setup, Kitchen, Floor scrubbing, Sanitiser, Final check); description is a first-person past-tense action description.
- methodology: prose — zone-based approach, product application method (dilution/dwell time if known), and an explicit out-of-scope statement (e.g. structural/HVAC/appliance work not included).
- products: rows of products & equipment used. usage_note e.g. "Used per manufacturer instructions". Only items supported by context.
- waste: waste_type; volume (e.g. "Approximately X m³"); containment; disposal. Leave a field "" if unknown.
- outcome_verification: prose — final walkthrough against quoted scope, compliance-with-standards statement, handback confirmation.
- recommendations: bullet strings — issues noted on site, outside the cleaning scope, flagged for the client to action (issue + impact + who must address it).
- compliance: prose — standard-procedures statement + disposal-compliance statement.
- limitations: prose — scope boundary restated from the linked quote, unaccessed/uncleaned areas and why, explicit exclusions, and a testing/lab disclaimer.

Use empty string / empty array when there is truly nothing defensible from context. Never fabricate to fill a field.`

function isProgressEvidencePhoto(p: Pick<Photo, 'capture_phase' | 'category'>): boolean {
  if (p.capture_phase === 'progress') return true
  if (p.capture_phase === 'assessment') return false
  return p.category === 'during' || p.category === 'after'
}

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

    const { id: jobId } = await params
    const body = (await req.json().catch(() => ({}))) as {
      preId?: string
      pre?: PostRemediationEvaluation
    }
    const preId = (body.preId ?? '').trim()
    if (!preId) return NextResponse.json({ error: 'preId is required' }, { status: 400 })

    const supabase = createServiceClient()

    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select(
        'id, job_type, site_address, urgency, client_name, client_organization_name, client_contact_role, notes, assessment_data',
      )
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const job = jobRow as {
      id: string
      job_type: JobType
      site_address: string
      urgency: string | null
      client_name: string
      client_organization_name: string | null
      client_contact_role: string | null
      notes: string | null
      assessment_data: AssessmentData | null
    }
    const ad = job.assessment_data

    // Prefer the draft sent in the request body (lets Generate run before the
    // first save); fall back to the persisted PRE for older callers.
    const bodyPre =
      body.pre && typeof body.pre === 'object' && body.pre.id === preId ? body.pre : null
    const pre = bodyPre ?? (ad?.post_remediation_evaluations ?? []).find(p => p.id === preId)
    if (!pre) return NextResponse.json({ error: 'PRE not found on this job' }, { status: 400 })

    // Resolve the source quote document so we can describe each quoted scope line.
    let sourceContent: Partial<QuoteContent> | undefined
    if (pre.source_quote_document_id) {
      const { data: docRow } = await supabase
        .from('documents')
        .select('content')
        .eq('id', pre.source_quote_document_id)
        .maybeSingle()
      sourceContent = (docRow?.content ?? undefined) as Partial<QuoteContent> | undefined
    }

    const quotedLines = pre.scope_lines
      .filter(l => l.kind === 'from_quote')
      .map(l => {
        if (l.kind !== 'from_quote') return null
        const ctx = resolveQuotedLineContext(sourceContent, l.source_line_id)
        return {
          source_line_id: l.source_line_id,
          section: ctx?.sectionLabel ?? null,
          title: ctx?.title ?? l.source_line_id,
          detail: ctx?.detail ?? null,
        }
      })
      .filter(Boolean)

    const areaNames = (ad?.areas ?? []).map(a => (a.name || '').trim()).filter(Boolean)

    const [photosRes, pnRes, prnRes] = await Promise.all([
      fetchPhotosForEvidenceSuggest(supabase, jobId),
      supabase
        .from('progress_notes')
        .select('room, body, created_at')
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

    const photos = (photosRes.data ?? []) as Pick<Photo, 'area_ref' | 'category' | 'caption' | 'capture_phase'>[]
    const progressPhotos = photos.filter(isProgressEvidencePhoto).map(p => ({
      area_ref: (p.area_ref || '').trim() || null,
      category: p.category,
      caption: (p.caption || '').trim() || null,
      capture_phase: p.capture_phase != null ? p.capture_phase : inferCapturePhaseFromCategory(p.category),
    }))

    const sow = mergedSowCapture(ad)

    const technicianBrief = (pre.generation_brief ?? '').trim()

    const jobContext = {
      technician_brief: technicianBrief || null,
      job: {
        job_type: job.job_type,
        site_address: job.site_address,
        urgency: job.urgency,
        client_name: job.client_name,
        client_organization_name: (job.client_organization_name ?? '').trim() || null,
        notes: job.notes,
      },
      quoted_scope_lines: quotedLines,
      areas: areaNames,
      sow_planned: {
        objective: sow.objective.trim(),
        scope_work: sow.scope_work.trim(),
        methodology: sow.methodology.trim(),
      },
      progress_notes: (pnRes.data ?? []).map((n: { room: string; body: string }) => ({
        room: (n.room || '').trim(),
        body: (n.body || '').trim(),
      })),
      progress_room_notes: (prnRes.data ?? []).map((n: { room_name: string; note: string }) => ({
        room_name: (n.room_name || '').trim(),
        note: (n.note || '').trim(),
      })),
      progress_photo_metadata: progressPhotos,
      per_execute_capture: ad?.per_execute_capture ?? null,
    }

    const hasSignal =
      technicianBrief.length > 0 ||
      jobContext.progress_notes.some(n => n.body) ||
      jobContext.progress_room_notes.some(n => n.note) ||
      progressPhotos.length > 0 ||
      sow.objective.trim() ||
      sow.scope_work.trim() ||
      quotedLines.length > 0 ||
      (job.notes ?? '').trim().length > 0

    if (!hasSignal) {
      return NextResponse.json(
        {
          error:
            'Add a technician note, job notes, progress notes, room notes, progress photos, or quoted scope before drafting.',
        },
        { status: 400 },
      )
    }

    const userBlock = JSON.stringify(jobContext, null, 2)

    const message = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 16384,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Draft a Post Remediation Evaluation from the following data:\n\n${userBlock}`,
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

    const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const wasteRaw = root.waste && typeof root.waste === 'object' ? (root.waste as Record<string, unknown>) : {}

    return NextResponse.json({
      executive_summary: asString(root.executive_summary),
      site_conditions: asStringArray(root.site_conditions),
      works: asRows(root.works, ['stage_name', 'description'] as const),
      methodology: asString(root.methodology),
      products: asRows(root.products, ['item_name', 'usage_note'] as const),
      waste: {
        waste_type: asString(wasteRaw.waste_type),
        volume: asString(wasteRaw.volume),
        containment: asString(wasteRaw.containment),
        disposal: asString(wasteRaw.disposal),
      },
      outcome_verification: asString(root.outcome_verification),
      recommendations: asStringArray(root.recommendations),
      compliance: asString(root.compliance),
      limitations: asString(root.limitations),
    })
  } catch (e: unknown) {
    console.error('[suggest-pre]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Suggest failed' }, { status: 500 })
  }
}
