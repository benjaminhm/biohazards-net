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
import { biohazardCheckContext } from '@/lib/biohazardCleaningCheck'
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

const SYSTEM = `You draft the scope of work of an Australian biohazard cleaning quote. A Certified Occupational Hygienist will read it, so it must be specific enough to check.

You get DETAILS of this job, the ASSESSMENT, the STANDARD_STAGES of a biohazard clean, the HOUSE_SCOPE the company usually uses, and the PLACEHOLDERS you may use.

Return the scope as a list of lines, one step per line, in the order the work is done. No numbering.

Write each line:
- As an instruction for the work, in plain Australian English. One or two short sentences.
- Specific to this job: name the rooms, surfaces, and materials from DETAILS and ASSESSMENT where they are given, and say how far removal goes and how each kind of surface is treated (porous removed, non-porous cleaned and disinfected, semi-porous sealed where staining or odour remains).
- Using the PLACEHOLDERS in square brackets, exactly as given, for the biohazard types and the zones, for example [biohazard type] and [area affected]. Do not write the joined list of names instead, and do not repeat the names after a placeholder, because the placeholder is replaced with them.

Cover every STANDARD_STAGE, in this order: containment, PPE, removal of gross contamination, cleaning, disinfection, a visual verification with what counts as a pass, waste disposal, and deodorisation. Keep the standards and products the HOUSE_SCOPE names, such as AS/NZS 1715, AS/NZS 3816, and TGA-registered hospital-grade disinfectant. Use the HOUSE_SCOPE wording where it already fits.

Deal with each presenting health hazard and risk in ASSESSMENT in the step it belongs to, for example sharps in removal and insects in the secondary zone.

When the secondary zone is in use, add the steps for it after the primary zone, for the [secondary contamination] in the [secondary zone], working to the secondary objective. When it is not in use, do not mention it.

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
    const message = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 2000,
      temperature: 0.2,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(biohazardScopeDraftPayload(capture, context, template)) }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: biohazardScopeDraftSchema(),
        },
      },
    })
    const block = message.content.find(part => part.type === 'text')
    const parsed = block?.type === 'text' ? JSON.parse(block.text) as unknown : null
    const scope = acceptBiohazardScopeDraft(parsed, secondaryZoneInUse(capture))
    if (!scope) return NextResponse.json({ error: 'The draft was not usable. Try again.' }, { status: 502 })
    return NextResponse.json({ scope })
  } catch (e: unknown) {
    console.error('[biohazard-scope-draft]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The scope could not be drafted' },
      { status: 500 },
    )
  }
}
