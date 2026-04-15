/*
 * POST /api/jobs/[id]/suggest-completion-report-capture
 *
 * Staff-only: draft completion_report_capture + per_execute_capture from job context (SOW,
 * progress notes, room notes, progress photo metadata). Does not persist.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForEvidenceSuggest, inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'
import { normalizeCompletionReportCaptureDraft } from '@/lib/completionReportCapture'
import { normalizePerExecuteCaptureDraft } from '@/lib/perExecuteCapture'
import type { AssessmentData, CompletionReportCapture, JobType, PerExecuteCapture, Photo } from '@/lib/types'

const SYSTEM = `You draft completion report and execute-phase capture fields for Australian biohazard remediation staff (internal use only).

You receive JOB_CONTEXT: structured job data, Scope of Work (planned), progress notes, room notes, progress photo metadata, and any existing staff capture (may be empty).

RULES:
- Ground every statement in the provided data. Do NOT invent incidents, clearance results, legal commitments, or client quotes not supported by the JSON.
- You MAY use standard industry-typical language when it clearly follows from the notes and job type described.
- Write clear, professional prose suitable for a completion report. Align each JSON key to its purpose (see user message).
- Australian English.

Respond ONLY with valid JSON (no markdown fences). Shape exactly:
{
  "completion_report_capture": {
    "executive_summary": "",
    "site_conditions": "",
    "works_carried_out": "",
    "methodology": "",
    "products_used": "",
    "waste_disposal": "",
    "photo_record": "",
    "outcome": "",
    "technician_signoff": ""
  },
  "per_execute_capture": {
    "recommendations": "",
    "quality_checks": "",
    "waste_manifest_notes": ""
  }
}

Field intent:
- executive_summary: High-level overview (client, site, scope intent) from context.
- site_conditions: Condition as found, access, constraints if inferable from notes.
- works_carried_out: What was done, from progress notes/photos where possible.
- methodology: Planned or actual approach; tie to SOW methodology when present.
- products_used: Chemicals, equipment, PPE if inferable; else brief neutral line or empty.
- waste_disposal: Waste/manifest narrative for the report section.
- photo_record: Summarise progress evidence photos (categories, areas) from metadata.
- outcome: Completion statement, limitations/exclusions not contradicted by data.
- technician_signoff: Empty unless you have a real name/role in context; usually leave "".
- recommendations / quality_checks / waste_manifest_notes: PER silos — client follow-up, QC/verification, waste detail.

Use empty string for a key only when there is truly nothing defensible from context.`

function isProgressEvidencePhoto(p: Pick<Photo, 'capture_phase' | 'category'>): boolean {
  if (p.capture_phase === 'progress') return true
  if (p.capture_phase === 'assessment') return false
  return p.category === 'during' || p.category === 'after'
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

    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select(
        'id, job_type, site_address, urgency, client_name, client_organization_name, client_contact_role, client_contact_relationship, insurance_claim_ref, notes, assessment_data',
      )
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (jobErr) throw jobErr
    if (!jobRow) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobRow as {
      id: string
      job_type: JobType
      site_address: string
      urgency: string | null
      client_name: string
      client_organization_name: string | null
      client_contact_role: string | null
      client_contact_relationship: string | null
      insurance_claim_ref: string | null
      notes: string | null
      assessment_data: AssessmentData | null
    }
    const ad = job.assessment_data

    const [photosRes, pnRes, prnRes] = await Promise.all([
      supabase
        .from('photos')
        .select('area_ref, category, caption, capture_phase')
        .eq('job_id', jobId),
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
        client_contact_role: (job.client_contact_role ?? '').trim() || null,
        client_contact_relationship: (job.client_contact_relationship ?? '').trim() || null,
        insurance_claim_ref: (job.insurance_claim_ref ?? '').trim() || null,
        notes: job.notes,
      },
      sow_planned: {
        objective: sow.objective.trim(),
        scope_work: sow.scope_work.trim(),
        timeline: sow.timeline.trim(),
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
      existing_completion_report_capture: ad?.completion_report_capture ?? null,
      existing_per_execute_capture: ad?.per_execute_capture ?? null,
    }

    const hasSignal =
      jobContext.progress_notes.some(n => n.body) ||
      jobContext.progress_room_notes.some(n => n.note) ||
      progressPhotos.length > 0 ||
      sow.objective.trim() ||
      sow.scope_work.trim() ||
      (job.notes ?? '').trim().length > 0

    if (!hasSignal) {
      return NextResponse.json(
        {
          error:
            'Add job notes, progress notes, room notes, progress photos (during/after), or Scope of Work capture before suggesting.',
        },
        { status: 400 }
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
          content: `Draft completion report and PER fields from the following data:\n\n${userBlock}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
    }

    const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const crRaw = root.completion_report_capture
    const perRaw = root.per_execute_capture

    const completion_report_capture: CompletionReportCapture = normalizeCompletionReportCaptureDraft(crRaw)
    const per_execute_capture: PerExecuteCapture = normalizePerExecuteCaptureDraft(perRaw)

    return NextResponse.json({ completion_report_capture, per_execute_capture })
  } catch (e: unknown) {
    console.error('[suggest-completion-report-capture]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest failed' },
      { status: 500 }
    )
  }
}
