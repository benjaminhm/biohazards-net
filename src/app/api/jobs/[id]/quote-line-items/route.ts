import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { QUOTE_SOURCE_SCHEMA_VERSION, quoteLineItemSourceHash } from '@/lib/quoteLineItemSource'
import type { AssessmentData, JobType, OutcomeQuoteRow, QuoteLineItemRow } from '@/lib/types'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId } = await params
    const supabase = createServiceClient()

    const { data: job } = await supabase
      .from('jobs')
      .select('job_type, notes, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const currentSourceHash = quoteLineItemSourceHash({
      job_type: job.job_type as JobType,
      notes: job.notes ?? '',
      assessment_data: (job.assessment_data ?? null) as AssessmentData | null,
    }).hash

    const { data: run } = await supabase
      .from('quote_line_item_runs')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()

    const ad = (job.assessment_data ?? null) as AssessmentData | null
    const outcomeCapture = ad?.outcome_quote_capture
    const validOutcomes = ((outcomeCapture?.rows ?? []) as OutcomeQuoteRow[]).filter(
      row =>
        (row.status === 'approved' || row.status === 'edited') &&
        row.price > 0 &&
        row.outcome_title.trim() &&
        row.acceptance_criteria.trim() &&
        row.verification_method.trim()
    )

    if (!run) {
      if (outcomeCapture?.mode === 'outcomes' && validOutcomes.length > 0) {
        const synthetic = validOutcomes.map((row, idx) => ({
          id: `outcome_${idx + 1}`,
          run_id: '',
          org_id: orgId,
          job_id: jobId,
          room_name: row.areas.join(', ') || 'Outcome package',
          description: `${row.outcome_title}${row.outcome_description ? ` — ${row.outcome_description}` : ''}`,
          qty: 1,
          unit: 'lot',
          rate: Number(row.price),
          total: Number(row.price),
          sort_order: idx,
          source: 'ai',
          created_at: '',
          updated_at: '',
          created_by_user_id: '',
          updated_by_user_id: '',
          deleted_at: null,
        })) as QuoteLineItemRow[]
        return NextResponse.json({
          run: null,
          items: synthetic,
          freshness_status: 'up_to_date',
          current_source_hash: currentSourceHash,
          source_mode: 'outcomes',
        })
      }
      return NextResponse.json({ run: null, items: [], freshness_status: 'missing', current_source_hash: currentSourceHash })
    }

    const { data: items, error } = await supabase
      .from('quote_line_items')
      .select('*')
      .eq('run_id', run.id)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('room_name', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error
    const freshnessStatus = run.source_hash && run.source_hash === currentSourceHash ? 'up_to_date' : 'needs_refresh'
    if (outcomeCapture?.mode === 'outcomes' && validOutcomes.length > 0) {
      const synthetic = validOutcomes.map((row, idx) => ({
        id: `outcome_${idx + 1}`,
        run_id: run.id,
        org_id: orgId,
        job_id: jobId,
        room_name: row.areas.join(', ') || 'Outcome package',
        description: `${row.outcome_title}${row.outcome_description ? ` — ${row.outcome_description}` : ''}`,
        qty: 1,
        unit: 'lot',
        rate: Number(row.price),
        total: Number(row.price),
        sort_order: idx,
        source: 'ai',
        created_at: '',
        updated_at: '',
        created_by_user_id: '',
        updated_by_user_id: '',
        deleted_at: null,
      })) as QuoteLineItemRow[]
      return NextResponse.json({
        run,
        items: synthetic,
        freshness_status: freshnessStatus,
        current_source_hash: currentSourceHash,
        source_mode: 'outcomes',
      })
    }
    return NextResponse.json({
      run,
      items: items ?? [],
      freshness_status: freshnessStatus,
      current_source_hash: currentSourceHash,
      source_mode: 'line_items',
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load line items' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId } = await params
    const body = (await req.json()) as {
      room_name?: string
      description?: string
      qty?: number
      unit?: string
      rate?: number
    }

    const roomName = (body.room_name ?? '').trim()
    if (!roomName) return NextResponse.json({ error: 'Room is required' }, { status: 400 })
    const description = (body.description ?? '').trim() || 'New line item'
    const qty = Number.isFinite(body.qty) ? Math.max(0, Number(body.qty)) : 1
    const rate = Number.isFinite(body.rate) ? Math.max(0, Number(body.rate)) : 0
    const unit = (body.unit ?? '').trim() || 'hrs'
    const total = Math.round(qty * rate * 100) / 100

    const supabase = createServiceClient()
    let { data: run } = await supabase
      .from('quote_line_item_runs')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()

    if (!run) {
      const { data: job } = await supabase
        .from('jobs')
        .select('job_type, notes, assessment_data')
        .eq('id', jobId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      const currentSourceHash = quoteLineItemSourceHash({
        job_type: job.job_type as JobType,
        notes: job.notes ?? '',
        assessment_data: (job.assessment_data ?? null) as AssessmentData | null,
      }).hash

      const inserted = await supabase
        .from('quote_line_item_runs')
        .insert({
          org_id: orgId,
          job_id: jobId,
          target_amount: null,
          target_price_note: '',
          add_gst_to_total: false,
          is_active: true,
          source_hash: currentSourceHash,
          source_schema_version: QUOTE_SOURCE_SCHEMA_VERSION,
          generated_at: new Date().toISOString(),
          generated_by_user_id: userId,
          created_by_user_id: userId,
        })
        .select()
        .single()
      if (inserted.error) throw inserted.error
      run = inserted.data
    }

    const { count } = await supabase
      .from('quote_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', run.id)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    const sortOrder = count ?? 0
    const { data: item, error } = await supabase
      .from('quote_line_items')
      .insert({
        run_id: run.id,
        org_id: orgId,
        job_id: jobId,
        room_name: roomName,
        description,
        qty,
        unit,
        rate,
        total,
        sort_order: sortOrder,
        source: 'manual',
        created_by_user_id: userId,
        updated_by_user_id: userId,
      })
      .select()
      .single()
    if (error) throw error

    return NextResponse.json({ run, item }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not create line item' },
      { status: 500 }
    )
  }
}
