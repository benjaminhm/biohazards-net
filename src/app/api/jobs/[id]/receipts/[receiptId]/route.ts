/*
 * app/api/jobs/[id]/receipts/[receiptId]/route.ts — one receipt.
 *   PATCH  { fields?, confirmed?, load_photo_ids? }
 *          fields: supplier, receipt_at, docket_no, total_inc_gst, gst, weight_kg,
 *                  tip_address (finds the tip and the drive site → tip → site),
 *                  distance_km (typed kilometres replace the drive)
 *          recalc_trip: true looks the drive up again from the tip address
 *          confirmed: true stamps who confirmed it; false takes it back to a draft
 *          load_photo_ids: the load photos this receipt covers (replaces the list)
 *   DELETE — the receipt and its image
 * Admins and managers only.
 */
import { NextResponse } from 'next/server'
import { getReceipt, isUuid, receiptGate, receiptTrip } from '@/lib/receiptStore'
import { parseReceiptFields } from '@/lib/jobReceipts'

type Params = { params: Promise<{ id: string; receiptId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { id, receiptId } = await params
  const gate = await receiptGate(req, id)
  if ('error' in gate) return gate.error
  const { supabase, jobId, actor } = gate
  const current = await getReceipt(supabase, jobId, receiptId)
  if (!current) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { fields?: unknown; confirmed?: unknown; load_photo_ids?: unknown; recalc_trip?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if (body.fields !== undefined) {
    const fields = parseReceiptFields(body.fields)
    if (!fields) return NextResponse.json({ error: 'Check the amounts and date.' }, { status: 400 })
    Object.assign(update, fields)
    if (fields.distance_km !== undefined) Object.assign(update, { distance_out_km: null, distance_return_km: null, distance_from_maps: false })
    if (fields.tip_address !== undefined && fields.tip_address !== current.tip_address) {
      Object.assign(update, await receiptTrip(supabase, jobId, fields.tip_address))
    }
  }
  if (body.recalc_trip === true && update.tip_lat === undefined) {
    Object.assign(update, await receiptTrip(supabase, jobId, (update.tip_address as string | undefined) ?? current.tip_address))
  }
  if (body.confirmed === true && !current.confirmed_at) {
    update.confirmed_at = new Date().toISOString()
    update.confirmed_by_name = actor
  } else if (body.confirmed === false) {
    update.confirmed_at = null
    update.confirmed_by_name = null
  }

  if (body.load_photo_ids !== undefined) {
    const wanted = Array.isArray(body.load_photo_ids) ? [...new Set(body.load_photo_ids.filter(isUuid))] : null
    if (!wanted) return NextResponse.json({ error: 'Choose loads to link.' }, { status: 400 })
    // A link to a photo that is no longer a load (its load was deleted) is dropped here.
    let ids: string[] = []
    if (wanted.length) {
      const { data: loads } = await supabase.from('photos').select('id').eq('job_id', jobId).in('id', wanted).gte('cdr_load', 1)
      ids = (loads ?? []).map(p => p.id as string)
    }
    const { error: clearError } = await supabase.from('job_receipt_loads').delete().eq('receipt_id', current.id)
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 })
    if (ids.length) {
      const { error: linkError } = await supabase.from('job_receipt_loads').insert(ids.map(load_photo_id => ({ receipt_id: current.id, load_photo_id })))
      if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })
    }
  }

  if (Object.keys(update).length) {
    update.updated_at = new Date().toISOString()
    const { error } = await supabase.from('job_receipts').update(update).eq('id', current.id).eq('job_id', jobId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ receipt: await getReceipt(supabase, jobId, current.id) })
}

export async function DELETE(req: Request, { params }: Params) {
  const { id, receiptId } = await params
  const gate = await receiptGate(req, id)
  if ('error' in gate) return gate.error
  const { supabase, jobId } = gate
  if (!isUuid(receiptId)) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  const { data: row } = await supabase.from('job_receipts').select('id, file_url, storage_path').eq('id', receiptId).eq('job_id', jobId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  const path = (row.storage_path as string | null) ?? storagePathFromUrl(row.file_url as string)
  const { error } = await supabase.from('job_receipts').delete().eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (path) await supabase.storage.from('job-photos').remove([path])
  return NextResponse.json({ success: true })
}

/** A receipt moved from the folder keeps the photo's file; its path is in the public URL. */
function storagePathFromUrl(fileUrl: string): string | null {
  try {
    const m = new URL(fileUrl).pathname.match(/\/object\/public\/job-photos\/(.+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}
