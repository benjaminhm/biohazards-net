import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const { id: jobId, itemId } = await params
    const body = (await req.json()) as {
      room_name?: string
      description?: string
      qty?: number
      unit?: string
      rate?: number
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by_user_id: userId,
    }
    if (typeof body.room_name === 'string') patch.room_name = body.room_name.trim()
    if (typeof body.description === 'string') patch.description = body.description.trim()
    if (typeof body.qty === 'number' && Number.isFinite(body.qty)) patch.qty = Math.max(0, body.qty)
    if (typeof body.unit === 'string') patch.unit = body.unit.trim()
    if (typeof body.rate === 'number' && Number.isFinite(body.rate)) patch.rate = Math.max(0, body.rate)

    const supabase = createServiceClient()
    const { data: existing } = await supabase
      .from('quote_line_items')
      .select('qty, rate')
      .eq('id', itemId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle()

    if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    const qty = typeof patch.qty === 'number' ? patch.qty : Number(existing.qty ?? 0)
    const rate = typeof patch.rate === 'number' ? patch.rate : Number(existing.rate ?? 0)
    patch.total = Math.round(qty * rate * 100) / 100

    const { data, error } = await supabase
      .from('quote_line_items')
      .update(patch)
      .eq('id', itemId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ item: data })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not update item' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId, itemId } = await params
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('quote_line_items')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_user_id: userId,
      })
      .eq('id', itemId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not delete item' },
      { status: 500 }
    )
  }
}
