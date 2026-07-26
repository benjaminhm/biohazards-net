/*
 * GET /api/portal/jobs
 *
 * Every job linked to this trade account, with the documents that have been
 * released to the portal. Only released documents are returned, so internal
 * drafts never reach a client even though they live on the same job.
 *
 * Quotes are split out and marked accepted / awaiting decision so the dashboard
 * can lead with what needs the client's attention.
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { DOC_TYPE_LABELS } from '@/lib/types'
import type { DocType } from '@/lib/types'

/** Reports and certificates the client is expected to keep. */
const COMPLETION_TYPES: DocType[] = ['report', 'certificate_of_decontamination']

export async function GET(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId, accountId } = ctx

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, status, job_type, site_address, created_at, scheduled_at, archived_at')
    .eq('org_id', orgId)
    .eq('client_account_id', accountId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobIds = (jobs ?? []).map(j => j.id as string)

  const [docsRes, acceptancesRes] = await Promise.all([
    jobIds.length
      ? supabase
          .from('documents')
          .select('id, job_id, type, content, created_at, released_to_portal_at')
          .eq('org_id', orgId)
          .in('job_id', jobIds)
          .not('released_to_portal_at', 'is', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? supabase
          .from('quote_acceptances')
          .select('document_id, job_id, accepted_at, contact_name')
          .eq('org_id', orgId)
          .eq('account_id', accountId)
          // Rows orphaned by a deleted document are kept as evidence but have
          // nothing left to badge in the portal.
          .not('document_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  const acceptedByDocument = new Map<string, { accepted_at: string; contact_name: string }>()
  for (const a of acceptancesRes.data ?? []) {
    if (!a.document_id) continue
    acceptedByDocument.set(a.document_id as string, {
      accepted_at: a.accepted_at as string,
      contact_name: a.contact_name as string,
    })
  }

  const documentsByJob = new Map<string, ReturnType<typeof toDocumentSummary>[]>()
  for (const doc of docsRes.data ?? []) {
    const summary = toDocumentSummary(doc, acceptedByDocument)
    const list = documentsByJob.get(doc.job_id as string) ?? []
    list.push(summary)
    documentsByJob.set(doc.job_id as string, list)
  }

  const enriched = (jobs ?? []).map(job => {
    const docs = documentsByJob.get(job.id as string) ?? []
    return {
      id: job.id,
      status: job.status,
      job_type: job.job_type,
      site_address: job.site_address,
      created_at: job.created_at,
      scheduled_at: job.scheduled_at,
      documents: docs,
      quotes: docs.filter(d => d.type === 'quote'),
      completion_documents: docs.filter(d => COMPLETION_TYPES.includes(d.type as DocType)),
    }
  })

  return NextResponse.json({
    jobs: enriched,
    /* Quotes still waiting on the client, newest first — the dashboard's lead item. */
    quotes_awaiting: enriched
      .flatMap(job =>
        job.quotes
          .filter(q => !q.accepted_at)
          .map(q => ({ ...q, job_id: job.id, site_address: job.site_address }))
      )
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  })
}

function toDocumentSummary(
  doc: Record<string, unknown>,
  acceptedByDocument: Map<string, { accepted_at: string; contact_name: string }>
) {
  const content = (doc.content ?? {}) as Record<string, unknown>
  const accepted = acceptedByDocument.get(doc.id as string)
  return {
    id: doc.id as string,
    type: doc.type as string,
    label: DOC_TYPE_LABELS[doc.type as DocType] ?? (doc.type as string),
    title: typeof content.title === 'string' ? content.title : null,
    reference: typeof content.reference === 'string' ? content.reference : null,
    total: typeof content.total === 'number' ? content.total : null,
    created_at: doc.created_at as string,
    released_at: doc.released_to_portal_at as string,
    accepted_at: accepted?.accepted_at ?? null,
    accepted_by: accepted?.contact_name ?? null,
  }
}
