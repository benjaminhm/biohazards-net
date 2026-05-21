/*
 * POST /api/jobs/[id]/pathogens/upload
 *
 * Multipart PDF upload for a job's per-job pathogen / pathophysiology
 * reference library. Each upload:
 *   1. Validates the file is a PDF ≤ 10 MB and the job belongs to the caller's org.
 *   2. Stores the PDF in Supabase storage at
 *        company-assets/pathogens/<jobId>/<timestamp>-<random>-<safeName>.pdf
 *   3. Sends the PDF bytes to Claude as a `document` content block to extract
 *      a clean plain-text disease / pathogen reference suitable for grounding
 *      the Assessment Document suggester.
 *   4. Merges the file metadata + extracted_text into
 *        assessment_data.pathogens_capture.files[]
 *      on the job row via service-role write, and returns the updated job.
 *
 * Extraction failures don't fail the upload — the file is persisted with
 * extraction_status:'error' so staff can retry later from the UI.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import type { AssessmentData, Job, PathogenReferenceFile, PathogensCapture } from '@/lib/types'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_EXTRACTED_TEXT_CHARS = 60_000

const EXTRACT_SYSTEM = `You extract plain-text pathogen / pathophysiology reference content from PDFs for use by Australian biohazard remediation staff.

The attached PDF is a microbiology, pathophysiology, or disease-reference document. Extract clean reference text covering:
- Disease names and synonyms
- Causative pathogens (bacteria, viruses, fungi, prions, parasites)
- Transmission routes (direct contact, droplet, airborne, vector-borne, fomite, bloodborne)
- Effects on humans (signs, symptoms, complications, mortality where stated)
- Incubation period and period of communicability
- Infectious dose where stated
- Recommended PPE and decontamination notes

RULES:
- Output PLAIN TEXT only. No markdown fences, no JSON, no commentary.
- Preserve the document's own statements verbatim where possible; do not paraphrase clinical claims.
- Omit page numbers, headers/footers, references, and acknowledgements.
- Hard cap: ${MAX_EXTRACTED_TEXT_CHARS} characters. Prioritise disease-effect content over background biology.
- Australian English where the source uses American spellings of common terms is fine to keep verbatim.

If the document is not a pathogen / disease reference at all, return a single line:
NOT_A_PATHOGEN_REFERENCE
`

function shortId(): string {
  return `${Date.now()}_${randomUUID().slice(0, 8)}`
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

async function extractPathogenText(
  client: Anthropic,
  pdfBase64: string,
): Promise<{ text: string | null; error?: string }> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: 'Extract the pathogen / disease reference text per the rules. Plain text only.',
            },
          ],
        },
      ],
    })
    const block = message.content[0]
    const raw = block?.type === 'text' ? block.text.trim() : ''
    if (!raw) return { text: null, error: 'Empty response from extractor' }
    if (raw === 'NOT_A_PATHOGEN_REFERENCE') {
      return { text: null, error: 'The uploaded PDF does not appear to be a pathogen or disease reference.' }
    }
    return { text: raw.slice(0, MAX_EXTRACTED_TEXT_CHARS) }
  } catch (err) {
    return { text: null, error: err instanceof Error ? err.message : 'Extractor failed' }
  }
}

function emptyPathogensCapture(): PathogensCapture {
  return { files: [], updated_at: new Date().toISOString() }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 403 })

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

    const { id: jobId } = await params

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'PDF file is required (field name: file)' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `PDF too large (max ${MAX_BYTES / (1024 * 1024)} MB)` },
        { status: 413 },
      )
    }
    const rawName = file instanceof File && file.name ? file.name : 'reference.pdf'
    const mime = file.type || 'application/pdf'
    if (mime !== 'application/pdf' && !rawName.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 })
    }
    const rawLabel = String(form.get('label') ?? '').trim().slice(0, 120)

    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id, org_id, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle<{ id: string; org_id: string; assessment_data: AssessmentData | null }>()
    if (jobErr) throw jobErr
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const bytes = Buffer.from(await file.arrayBuffer())
    const safeName = safeFilename(rawName)
    const fileId = shortId()
    const storagePath = `pathogens/${jobId}/${fileId}-${safeName}`

    const { error: upErr } = await supabase.storage
      .from('company-assets')
      .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false })
    if (upErr) {
      return NextResponse.json(
        { error: upErr.message || 'Upload failed — check the company-assets bucket exists' },
        { status: 500 },
      )
    }
    const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(storagePath)
    const fileUrl = urlData.publicUrl

    const client = new Anthropic({ apiKey })
    const extraction = await extractPathogenText(client, bytes.toString('base64'))

    const nowIso = new Date().toISOString()
    const newFile: PathogenReferenceFile = {
      id: fileId,
      file_name: rawName.slice(0, 200),
      file_size: file.size,
      file_url: fileUrl,
      storage_path: storagePath,
      label: rawLabel || undefined,
      extracted_text: extraction.text ?? undefined,
      extraction_status: extraction.text ? 'ready' : 'error',
      extraction_error: extraction.error,
      uploaded_at: nowIso,
      extracted_at: extraction.text ? nowIso : undefined,
    }

    const prevCapture: PathogensCapture =
      (job.assessment_data?.pathogens_capture as PathogensCapture | undefined) ?? emptyPathogensCapture()
    const nextCapture: PathogensCapture = {
      ...prevCapture,
      files: [newFile, ...(prevCapture.files ?? [])],
      updated_at: nowIso,
    }
    const nextAssessment: AssessmentData = {
      ...((job.assessment_data ?? {}) as AssessmentData),
      pathogens_capture: nextCapture,
    }

    const { data: updated, error: updErr } = await supabase
      .from('jobs')
      .update({ assessment_data: nextAssessment })
      .eq('id', jobId)
      .eq('org_id', orgId)
      .select('*')
      .single<Job>()
    if (updErr) throw updErr

    return NextResponse.json({ job: updated, file: newFile }, { status: 201 })
  } catch (err: unknown) {
    console.error('[pathogens/upload]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Pathogens upload failed' },
      { status: 500 },
    )
  }
}
