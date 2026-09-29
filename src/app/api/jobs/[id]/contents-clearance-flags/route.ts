/*
 * POST /api/jobs/:id/contents-clearance-flags
 *
 * Staff-only. Compares the clearance figures with the clause text and returns
 * a list of flag codes. The model may add a code from the schema. It does not
 * draft replacement wording, and nothing here is written onto the document.
 *
 * See docs/ai-product-principles.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import {
  acceptModelFlags,
  CLEARANCE_FLAG_RESPONSE_SCHEMA,
  clearanceClauseFlags,
  mergeClearanceFlags,
  plainClearanceClause,
} from '@/lib/contentsClearanceFlags'
import {
  CONTENTS_CLEARANCE_SCHEMA,
  contentsClearanceFigures,
  normalizeContentsClearanceCapture,
  normalizeContentsClearanceStandards,
  wholeManDays,
} from '@/lib/contentsClearanceQuote'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'

const SYSTEM = `You check a contents clearance quote for contradictions between FIGURES and CLAUSES.

Return flags only. Do not rewrite a clause, do not quote a replacement, and do not add any field other than code and clause.

Flag labour_tracks_volume only when a clause says the labour quantity is worked out from the volume, from cubic metres, or will change when the volume is measured, AND figures.labour_days is not figures.paced_labour_days.
Do not flag labour_tracks_volume when the clause states a fixed number of labour days, or when labour_days equals paced_labour_days.

Flag man_day_wording only when a clause says "man day" or "man days".

Flag rate_mismatch only when a clause states a dollar amount or a numeric rate per day, per cubic metre, per kilometre, or per tonne that is not in FIGURES.
Do not flag the words "standard rate" when no number is given.

Flag deposit_mismatch only when a clause states a deposit percent other than 50.
Flag gst_mismatch only when a clause states a GST percent other than 10.

If nothing contradicts, return an empty flags array.`

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
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const body = (await req.json()) as { capture?: unknown; standards?: unknown }
    const capture = normalizeContentsClearanceCapture(body.capture)
    const standards = normalizeContentsClearanceStandards(body.standards)
    const figures = contentsClearanceFigures(capture.estimated_m3, capture.estimated_km, {
      ratePerM3: capture.rate_per_m3 ?? CONTENTS_CLEARANCE_SCHEMA.ratePerM3,
      ratePerKm: capture.rate_per_km ?? CONTENTS_CLEARANCE_SCHEMA.ratePerKm,
      ratePerLabourDay: capture.rate_per_labour_day ?? CONTENTS_CLEARANCE_SCHEMA.ratePerLabourDay,
      m3PerLabourDay: capture.m3_per_labour_day ?? CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay,
    }, {
      returnTripKm: capture.return_trip_km,
      returnTrips: capture.return_trips,
      m3PerTrip: capture.m3_per_trip,
      tripsPerDay: capture.trips_per_day,
      tonnes: capture.estimated_tonnes,
      ratePerTonne: capture.disposal_rate_per_tonne,
      mobilisationFee: capture.mobilisation_fee,
      mobilisationWaived: capture.mobilisation_waived,
      maximumManDays: capture.maximum_man_days,
    })
    const exact = clearanceClauseFlags(figures, standards)

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ flags: exact, model: false })

    const payload = {
      figures: {
        estimated_m3: figures.estimated_m3,
        labour_days: figures.labour_days,
        paced_labour_days: wholeManDays(figures.estimated_m3, figures.m3_per_labour_day),
        m3_per_labour_day: figures.m3_per_labour_day,
        rate_per_m3: figures.rate_per_m3,
        rate_per_km: figures.rate_per_km,
        rate_per_labour_day: figures.rate_per_labour_day,
        disposal_rate_per_tonne: figures.disposal_rate_per_tonne,
        mobilisation_fee: figures.mobilisation_fee,
        subtotal: figures.subtotal,
        gst: figures.gst,
        total: figures.total,
        deposit_percent: 50,
        gst_percent: 10,
      },
      clauses: {
        inclusions: plainClearanceClause(standards.inclusions),
        exclusions: plainClearanceClause(standards.exclusions),
        assumptions: plainClearanceClause(standards.assumptions),
        payment_terms: plainClearanceClause(standards.payment_terms),
        engagement_agreement: plainClearanceClause(standards.engagement_agreement),
      },
    }

    try {
      const client = new Anthropic({ apiKey })
      const message = await client.messages.create({
        model: CLAUDE_SONNET_MODEL,
        max_tokens: 400,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: CLEARANCE_FLAG_RESPONSE_SCHEMA,
          },
        },
      })
      const block = message.content.find(part => part.type === 'text')
      const parsed = block?.type === 'text' ? JSON.parse(block.text) as unknown : null
      const modelFlags = acceptModelFlags(parsed, figures, standards)
      return NextResponse.json({ flags: mergeClearanceFlags(exact, modelFlags), model: true })
    } catch (e: unknown) {
      console.error('[contents-clearance-flags]', e)
      return NextResponse.json({ flags: exact, model: false })
    }
  } catch (e: unknown) {
    console.error('[contents-clearance-flags]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The clause check failed' },
      { status: 500 },
    )
  }
}
