/*
 * PATCH /api/jobs/[id]/quote-line-items/run — update active run metadata (GST toggle).
 * Creates an active run if none exists so the toggle works before line items.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { QUOTE_SOURCE_SCHEMA_VERSION, quoteLineItemSourceHash } from '@/lib/quoteLineItemSource'
import type { AssessmentData, JobType } from '@/lib/types'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId } = await params
    const body = (await req.json()) as { add_gst_to_total?: unknown }
    if (typeof body.add_gst_to_total !== 'boolean') {
      return NextResponse.json({ error: 'add_gst_to_total boolean required' }, { status: 400 })
    }
    const add_gst_to_total = body.add_gst_to_total

    const supabase = createServiceClient()
    const { data: job } = await supabase
      .from('jobs')
      .select('job_type, notes, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const ad = (job.assessment_data ?? null) as AssessmentData | null
    const sourceState = quoteLineItemSourceHash({
      job_type: job.job_type as JobType,
      notes: job.notes ?? '',
      assessment_data: ad,
    })

    let { data: run } = await supabase
      .from('quote_line_item_runs')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()

    if (!run) {
      const inserted = await supabase
        .from('quote_line_item_runs')
        .insert({
          org_id: orgId,
          job_id: jobId,
          target_amount: ad?.target_price ?? null,
          target_price_note: ad?.target_price_note ?? '',
          add_gst_to_total,
          is_active: true,
          source_hash: sourceState.hash,
          source_schema_version: QUOTE_SOURCE_SCHEMA_VERSION,
          generated_at: new Date().toISOString(),
          generated_by_user_id: userId,
          created_by_user_id: userId,
        })
        .select()
        .single()
      if (inserted.error) throw inserted.error
      run = inserted.data
    } else {
      const updated = await supabase
        .from('quote_line_item_runs')
        .update({ add_gst_to_total })
        .eq('id', run.id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (updated.error) throw updated.error
      run = updated.data
    }

    return NextResponse.json({ run })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not update quote run' },
      { status: 500 },
    )
  }
}
