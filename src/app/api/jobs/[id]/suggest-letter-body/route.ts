/*
 * app/api/jobs/[id]/suggest-letter-body/route.ts
 *
 * POST — AI-generates a professional letter body for a job, from a short
 * free-text prompt supplied by the user ("describe what you want").
 *
 * Returns only the BODY copy (no letterhead, no salutation, no sign-off) —
 * the CompanyLetterTab composes the body into the company-styled letter on
 * the client side, so the letterhead/footer/client block stay canonical and
 * can't drift per-generation.
 *
 * HITL: this is a draft. The single body field is fully editable before any
 * downstream use; nothing is sent to a client from this endpoint.
 *
 * Input  : { prompt: string, existing_body?: string, tone?: string }
 * Output : { body: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'

const SYSTEM = `You draft the BODY of a professional business letter for an Australian biohazard remediation company.

You receive JOB_CONTEXT (the recipient/client and site), COMPANY_CONTEXT (the sender), and a short USER_BRIEF describing what the letter should say.

OUTPUT RULES:
- Return ONLY the letter body copy. Do NOT include letterhead, address blocks, date, reference, subject line, salutation ("Dear ..."), or sign-off ("Kind regards, ..."). Those are composed around your body separately.
- Plain text only. No markdown, no bullet characters other than standard hyphens if genuinely needed. Use blank lines between paragraphs.
- Australian English. Professional, clear, warm but precise. Avoid jargon unless the brief asks for technical tone.
- Ground statements in the provided context. Do not invent prices, dates, certifications, clearances, or commitments that aren't in the brief or context.
- If the brief is sparse, write a short, tight letter. Do not pad.
- No graphic details for biohazard cases; use scientific, non-sensational language.
- 2-6 short paragraphs is typical.

Respond with valid JSON only (no markdown fences), exactly:
{ "body": "..." }`

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
        { error: 'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local, then restart the dev server.' },
        { status: 503 },
      )
    }

    const body = (await req.json()) as {
      prompt?: string
      existing_body?: string
      tone?: string
    }
    const prompt = (body.prompt ?? '').trim()
    if (!prompt) {
      return NextResponse.json({ error: 'Please describe what the letter should say.' }, { status: 400 })
    }

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const [{ data: jobRow, error: jobErr }, { data: companyRow }] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_type, site_address, client_name, client_email, client_phone, client_organization_name, client_contact_role, insurance_claim_ref, notes')
        .eq('id', jobId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase
        .from('company_profile')
        .select('name, abn, phone, email, address, licence, tagline')
        .eq('org_id', orgId)
        .maybeSingle(),
    ])
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const client = new Anthropic({ apiKey })

    const userPayload = {
      user_brief: prompt,
      tone: body.tone ?? 'professional',
      existing_body: body.existing_body ?? null,
      job_context: jobRow,
      company_context: companyRow ?? null,
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Draft the letter body for this brief:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''

    // Parse JSON response; fall back to using the raw text as the body if the
    // model forgot to wrap it (defensive — keeps the UX working).
    let bodyText = ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { body?: unknown }
        if (typeof parsed.body === 'string') bodyText = parsed.body.trim()
      } catch {
        /* fall through */
      }
    }
    if (!bodyText) bodyText = rawText

    return NextResponse.json({ body: bodyText })
  } catch (e: unknown) {
    console.error('[suggest-letter-body]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest failed' },
      { status: 500 },
    )
  }
}
