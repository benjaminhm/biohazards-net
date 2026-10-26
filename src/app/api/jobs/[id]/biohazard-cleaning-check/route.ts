/*
 * POST /api/jobs/:id/biohazard-cleaning-check
 *
 * Staff-only. Gap and consistency check of the Biohazard Cleaning Quote before it is generated.
 * Rules in code always run. The model may add a flag from a closed list, or clear a rule flag by
 * quoting the words that cover it. It does not draft wording, and nothing here is written onto
 * the document.
 *
 * See docs/ai-product-principles.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/staffAuth'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import {
  acceptBiohazardModelAnswer,
  biohazardCheckContext,
  biohazardCheckPayload,
  biohazardCheckResponseSchema,
  biohazardRuleFlags,
  mergeBiohazardCheck,
} from '@/lib/biohazardCleaningCheck'
import { normalizeBiohazardCleaningCapture, normalizeBiohazardCleaningClauses } from '@/lib/biohazardCleaningQuote'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import type { Job } from '@/lib/types'

const SYSTEM = `You review a biohazard cleaning quote before staff send it. Find gaps and contradictions.

You get DETAILS, QUANTITIES, CLAUSES, the ASSESSMENT of the job, RULE_FLAGS already found by code, and the STANDARD_STAGES of a biohazard clean.

Return two lists. Do not rewrite a clause, do not suggest wording, and do not add fields.

flags — add a flag only when it is clearly true:
- hazard_not_addressed: a presenting health hazard in ASSESSMENT that no stage of the scope of work deals with, even in other words. subject is the hazard exactly as listed. evidence is "".
- risk_not_covered: a risk in ASSESSMENT that no clause deals with, even in other words, and that is not already in RULE_FLAGS. subject is the risk exactly as listed. evidence is "".
- inclusion_exclusion_conflict: an exclusion takes away something an inclusion or the scope of work promises. clause is exclusions. subject is "". evidence is the exclusion words, copied exactly.
- callout_conflict: a clause says a call-out or mobilisation fee is charged when QUANTITIES says it is waived, or says it is free when a fee is charged. subject is "". evidence is the words, copied exactly.
- title_type_mismatch: the client title names one kind of job and the biohazard type is plainly another, for example "Sewage Cleaning" for blood. clause is details. subject is "". evidence is "".

cleared — for a RULE_FLAG of stage_missing, area_not_quoted, or risk_not_covered that the quote does cover in other words:
- stage_missing: the scope of work has that stage under another name. evidence is the stage words, copied exactly from the scope of work.
- area_not_quoted: the primary zone, the secondary zone, a room, or the scope of work names the same place another way, for example "Main bedroom" for "Master bed". evidence is those words, copied exactly.
- risk_not_covered: a clause deals with that risk in other words. evidence is those words, copied exactly.
Only clear when you are sure. Evidence must be copied character for character from the quote.

If nothing applies, return empty lists.`

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
    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select('id, job_type, site_address, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const { data: company } = await supabase
      .from('company_profile')
      .select('address, biohazard_cleaning_standards')
      .eq('org_id', orgId)
      .maybeSingle()

    const body = (await req.json()) as { capture?: unknown }
    const capture = normalizeBiohazardCleaningCapture(body.capture)
    const template = normalizeBiohazardCleaningClauses(company?.biohazard_cleaning_standards ?? null)
    const job = jobRow as Pick<Job, 'job_type' | 'site_address' | 'assessment_data'>
    const context = biohazardCheckContext(job, company?.address ?? null)
    const ruleFlags = biohazardRuleFlags(capture, context, template)

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ flags: ruleFlags, cleared: [], model: false })

    try {
      const client = new Anthropic({ apiKey })
      const message = await client.messages.create({
        model: CLAUDE_SONNET_MODEL,
        max_tokens: 1200,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(biohazardCheckPayload(capture, context, ruleFlags, template)) }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: biohazardCheckResponseSchema(context),
          },
        },
      })
      const block = message.content.find(part => part.type === 'text')
      const parsed = block?.type === 'text' ? JSON.parse(block.text) as unknown : null
      const accepted = acceptBiohazardModelAnswer(parsed, capture, context, ruleFlags, template)
      return NextResponse.json({ ...mergeBiohazardCheck(ruleFlags, accepted), model: true })
    } catch (e: unknown) {
      console.error('[biohazard-cleaning-check]', e)
      return NextResponse.json({ flags: ruleFlags, cleared: [], model: false })
    }
  } catch (e: unknown) {
    console.error('[biohazard-cleaning-check]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The quote check failed' },
      { status: 500 },
    )
  }
}
