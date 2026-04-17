/*
 * POST /api/jobs/[id]/suggest-assessment-document
 *
 * Staff-only: draft AssessmentDocumentCapture prose from presentation + HITL hazards/risks. Does not persist.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { presentingHealthHazardsFromAssessment, hitlSelectionsBlock } from '@/lib/documentGenerationDrivers'
import { buildPresentationContext, hasPresentationGrounding } from '@/lib/jobPresentationContext'
import { normalizeAssessmentDocumentDraft } from '@/lib/assessmentDocumentCapture'
import type { AssessmentData, AssessmentDocumentCapture, JobType } from '@/lib/types'

const SYSTEM = `You draft internal Assessment Document capture fields for Australian biohazard remediation staff (internal use only — not client-facing verbatim).

You receive PRESENTATION_CONTEXT (job + assessment + photo metadata) and HITL_BLOCK (presenting and candidate hazards and risks).

RULES:
- Ground every statement in the provided data. Do NOT invent site incidents, measurements, legal commitments, or client quotes not supported by the JSON.
- You MAY use standard industry-typical assessment language when it clearly follows from the hazards, risks, and job type described.
- Write clear, professional prose suitable for staff review and later use in documentation.
- Australian English.

Respond ONLY with valid JSON (no markdown fences) matching exactly these keys:
{"site_summary":"","hazards_overview":"","risks_overview":"","control_measures":"","recommendations":"","limitations":""}

Each value is a paragraph or short bullet-style prose as appropriate. Use empty string only if there is truly nothing to say from context.`

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

    const [jobRes, photosRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_type, site_address, urgency, notes, assessment_data')
        .eq('id', jobId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase.from('photos').select('area_ref, category, caption').eq('job_id', jobId),
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

    const photos = (photosRes.data ?? []).map(p => ({
      area_ref: (p.area_ref || '').trim() || null,
      category: p.category,
      caption: (p.caption || '').trim() || null,
    }))

    const presentationContext = buildPresentationContext({
      job_type: job.job_type,
      site_address: job.site_address,
      urgency: job.urgency,
      notes: job.notes,
      assessment_data: ad,
      photos,
    })

    const approvedHazards = presentingHealthHazardsFromAssessment(ad)
    if (approvedHazards.length === 0) {
      return NextResponse.json(
        {
          error:
            'Promote at least one hazard on Assessment → Health Hazards (Presenting) before suggesting assessment document drafts.',
        },
        { status: 400 }
      )
    }

    const groundingPayload = {
      biohazard_type: presentationContext.biohazard_type,
      observations: presentationContext.observations,
      access_restrictions: presentationContext.access_restrictions,
      areas: presentationContext.areas.map(a => ({ name: a.name, description: a.description })),
      photos: presentationContext.photos.map(p => ({ area_ref: p.area_ref, caption: p.caption })),
      special_risks: presentationContext.special_risks,
      ppe_required: presentationContext.ppe_required,
    }
    if (!hasPresentationGrounding(groundingPayload)) {
      return NextResponse.json(
        {
          error:
            'Not enough on Presentation to ground drafts. Add observations, areas, biohazard type, photo captions, or checklist flags first.',
        },
        { status: 400 }
      )
    }

    const userBlock = JSON.stringify(
      {
        presentation_context: presentationContext,
        hitl_hazards_and_risks: hitlSelectionsBlock(ad),
      },
      null,
      2
    )

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Draft Assessment Document capture fields from the following data:\n\n${userBlock}`,
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

    const suggestions: AssessmentDocumentCapture = normalizeAssessmentDocumentDraft(parsed)

    return NextResponse.json({ suggestions })
  } catch (e: unknown) {
    console.error('[suggest-assessment-document]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest failed' },
      { status: 500 }
    )
  }
}
