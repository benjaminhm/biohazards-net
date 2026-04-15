import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForCaseStudySuggest, inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'
import type { AssessmentData, JobType } from '@/lib/types'

type GenerateMode = 'written' | 'video'

interface WrittenCapturePayload {
  case_title: string
  case_type: string
  region_context: string
  urgency_level: string
  call_context_summary: string
  caller_presentation: string
  constraints_at_intake: string
  initial_objective: string
  iaq_findings: string
  plan_rationale: string
  execution_sequence: string
  review_verification: string
  hazard_profile: string
  control_measures: string
  outcome_summary: string
  handover_summary: string
  key_lessons: string
  training_takeaways: string
}

interface VideoCapturePayload {
  target_platform: 'youtube_long' | 'youtube_short' | 'training_portal_video'
  duration_target_sec: number
  hook: string
  setup: string
  method: string
  outcome: string
  lessons: string
  cta: string
  scenes: string
}

const WRITTEN_SYSTEM = `You draft an INTERNAL written training case study for Australian biohazard remediation staff.

You receive FULL_JOB_CONTEXT (the entire job file context: job, assessment data, notes, progress, document metadata, quote items), plus existing form capture.

MANDATORY RULES:
- No graphic details. Use scientific, objective, non-sensational language.
- Remove direct identifiers in output (names, exact addresses, phone/email, claim numbers). Use role-level or generalized references.
- Ground statements in provided data. Do not invent measurements, incidents, approvals, or outcomes.
- Keep this internal and HITL-ready (staff still review and approve).
- Australian English.

Respond with valid JSON only (no markdown) exactly this shape:
{
  "case_study": {
    "meta": { "id": "", "created_at": "", "job_id": "", "company": "", "author": "" },
    "snapshot": { "title": "", "subtitle": "", "client_type": "", "location": "", "job_type": "", "duration": "", "headline_result": "" },
    "challenge": { "summary": "", "details": "", "risks_or_hazards": [], "regulatory_requirements": [], "why_professional_needed": "" },
    "solution": {
      "approach_summary": "",
      "steps": [{ "step_number": 1, "title": "", "description": "" }],
      "equipment_used": [],
      "chemicals_or_products_used": [],
      "safety_protocols": [],
      "certifications_applied": []
    },
    "results": {
      "outcome_summary": "",
      "metrics": [{ "label": "", "value": "" }],
      "before_after": { "before": "", "after": "" },
      "clearance_testing": "",
      "compliance_status": ""
    },
    "testimonial": { "quote": "", "client_name": "", "client_role": "", "permission_granted": false },
    "key_takeaways": [],
    "media": { "photos_before": [], "photos_after": [], "documents_referenced": [] }
  },
  "written_draft": ""
}`

const VIDEO_SYSTEM = `You draft an INTERNAL video narrative case study script for Australian biohazard remediation training.

You receive FULL_JOB_CONTEXT, WRITTEN_CAPTURE, and existing video form fields.

MANDATORY RULES:
- No graphic detail; scientifically descriptive and non-sensational.
- Remove direct identifiers (names, exact addresses, contact details, claim refs).
- Base script on provided context and written capture only.
- Style for spoken narrative suitable for YouTube/training audiences.
- Australian English.

Respond with valid JSON only (no markdown) exactly this shape:
{
  "video_capture": {
    "target_platform": "youtube_long",
    "duration_target_sec": 480,
    "hook": "",
    "setup": "",
    "method": "",
    "outcome": "",
    "lessons": "",
    "cta": "",
    "scenes": ""
  },
  "video_draft": ""
}`

