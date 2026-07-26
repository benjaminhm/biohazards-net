/*
 * GET /api/portal/jobs/[jobId]
 *
 * One job and its released documents. loadPortalJob refuses any job that is not
 * linked to the caller's account, so a guessed job id returns 404 rather than
 * another client's work.
 */
import { NextResponse } from 'next/server'
import { loadPortalJob, requirePortalContext } from '@/lib/portalScope'
import { DOC_TYPE_LABELS } from '@/lib/types'
import type { DocType } from '@/lib/types'

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response

  const job = await loadPortalJob(
    ctx,
    jobId,
    'id, status, job_type, site_address, created_at, scheduled_at, schedule_note, archived_at'
  )

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const [docsRes, acceptancesRes] = await Promise.all([
    ctx.supabase
      .from('documents')
      .select('id, type, content, created_at, released_to_portal_at')
      .eq('org_id', ctx.orgId)
      .eq('job_id', jobId)
      .not('released_to_portal_at', 'is', null)
      .order('created_at', { ascending: false }),
    ctx.supabase
      .from('quote_acceptances')
      .select('document_id, accepted_at, contact_name')
      .eq('org_id', ctx.orgId)
      .eq('account_id', ctx.accountId)
      .eq('job_id', jobId)
      .not('document_id', 'is', null),
  ])

  const accepted = new Map<string, { accepted_at: string; contact_name: string }>()
  for (const a of acceptancesRes.data ?? []) {
    if (!a.document_id) continue
    accepted.set(a.document_id as string, {
      accepted_at: a.accepted_at as string,
      contact_name: a.contact_name as string,
    })
  }

  const documents = (docsRes.data ?? []).map(doc => {
    const content = (doc.content ?? {}) as Record<string, unknown>
    const acceptance = accepted.get(doc.id as string)
    return {
      id: doc.id,
      type: doc.type,
      label: DOC_TYPE_LABELS[doc.type as DocType] ?? doc.type,
      title: typeof content.title === 'string' ? content.title : null,
      reference: typeof content.reference === 'string' ? content.reference : null,
      total: typeof content.total === 'number' ? content.total : null,
      created_at: doc.created_at,
      released_at: doc.released_to_portal_at,
      accepted_at: acceptance?.accepted_at ?? null,
      accepted_by: acceptance?.contact_name ?? null,
    }
  })

  return NextResponse.json({ job, documents })
}
