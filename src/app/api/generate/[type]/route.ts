/*
 * app/api/generate/[type]/route.ts
 *
 * POST /api/generate/[type] — legacy document generation endpoint.
 * Supports type = 'quote' | 'sow' | 'report'.
 *
 * This is the older generation path used by some UI flows. The newer
 * /api/build-document route handles all 11 document types with richer
 * context (company rules, style guide PDFs).
 *
 * Fetches job + photos from Supabase, builds a prompt via lib/prompts.ts,
 * calls Claude, and returns the parsed JSON document content.
 *
 * Note: markdown code fences are stripped from the response because Claude
 * sometimes wraps JSON in ```json blocks despite explicit instructions not to.
 */
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { buildQuotePrompt, buildSOWPrompt, buildReportPrompt } from '@/lib/prompts'
import { getOrgId } from '@/lib/org'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: Request, { params }: { params: Promise<{ type: string }> }) {
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

    const { type } = await params
    if (!['quote', 'sow', 'report'].includes(type)) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 })
    }

    const { jobId } = await req.json()
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const supabase = createServiceClient()
    const [jobRes, photosRes] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', jobId).eq('org_id', orgId).single(),
      supabase.from('photos').select('*').eq('job_id', jobId),
    ])

    if (jobRes.error) throw jobRes.error
    const job = jobRes.data
    const photos = photosRes.data ?? []

    if (!job.assessment_data) {
      return NextResponse.json(
        { error: 'Assessment data required. Please complete the Assessment tab first.' },
        { status: 422 }
      )
    }

    let prompt: string
    if (type === 'quote') prompt = buildQuotePrompt(job, photos)
    else if (type === 'sow') prompt = buildSOWPrompt(job, photos)
    else prompt = buildReportPrompt(job, photos)

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''

    // Strip markdown fences Claude occasionally prepends despite "no fences" instructions
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()

    let content: object
    try {
      content = JSON.parse(cleaned)
    } catch {
      // If parsing fails, return raw text wrapped in an object
      content = { raw: rawText }
    }

    return NextResponse.json({ content })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
