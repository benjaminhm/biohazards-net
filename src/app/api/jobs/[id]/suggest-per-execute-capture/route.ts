/*
 * POST /api/jobs/[id]/suggest-per-execute-capture
 *
 * Staff-only: draft PerExecuteCapture prose from execute-phase context (progress notes,
 * room notes, progress photos metadata, SOW summary). Does not persist.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForEvidenceSuggest, inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'
import { normalizePerExecuteCaptureDraft } from '@/lib/perExecuteCapture'
import type { AssessmentData, JobType, PerExecuteCapture, Photo } from '@/lib/types'

const SYSTEM = `You draft execute-phase capture fields for Australian biohazard remediation staff (internal use only).

You receive EXECUTE_CONTEXT: structured job data, Scope of Work summary (planned), progress notes, room notes, and progress photo metadata.

RULES:
- Ground every statement in the provided data. Do NOT invent incidents, clearance results, legal commitments, or client quotes not supported by the JSON.
- You MAY use standard industry-typical language when it clearly follows from the notes and job type described.
- Write clear, professional prose suitable for a completion report and internal records.
- Australian English.

Respond ONLY with valid JSON (no markdown fences) matching exactly these keys:
{"recommendations":"","quality_checks":"","waste_manifest_notes":""}

Each value is a paragraph or short bullet-style prose as appropriate. Use empty string only if there is truly nothing to say from context.`

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
    const existing = ad?.per_execute_capture

    const executeContext = {
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
      existing_per_execute: existing ?? null,
    }

    const hasSignal =
      executeContext.progress_notes.some(n => n.body) ||
      executeContext.progress_room_notes.some(n => n.note) ||
      progressPhotos.length > 0 ||
      sow.objective.trim() ||
      sow.scope_work.trim()

    if (!hasSignal) {
      return NextResponse.json(
        {
          error:
            'Add progress notes, room notes, progress photos (during/after), or Scope of Work capture before suggesting execute silos.',
        },
        { status: 400 }
      )
    }

    const userBlock = JSON.stringify(executeContext, null, 2)

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Draft execute-phase capture fields from the following data:\n\n${userBlock}`,
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

    const suggestions: PerExecuteCapture = normalizePerExecuteCaptureDraft(parsed)

    return NextResponse.json({ suggestions })
  } catch (e: unknown) {
    console.error('[suggest-per-execute-capture]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest failed' },
      { status: 500 }
    )
  }
}
