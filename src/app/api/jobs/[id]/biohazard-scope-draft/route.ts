/*
 * POST /api/jobs/:id/biohazard-scope-draft
 *
 * Staff-only. Drafts the scope of work of the Biohazard Cleaning Quote from the details on the tab.
 * The draft is shown to staff to use, edit, or discard. Nothing is saved or sent from here.
 * Lines about the hygienist and testing are left to code, which adds them when they are ticked.
 *
 * See docs/ai-product-principles.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/staffAuth'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { BIOHAZARD_AUDIT_GAPS, biohazardCheckContext } from '@/lib/biohazardCleaningCheck'
import {
  normalizeBiohazardCleaningCapture,
  normalizeBiohazardCleaningClauses,
  secondaryZoneInUse,
} from '@/lib/biohazardCleaningQuote'
import {
  acceptBiohazardScopeDraft,
  biohazardScopeDraftPayload,
  biohazardScopeDraftSchema,
} from '@/lib/biohazardScopeDraft'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import type { Job } from '@/lib/types'

const SYSTEM = `You draft the scope of work of an Australian biohazard cleaning quote.

The standard: a Certified Occupational Hygienist auditing the job must be able to understand each step and check it on site. Every step says where (the rooms, surfaces, or limits), what is removed, cleaned, or treated, and how (the method, product, or standard). The verification step says what counts as a pass.

You get DETAILS of this job, the ASSESSMENT, the STANDARD_STAGES of a biohazard clean, the HOUSE_SCOPE the company usually uses, and the PLACEHOLDERS you may use.

Return the scope as a list of steps, in the order the work is done. For each step:
- stage: the STANDARD_STAGE it belongs to, or secondary for a step in the secondary zone.
- text: the step as it will print. No numbering.
- where: the words in text that say where, copied exactly from text.
- what: the words in text that say what is removed, cleaned, or treated, copied exactly from text.
- how: the words in text that say how (the method, the product or product type, or the standard), copied exactly from text.
- pass: for the verification step, the words in text that say what counts as a pass, copied exactly from text. "" for other steps.
If you cannot fill where, what, or how from the text, the text is not specific enough. Rewrite the text until you can.

Deodorisation steps, in either zone, name the method and the product type, for example removing the source, then thermal fogging with an odour counteractant or running hydroxyl generators, and sealing surfaces that keep holding odour. "An appropriate treatment" is not a method.
The verification step states conditions that can be observed on site, for example no visible residue or staining on the treated surfaces and no detectable odour from them.

Write each step's text:
- As an instruction for the work, in plain Australian English. One or two short sentences.
- Specific to this job: name the rooms, surfaces, and materials from DETAILS and ASSESSMENT where they are given, and say how far removal goes and how each kind of surface is treated (porous removed, non-porous cleaned and disinfected, semi-porous sealed where staining or odour remains).
- Using the PLACEHOLDERS in square brackets, exactly as given, for the biohazard types and the zones, for example [biohazard type] and [area affected]. Do not write the joined list of names instead, and do not repeat the names after a placeholder, because the placeholder is replaced with them.

Cover every STANDARD_STAGE, in this order: containment, PPE, removal of gross contamination, cleaning, disinfection, a visual verification with what counts as a pass, waste disposal, and deodorisation. Keep the standards and products the HOUSE_SCOPE names, such as AS/NZS 1715, AS/NZS 3816, and TGA-registered hospital-grade disinfectant. Use the HOUSE_SCOPE wording where it already fits.

Deal with each presenting health hazard and risk in ASSESSMENT in the step it belongs to, for example sharps in removal and insects in the secondary zone.

When the secondary zone is in use, add the steps for it after the primary zone, for the [secondary contamination] in the [secondary zone], working to the secondary objective. When it is not in use, do not mention it.

Do not include the OTHER_ZONES in the scope. They are inspected and considered non-affected, and they belong in the exclusions.

Do not write about a Certified Occupational Hygienist, a Remediation Action Plan, ATP testing, laboratory testing, or a completion report. Those lines are added separately.
Do not state prices, quantities of money, or timeframes. Do not invent facts that are not in DETAILS or ASSESSMENT.`

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

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Drafting is unavailable right now.' }, { status: 503 })

    const body = (await req.json()) as { capture?: unknown }
    const capture = normalizeBiohazardCleaningCapture(body.capture)
    const template = normalizeBiohazardCleaningClauses(company?.biohazard_cleaning_standards ?? null)
    const job = jobRow as Pick<Job, 'job_type' | 'site_address' | 'assessment_data'>
    const context = biohazardCheckContext(job, company?.address ?? null)

    const client = new Anthropic({ apiKey })
    const secondaryInUse = secondaryZoneInUse(capture)
    const ask = async (messages: Anthropic.MessageParam[]) => {
      const message = await client.messages.create({
        model: CLAUDE_SONNET_MODEL,
        max_tokens: 4000,
        temperature: 0.2,
        system: SYSTEM,
        messages,
        output_config: {
          format: {
            type: 'json_schema',
            schema: biohazardScopeDraftSchema(),
          },
        },
      })
      const block = message.content.find(part => part.type === 'text')
      const text = block?.type === 'text' ? block.text : ''
      return { text, draft: text ? acceptBiohazardScopeDraft(JSON.parse(text) as unknown, secondaryInUse) : null }
    }

    const opening: Anthropic.MessageParam = { role: 'user', content: JSON.stringify(biohazardScopeDraftPayload(capture, context, template)) }
    const first = await ask([opening])
    let draft = first.draft
    if (first.draft && first.draft.weak.length > 0) {
      const fixes = first.draft.weak
        .map(step => `- "${step.line}" does not say ${BIOHAZARD_AUDIT_GAPS[step.gap]}.`)
        .join('\n')
      try {
        const second = await ask([
          opening,
          { role: 'assistant', content: first.text },
          { role: 'user', content: `A hygienist could not audit these steps:\n${fixes}\nReturn all the steps again, with these rewritten so they say it.` },
        ])
        if (second.draft && second.draft.weak.length < first.draft.weak.length) draft = second.draft
      } catch (e: unknown) {
        console.error('[biohazard-scope-draft] retry', e)
      }
    }
    if (!draft) return NextResponse.json({ error: 'The draft was not usable. Try again.' }, { status: 502 })
    return NextResponse.json(draft)
  } catch (e: unknown) {
    console.error('[biohazard-scope-draft]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The scope could not be drafted' },
      { status: 500 },
    )
  }
}
