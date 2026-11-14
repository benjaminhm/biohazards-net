/*
 * lib/receiptStore.ts — server side of job receipts (lib/jobReceipts,
 * migration 077): the staff gate, loading receipts with their load links, and
 * reading a receipt image once. What is read is a suggestion; nothing counts
 * until a person confirms the receipt.
 */
import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { auth } from '@/lib/staffAuth'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { personShortCode } from '@/lib/phoneSignIn'
import { parseReceiptRead, receiptFromRow, type JobReceipt, type ReceiptRead } from '@/lib/jobReceipts'

export const RECEIPT_COLUMNS =
  'id, job_id, file_url, storage_path, uploaded_by_name, uploaded_at, supplier, receipt_at, docket_no, total_inc_gst, gst, weight_kg, read, confirmed_at, confirmed_by_name, dext_sent_at'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

export interface ReceiptGate {
  supabase: SupabaseClient
  orgId: string
  jobId: string
  /** "Name (U-XXXXXX)", for who uploaded or confirmed. */
  actor: string
}

/** Admins and managers, on a job of their organisation. */
export async function receiptGate(req: Request, jobId: string): Promise<ReceiptGate | { error: NextResponse }> {
  const deny = (status: number, error: string) => ({ error: NextResponse.json({ error }, { status }) })
  const { userId } = await auth()
  if (!userId) return deny(401, 'Unauthorized')
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return deny(401, 'Unauthorized')
  if (!isUuid(jobId)) return deny(404, 'Job not found')
  const supabase = createServiceClient()
  const { data: me } = await supabase
    .from('org_users')
    .select('role, person_id')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!me || !['admin', 'owner', 'manager'].includes(me.role)) return deny(403, 'Forbidden')
  const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (!job) return deny(404, 'Job not found')
  let actor = 'Staff'
  if (me.person_id) {
    const { data: person } = await supabase.from('people').select('name').eq('id', me.person_id).maybeSingle()
    actor = `${(person?.name as string | undefined)?.trim() || 'Staff'} (${personShortCode(me.person_id as string)})`
  }
  return { supabase, orgId, jobId, actor }
}

/** The job's receipts, oldest first, with the loads each covers. */
export async function listReceipts(supabase: SupabaseClient, jobId: string): Promise<JobReceipt[]> {
  const { data: rows } = await supabase
    .from('job_receipts')
    .select(RECEIPT_COLUMNS)
    .eq('job_id', jobId)
    .order('uploaded_at', { ascending: true })
  const list = (rows ?? []) as Record<string, unknown>[]
  if (!list.length) return []
  const { data: links } = await supabase
    .from('job_receipt_loads')
    .select('receipt_id, load_photo_id')
    .in('receipt_id', list.map(r => r.id as string))
  const byReceipt = new Map<string, string[]>()
  for (const l of (links ?? []) as { receipt_id: string; load_photo_id: string }[]) {
    byReceipt.set(l.receipt_id, [...(byReceipt.get(l.receipt_id) ?? []), l.load_photo_id])
  }
  return list.map(r => receiptFromRow(r, byReceipt.get(r.id as string) ?? []))
}

export async function getReceipt(supabase: SupabaseClient, jobId: string, receiptId: string): Promise<JobReceipt | null> {
  if (!isUuid(receiptId)) return null
  const { data: row } = await supabase.from('job_receipts').select(RECEIPT_COLUMNS).eq('id', receiptId).eq('job_id', jobId).maybeSingle()
  if (!row) return null
  const { data: links } = await supabase.from('job_receipt_loads').select('load_photo_id').eq('receipt_id', receiptId)
  return receiptFromRow(row as Record<string, unknown>, ((links ?? []) as { load_photo_id: string }[]).map(l => l.load_photo_id))
}

const SYSTEM = `You read one photo of a receipt, docket or weighbridge ticket, usually from a waste transfer station or tip.
Reply with JSON only, no prose:
{"supplier": string, "receipt_at": string|null, "docket_no": string, "total_inc_gst": number|null, "gst": number|null, "weight_kg": number|null}
- supplier: the business or site name printed on it ("" if none).
- receipt_at: the printed date and time as an ISO 8601 local time in Queensland, e.g. "2026-11-14T13:42:00+10:00"; date only is fine with "T00:00:00+10:00"; null if none.
- docket_no: the receipt, docket, ticket or invoice number ("" if none).
- total_inc_gst: the total paid including GST, in dollars.
- gst: the GST amount in dollars, if printed.
- weight_kg: the net weight in kilograms (convert tonnes to kg).
Use null for anything not printed or not readable. Never guess.`

function mediaType(url: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (/\.png($|\?)/i.test(url)) return 'image/png'
  if (/\.webp($|\?)/i.test(url)) return 'image/webp'
  return 'image/jpeg'
}

export async function readReceiptImage(fileUrl: string): Promise<ReceiptRead> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Receipt reading is not set up on this server.')
  const res = await fetch(fileUrl)
  if (!res.ok) throw new Error('Could not open the receipt image.')
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('The receipt image is too large to read.')
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: CLAUDE_SONNET_MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType(fileUrl), data: Buffer.from(bytes).toString('base64') } },
        { type: 'text', text: 'Read this receipt. JSON only.' },
      ],
    }],
  })
  const block = message.content[0]
  const text = block?.type === 'text' ? block.text : ''
  const json = text.match(/\{[\s\S]*\}/)
  let parsed: unknown = null
  try {
    parsed = json ? JSON.parse(json[0]) : null
  } catch {
    parsed = null
  }
  const read = parseReceiptRead(parsed && typeof parsed === 'object' ? { ...parsed, read_at: new Date().toISOString() } : null)
  if (!read) throw new Error('The receipt could not be read.')
  return read
}
