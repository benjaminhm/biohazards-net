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
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForEvidenceSuggest, inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'
import { resolveQuotedLineContext } from '@/lib/postRemediationEvaluations'
import type { AssessmentData, JobType, Photo, QuoteContent } from '@/lib/types'

const SYSTEM = `You draft a Post Remediation Evaluation (PRE) for Australian biohazard remediation staff (internal use only).

A PRE is a NON-FINANCIAL completion evaluation built against an agreed Quote/Estimate. It records, in natural professional prose, what was actually done against each quoted scope line, plus an overall opening and closing.

You receive JOB_CONTEXT: the quoted scope lines (the agreed work), Scope of Work, progress notes, room notes, progress photo metadata, and any execute-phase silos.

RULES:
- Ground every statement in the provided data. Do NOT invent incidents, clearance results, legal commitments, dollar amounts, or client quotes not supported by the JSON.
- NEVER include money, prices, totals, or variance figures — the PRE is non-financial.
- Do NOT decide whether a line was done / varied / not done — that is a human decision. Just describe what the notes/photos indicate for that scope item, neutrally.
- Write clear, human, professional prose. Australian English.
- Use photo metadata only as internal context; do not output raw metadata (category labels, capture_phase, timestamps, file IDs).

Respond ONLY with valid JSON (no markdown fences). Shape exactly:
{
  "opening": "",
  "closing": "",
  "line_notes": { "<source_line_id>": "" },
  "area_notes": { "<area_name>": "" }
}

Field intent:
- opening: short overview of the job and how it went.
- closing: outcome statement, residuals, limitations not contradicted by data.
- line_notes: one short note per quoted scope line id provided, describing what was done for that item. Use the exact source_line_id keys provided. Omit keys you have nothing defensible for.
- area_notes: one short narrative per area name provided. Omit keys with nothing defensible.

Use empty string / omit keys when there is truly nothing defensible from context.`

function isProgressEvidencePhoto(p: Pick<Photo, 'capture_phase' | 'category'>): boolean {
  if (p.capture_phase === 'progress') return true
  if (p.capture_phase === 'assessment') return false
  return p.category === 'during' || p.category === 'after'
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[k] = val
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
    const body = (await req.json().catch(() => ({}))) as { preId?: string }
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

    const pre = (ad?.post_remediation_evaluations ?? []).find(p => p.id === preId)
    if (!pre) return NextResponse.json({ error: 'PRE not found on this job' }, { status: 404 })

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

    const jobContext = {
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
            'Add job notes, progress notes, room notes, progress photos, or quoted scope before drafting.',
        },
        { status: 400 },
      )
    }

    const userBlock = JSON.stringify(jobContext, null, 2)

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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

    return NextResponse.json({
      opening: asString(root.opening),
      closing: asString(root.closing),
      line_notes: asStringMap(root.line_notes),
      area_notes: asStringMap(root.area_notes),
    })
  } catch (e: unknown) {
    console.error('[suggest-pre]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Suggest failed' }, { status: 500 })
  }
}
