/*
 * lib/agent/jobReads.ts
 *
 * Read-only queries on one job, shared by the file agent and the document
 * sub-agents. Every query is scoped to the job (and org where the table has it).
 */
import type { createServiceClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServiceClient>

export const READ_CAP = 60_000

export function capped(value: unknown, cap = READ_CAP): unknown {
  const s = JSON.stringify(value ?? null)
  return s.length <= cap ? value : { truncated: true, first_part: s.slice(0, cap) }
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function readCalls(supabase: Supabase, orgId: string, jobId: string) {
  const { data } = await supabase
    .from('inbound_calls')
    .select('id, created_at, provider, caller_number, status, transcript_clean, transcript_raw, extraction')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)
  return (data ?? []).map(c => ({
    id: c.id, at: c.created_at, kind: c.provider === 'netlify_form' ? 'website enquiry' : 'phone call',
    from: c.caller_number, status: c.status,
    transcript: String(c.transcript_clean ?? c.transcript_raw ?? '').slice(0, 20_000),
    extraction: c.extraction,
  }))
}

export async function readProgressNotes(supabase: Supabase, jobId: string) {
  const { data } = await supabase
    .from('progress_notes')
    .select('id, room, body, created_by_first_name, created_at')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200)
  return data ?? []
}

export async function readXeroInvoice(supabase: Supabase, orgId: string, jobId: string) {
  const { data } = await supabase
    .from('xero_job_invoices')
    .select('xero_invoice_number, xero_status, total, document_ids, last_synced_at, last_error')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  return data ?? null
}

export async function readPhotos(supabase: Supabase, jobId: string, limit = 200) {
  const { data } = await supabase
    .from('photos')
    .select('id, caption, area_ref, category, capture_phase, taken_at, uploaded_at, include_in_composed_reports')
    .eq('job_id', jobId)
    .order('uploaded_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

export async function readAcceptances(supabase: Supabase, jobId: string) {
  const { data } = await supabase
    .from('quote_acceptances')
    .select('document_id, accepted_at, quote_total, quote_reference')
    .eq('job_id', jobId)
    .order('accepted_at', { ascending: true })
  return (data ?? []) as { document_id: string | null; accepted_at: string; quote_total: number | null; quote_reference: string | null }[]
}

export interface DocSummary {
  id: string
  type: string
  title: string
  reference: string
  created_at: string
  released_to_portal_at: string | null
}

/** Saved documents on the job, newest first, optionally only some types. */
export async function readDocumentList(supabase: Supabase, orgId: string, jobId: string, types?: readonly string[]): Promise<DocSummary[]> {
  let q = supabase
    .from('documents')
    .select('id, type, content, created_at, released_to_portal_at')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(60)
  if (types) q = q.in('type', [...types])
  const { data } = await q
  return (data ?? []).map(d => {
    const c = (d.content ?? {}) as Record<string, unknown>
    return {
      id: d.id as string, type: d.type as string, title: text(c.title), reference: text(c.reference),
      created_at: d.created_at as string,
      released_to_portal_at: (d.released_to_portal_at as string | null) ?? null,
    }
  })
}

export async function readDocument(supabase: Supabase, orgId: string, jobId: string, id: string) {
  const { data } = await supabase
    .from('documents')
    .select('id, type, content, created_at, released_to_portal_at')
    .eq('id', id)
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  return data
}
