/*
 * POST /api/jobs/[id]/suggest-letterhead-body
 *
 * Staff-only: draft the body of a Company Letterhead document (letter or short
 * report) from a free-text brief plus job context. Returns print-safe HTML for
 * the rich-text editor. Draft only — staff edit it, then generate the document
 * themselves. Nothing is saved or sent from here.
 *
 * Input  : { prompt: string, existing_html?: string }
 * Output : { body_html: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { applyTradingBrand, isTradingNameId } from '@/lib/tradingNames'
import { mergedSowCapture } from '@/lib/sowCapture'
import { proseHasPrintableContent, richBodyHtmlForPrint } from '@/lib/richTextPrint'
import type { AssessmentData, CompanyProfile } from '@/lib/types'

const SYSTEM = `You draft the BODY of a document printed on the letterhead of an Australian biohazard remediation company. It may be a letter or a short report — follow the USER_BRIEF.

You receive USER_BRIEF, JOB_CONTEXT (client, site, notes, scope of work, progress notes) and COMPANY_CONTEXT (the sender). If EXISTING_HTML is present, revise it per the brief rather than starting over.

OUTPUT RULES:
- The letterhead, logo and company details are added separately. Do NOT include a letterhead, company name block, or footer.
- Output HTML using ONLY these tags: <p>, <strong>, <em>, <u>, <ul>, <ol>, <li>, <br>. No headings tags — write section headings as <p><strong>Heading</strong></p>.
- For a letter: include the date line only if the brief asks; include a salutation and sign-off from the company.
- For a report: short title line in bold, then clear sections. Keep it tight.
- Australian English. Professional, factual, plain language. No graphic details; use scientific, non-sensational language.
- Ground every statement in the brief or context. Do NOT invent prices, dates, test/clearance results, quantities, certifications, or commitments.
- If the brief is sparse, write something short. Do not pad.

Respond with valid JSON only (no markdown fences), exactly:
{ "body_html": "..." }`

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

    const body = (await req.json().catch(() => ({}))) as { prompt?: string; existing_html?: string }
    const prompt = (body.prompt ?? '').trim()
    if (!prompt) {
      return NextResponse.json({ error: 'Describe what the document should say.' }, { status: 400 })
    }

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const [{ data: jobRow, error: jobErr }, { data: companyRow }, { data: notes }] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_type, site_address, client_name, client_organization_name, client_contact_role, insurance_claim_ref, notes, trading_name, assessment_data')
        .eq('id', jobId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase
        .from('company_profile')
        .select('name, abn, phone, email, address, licence, tagline')
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase
        .from('progress_notes')
        .select('room, body')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(40),
    ])
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const { assessment_data, trading_name, ...job } = jobRow as typeof jobRow & { assessment_data: AssessmentData | null }
    const sow = mergedSowCapture(assessment_data)
    const company = applyTradingBrand(
      (companyRow as CompanyProfile | null) ?? null,
      isTradingNameId(trading_name) ? trading_name : null,
    )

    const existing = (body.existing_html ?? '').trim()
    const payload = {
      user_brief: prompt,
      existing_html: proseHasPrintableContent(existing) ? existing : null,
      job_context: {
        ...job,
        scope_of_work: {
          objective: sow.objective.trim() || null,
          scope_work: sow.scope_work.trim() || null,
          methodology: sow.methodology.trim() || null,
        },
        progress_notes: (notes ?? [])
          .map((n: { room: string | null; body: string | null }) => ({ room: (n.room || '').trim(), body: (n.body || '').trim() }))
          .filter(n => n.body),
      },
      company_context: company,
    }

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Draft the document body:\n\n${JSON.stringify(payload, null, 2)}` }],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    let html = ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { body_html?: unknown }
        if (typeof parsed.body_html === 'string') html = parsed.body_html
      } catch {
        /* fall through */
      }
    }
    if (!html) html = rawText

    const body_html = richBodyHtmlForPrint(html)
    if (!proseHasPrintableContent(body_html)) {
      return NextResponse.json({ error: 'The draft came back empty. Try a more specific brief.' }, { status: 502 })
    }
    return NextResponse.json({ body_html })
  } catch (e: unknown) {
    console.error('[suggest-letterhead-body]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Draft failed' }, { status: 500 })
  }
}
