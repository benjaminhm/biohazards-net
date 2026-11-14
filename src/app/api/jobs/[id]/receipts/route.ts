/*
 * app/api/jobs/[id]/receipts/route.ts — a job's receipts (lib/jobReceipts).
 *   GET  — every receipt, oldest first, with the loads each covers
 *   POST — multipart `file`: one image is one new receipt
 *          JSON { photo_ids }: move photos out of the job's folder into receipts
 *          (for receipts that came in through the phone link)
 * New receipts are unread and unconfirmed; the client asks for a read next.
 * Admins and managers only.
 */
import { NextResponse } from 'next/server'
import { getReceipt, isUuid, listReceipts, receiptGate, RECEIPT_COLUMNS } from '@/lib/receiptStore'
import { receiptFromRow } from '@/lib/jobReceipts'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_MOVE = 50

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await receiptGate(req, (await params).id)
  if ('error' in gate) return gate.error
  return NextResponse.json({ receipts: await listReceipts(gate.supabase, gate.jobId) })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await receiptGate(req, (await params).id)
  if ('error' in gate) return gate.error
  const { supabase, orgId, jobId, actor } = gate

  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = (await req.json().catch(() => null)) as { photo_ids?: unknown } | null
    const ids = Array.isArray(body?.photo_ids) ? [...new Set(body.photo_ids.filter(isUuid))] : []
    if (!ids.length || ids.length > MAX_MOVE) return NextResponse.json({ error: 'Choose photos to move.' }, { status: 400 })
    const { data: photos, error } = await supabase
      .from('photos')
      .select('id, file_url, uploaded_by_name, uploaded_at, cdr_load')
      .eq('job_id', jobId)
      .in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const movable = (photos ?? []).filter(p => p.file_url && (p.cdr_load ?? 0) < 1)
    if (!movable.length) return NextResponse.json({ error: 'None of those photos can become receipts. Photos that are loads stay loads.' }, { status: 400 })
    const { data: rows, error: insertError } = await supabase
      .from('job_receipts')
      .insert(movable.map(p => ({
        org_id: orgId,
        job_id: jobId,
        file_url: p.file_url,
        storage_path: null,
        uploaded_by_name: p.uploaded_by_name || actor,
        uploaded_at: p.uploaded_at ?? new Date().toISOString(),
      })))
      .select(RECEIPT_COLUMNS)
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    // The image file stays where it is; only the photo row goes, so it leaves the folder and every picker.
    await supabase.from('photos').delete().eq('job_id', jobId).in('id', movable.map(p => p.id))
    return NextResponse.json({ receipts: (rows ?? []).map(r => receiptFromRow(r as Record<string, unknown>, [])) })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: 'Choose a receipt image.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The receipt image is too large (max 8 MB).' }, { status: 400 })
  const type = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg'
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${jobId}/receipts/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const { error: uploadError } = await supabase.storage.from('job-photos').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })
  const fileUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl

  const { data: row, error } = await supabase
    .from('job_receipts')
    .insert({ org_id: orgId, job_id: jobId, file_url: fileUrl, storage_path: path, uploaded_by_name: actor })
    .select('id')
    .single()
  if (error || !row) {
    await supabase.storage.from('job-photos').remove([path])
    return NextResponse.json({ error: error?.message ?? 'Could not save the receipt.' }, { status: 500 })
  }
  return NextResponse.json({ receipt: await getReceipt(supabase, jobId, row.id as string) })
}