function extractJson(rawText: string): Record<string, unknown> | null {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    const body = (await req.json()) as {
      mode?: GenerateMode
      written_capture?: Partial<WrittenCapturePayload>
      video_capture?: Partial<VideoCapturePayload>
    }
    const mode: GenerateMode = body.mode === 'video' ? 'video' : 'written'

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select(
        'id, status, job_type, urgency, site_address, client_name, client_phone, client_email, client_organization_name, client_contact_role, client_contact_relationship, insurance_claim_ref, notes, assessment_data, created_at, updated_at',
      )
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const job = jobRow as {
      id: string
      status: string
      job_type: JobType
      urgency: string | null
      site_address: string
      client_name: string
      client_phone: string | null
      client_email: string | null
      client_organization_name: string | null
      client_contact_role: string | null
      client_contact_relationship: string | null
      insurance_claim_ref: string | null
      notes: string | null
      assessment_data: AssessmentData | null
      created_at: string
      updated_at: string
    }

    const [photosRes, docsRes, pnRes, prnRes, liRes, bundlesRes] = await Promise.all([
      fetchPhotosForCaseStudySuggest(supabase, jobId),
      supabase
        .from('documents')
        .select('id, type, created_at, file_url')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('progress_notes')
        .select('room, body, created_at')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(120),
      supabase
        .from('progress_room_notes')
        .select('room_name, note')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .order('room_name', { ascending: true })
        .limit(120),
      supabase
        .from('quote_line_items')
        .select('room_name, description, qty, unit, rate, total')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('room_name', { ascending: true })
        .limit(300),
      supabase
        .from('document_bundles')
        .select('id, title, part_document_ids, created_at')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(30),
    ])

    const ad = job.assessment_data
    const sow = mergedSowCapture(ad)

    const fullJobContext = {
      job: {
        id: job.id,
        status: job.status,
        job_type: job.job_type,
        urgency: job.urgency,
        site_address: job.site_address,
        client_name: job.client_name,
        client_phone: job.client_phone,
        client_email: job.client_email,
        client_organization_name: job.client_organization_name,
        client_contact_role: job.client_contact_role,
        client_contact_relationship: job.client_contact_relationship,
        insurance_claim_ref: job.insurance_claim_ref,
        notes: job.notes,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
      assessment_data: ad,
      sow_capture: sow,
      photos: (photosRes.data ?? []).map((p: { area_ref: string | null; category: string; caption: string | null; capture_phase?: string | null; uploaded_at: string }) => ({
        area_ref: (p.area_ref ?? '').trim() || null,
        category: p.category,
        caption: (p.caption ?? '').trim() || null,
        capture_phase: p.capture_phase != null && p.capture_phase !== '' ? p.capture_phase : inferCapturePhaseFromCategory(p.category),
        uploaded_at: p.uploaded_at,
      })),
      documents: (docsRes.data ?? []).map((d: { id: string; type: string; created_at: string; file_url: string | null }) => ({
        id: d.id,
        type: d.type,
        created_at: d.created_at,
        has_file: Boolean(d.file_url),
      })),
      progress_notes: (pnRes.data ?? []).map((n: { room: string; body: string; created_at: string }) => ({
        room: (n.room || '').trim(),
        body: (n.body || '').trim(),
        created_at: n.created_at,
      })),
      progress_room_notes: (prnRes.data ?? []).map((n: { room_name: string; note: string }) => ({
        room_name: (n.room_name || '').trim(),
        note: (n.note || '').trim(),
      })),
      quote_line_items: (liRes.data ?? []).map((i: { room_name: string; description: string; qty: number; unit: string; rate: number; total: number }) => ({
        room_name: (i.room_name || '').trim(),
        description: (i.description || '').trim(),
        qty: i.qty,
        unit: i.unit,
        rate: i.rate,
        total: i.total,
      })),
      document_bundles: (bundlesRes.data ?? []).map((b: { id: string; title: string; part_document_ids: string[]; created_at: string }) => ({
        id: b.id,
        title: b.title,
        part_document_ids: b.part_document_ids,
        created_at: b.created_at,
      })),
    }

    const system = mode === 'video' ? VIDEO_SYSTEM : WRITTEN_SYSTEM
    const userPayload =
      mode === 'video'
        ? {
            full_job_context: fullJobContext,
            written_capture: body.written_capture ?? null,
            existing_video_capture: body.video_capture ?? null,
          }
        : {
            full_job_context: fullJobContext,
            existing_written_capture: body.written_capture ?? null,
          }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system,
      messages: [
        {
          role: 'user',
          content: `Generate case study ${mode} output from this context:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })

    if (mode === 'video') {
      return NextResponse.json({
        video_capture: parsed.video_capture ?? {},
        video_draft: typeof parsed.video_draft === 'string' ? parsed.video_draft : '',
      })
    }

    return NextResponse.json({
      case_study: parsed.case_study ?? {},
      written_draft: typeof parsed.written_draft === 'string' ? parsed.written_draft : '',
    })
  } catch (e: unknown) {
    console.error('[suggest-case-study]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest failed' },
      { status: 500 }
    )
  }
}
