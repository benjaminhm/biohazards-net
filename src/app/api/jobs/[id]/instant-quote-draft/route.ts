/*
 * POST /api/jobs/:id/instant-quote-draft
 *
 * Staff-only. Drafts the wording of a Fast Quote from what the client reported: the presentation, the scope of
 * work, and this job's inclusions, exclusions and assumptions. The draft is shown to staff to edit or
 * discard. Nothing is saved or sent from here, and no price is read or written.
 *
 * The model is not given the client's name, phone, email or address.
 *
 * See docs/ai-product-principles.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/staffAuth'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import {
  instantQuoteStandardAssumptions,
  instantQuoteStandardExclusions,
  instantQuoteStandardInclusions,
  normalizeInstantQuoteCapture,
} from '@/lib/instantQuote'
import {
  INSTANT_QUOTE_BRIEF_MIN_CHARS,
  INSTANT_QUOTE_DRAFT_SYSTEM,
  acceptInstantQuoteDraft,
  instantQuoteDraftPayload,
  instantQuoteDraftSchema,
} from '@/lib/instantQuoteDraft'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'

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

    const { id: jobId } = await params
    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id, job_type, job_description')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const body = (await req.json()) as { capture?: unknown }
    const capture = normalizeInstantQuoteCapture(body.capture)
    if (capture.services.length === 0) {
      return NextResponse.json({ error: 'Tick at least one service first.' }, { status: 400 })
    }
    if (capture.brief.trim().length < INSTANT_QUOTE_BRIEF_MIN_CHARS) {
      return NextResponse.json(
        { error: 'Write a little more of what the client reported: the rooms or areas, what is there, and what they want done.' },
        { status: 400 },
      )
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Drafting is unavailable right now.' }, { status: 503 })

    const row = job as { job_type?: string | null; job_description?: string | null }
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 3000,
      temperature: 0.2,
      system: INSTANT_QUOTE_DRAFT_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(instantQuoteDraftPayload(capture, row)) }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: instantQuoteDraftSchema(),
        },
      },
    })
    const block = message.content.find(part => part.type === 'text')
    const text = block?.type === 'text' ? block.text : ''
    const draft = text
      ? acceptInstantQuoteDraft(JSON.parse(text) as unknown, {
          inclusions: instantQuoteStandardInclusions(capture.services),
          exclusions: instantQuoteStandardExclusions(capture.services),
          assumptions: instantQuoteStandardAssumptions(),
        })
      : null
    if (!draft) return NextResponse.json({ error: 'The draft was not usable. Try again, or add more of what the client reported.' }, { status: 502 })
    return NextResponse.json({ draft })
  } catch (e: unknown) {
    console.error('[instant-quote-draft]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The wording could not be drafted' },
      { status: 500 },
    )
  }
}
