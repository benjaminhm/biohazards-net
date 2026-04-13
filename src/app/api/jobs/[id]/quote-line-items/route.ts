import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId } = await params
    const supabase = createServiceClient()

    const { data: run } = await supabase
      .from('quote_line_item_runs')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()

    if (!run) return NextResponse.json({ run: null, items: [] })

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
    return NextResponse.json({ run, items: items ?? [] })
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
      const inserted = await supabase
        .from('quote_line_item_runs')
        .insert({
          org_id: orgId,
          job_id: jobId,
          target_amount: null,
          target_price_note: '',
          is_active: true,
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
