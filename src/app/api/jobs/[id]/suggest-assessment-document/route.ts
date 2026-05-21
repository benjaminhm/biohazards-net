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
import type { AssessmentData, AssessmentDocumentCapture, JobType, PathogensCapture } from '@/lib/types'

const SYSTEM = `You draft internal Assessment Document capture fields for Australian biohazard remediation staff (internal use only — not client-facing verbatim).

You receive PRESENTATION_CONTEXT (job + assessment + photo metadata) and HITL_BLOCK (presenting and candidate hazards and risks). When the staff have uploaded reference material for this job you also receive PATHOGEN_REFERENCE — extracted text from microbiology / pathophysiology PDFs they consider the source of truth for disease biology on this job.

RULES:
- Ground every statement in the provided data. Do NOT invent site incidents, legal commitments, or client quotes not supported by the JSON.
- Do NOT invent measurements. You MAY, however, cite the captured measurements that appear in PRESENTATION_CONTEXT.areas[].dimensions (length_m, width_m, height_m, floor_m2, ceiling_m2, walls_m2, total_surface_m2, volume_m3) — these are tape-measure values from the on-site assessment. When you cite them, prefer the derived surface or volume figures over raw length × width × height. The printed document already includes an "Areas & Dimensions" table, so use the numbers narratively rather than restating the table verbatim.
- When PATHOGEN_REFERENCE is provided, treat it as the authoritative source for pathogen biology, transmission routes, human-health effects, incubation periods, and PPE specific to the diseases at issue on this job. Prefer the reference's wording over your prior training, and cite diseases by name when they map to the presenting hazards. Do not fabricate quotes from the reference — paraphrase faithfully. If the reference says nothing about an aspect, say nothing about that aspect rather than guessing.
- You MAY use standard industry-typical assessment language when it clearly follows from the hazards, risks, and job type described.
- Write clear, professional prose suitable for staff review and later use in documentation.
- Australian English.

PATHOPHYSIOLOGY TABLE (pathophysiology_table):
- Populate this array ONLY from PATHOGEN_REFERENCE. If PATHOGEN_REFERENCE is absent or contains no disease-specific content, return an empty array [].
- One row per distinct disease relevant to the hazards/risks on this job. Keep it focused — at most ~10 rows.
- Each row is an object with these string keys (all values are short, table-cell-sized strings; omit a key when the reference does not state it):
    disease       — common name, e.g. "Hepatitis B"
    pathogen      — causative organism, e.g. "Hepatitis B virus (HBV)" (omit if identical to disease)
    transmission  — routes, e.g. "Bloodborne; sexual; perinatal"
    effects       — effects on humans (signs, symptoms, complications, mortality)
    incubation    — incubation / communicability period
    ppe           — PPE / decontamination notes the reference attaches to this pathogen
- Never invent diseases that don't appear in PATHOGEN_REFERENCE. Never restate the same disease twice. Paraphrase concisely — these strings will be rendered in a table on the printed document, so aim for terse, scannable phrases (≤ 200 chars per cell).

Respond ONLY with valid JSON (no markdown fences) matching exactly these keys:
{"site_summary":"","hazards_overview":"","risks_overview":"","control_measures":"","recommendations":"","limitations":"","pathophysiology_table":[]}

Each prose value is a paragraph or short bullet-style prose as appropriate. Use empty string only if there is truly nothing to say from context. pathophysiology_table is an array of row objects per the rules above.`

/** Hard cap on how much extracted pathogen text we ship to Claude per request.
 *  Per-PDF extraction is already capped to 60k chars; this prevents many PDFs
 *  from blowing the context window. We pick longer-extracted texts first since
 *  the extractor already prioritised the most reference-dense content. */
const MAX_PATHOGEN_INJECT_CHARS = 80_000

function buildPathogenReferenceBlock(capture: PathogensCapture | null | undefined): string | null {
  if (!capture) return null
  const ready = (capture.files ?? []).filter(f => f.extraction_status === 'ready' && f.extracted_text)
  if (ready.length === 0 && !capture.notes?.trim()) return null

  let budget = MAX_PATHOGEN_INJECT_CHARS
  const sections: string[] = []
  if (capture.notes?.trim()) {
    sections.push(`STAFF NOTE: ${capture.notes.trim()}`)
    budget -= sections[0].length
  }
  for (const f of ready) {
    if (budget <= 200) break
    const header = `--- ${f.label || f.file_name} ---`
    const body = (f.extracted_text ?? '').slice(0, Math.max(0, budget - header.length - 8))
    if (!body.trim()) continue
    sections.push(`${header}\n${body}`)
    budget -= header.length + body.length + 8
  }
  if (sections.length === 0) return null
  return sections.join('\n\n')
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

    const pathogenBlock = buildPathogenReferenceBlock(ad?.pathogens_capture ?? null)
    const userMessage = pathogenBlock
      ? `Draft Assessment Document capture fields from the following data:\n\n${userBlock}\n\n----\nPATHOGEN_REFERENCE (treat as source of truth for disease biology, transmission, and human-health effects on this job):\n\n${pathogenBlock}`
      : `Draft Assessment Document capture fields from the following data:\n\n${userBlock}`

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: userMessage,
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
