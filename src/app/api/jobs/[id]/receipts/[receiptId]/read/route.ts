/*
 * POST /api/jobs/[id]/receipts/[receiptId]/read — read the receipt image once.
 * The read is kept, and fills only fields that are still blank on a receipt
 * nobody has confirmed. Staff check every field before confirming.
 */
import { NextResponse } from 'next/server'
import { getReceipt, readReceiptImage, receiptGate } from '@/lib/receiptStore'
import { fieldsFromRead } from '@/lib/jobReceipts'

export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const { id, receiptId } = await params
  const gate = await receiptGate(req, id)
  if ('error' in gate) return gate.error
  const { supabase, jobId } = gate
  const receipt = await getReceipt(supabase, jobId, receiptId)
  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  let read
  try {
    read = await readReceiptImage(receipt.file_url)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The receipt could not be read.' }, { status: 502 })
  }
  const fill = receipt.confirmed_at ? {} : fieldsFromRead(receipt, read)
  const { error } = await supabase
    .from('job_receipts')
    .update({ read, ...fill, updated_at: new Date().toISOString() })
    .eq('id', receipt.id)
    .eq('job_id', jobId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ receipt: await getReceipt(supabase, jobId, receipt.id) })
}
