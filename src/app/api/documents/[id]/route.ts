/*
 * app/api/documents/[id]/route.ts
 *
 * GET    /api/documents/[id] — fetch a single document by ID
 * PATCH  /api/documents/[id] — update document content (only the content field).
 *   Saving an accepted quote re-syncs the job's Xero invoice (only changes it
 *   while it is still a draft in Xero).
 * DELETE /api/documents/[id] — hard delete the document record
 *
 * Staff with the full job file (admin, owner, manager, team lead), and only for
 * documents in their org. The public print link (/api/print/[docId]) and the
 * client portal read documents directly, not through this route.
 */
import { after, NextResponse } from 'next/server'
import { isAcceptableQuoteType } from '@/lib/acceptableQuotes'
import { syncJobInvoice } from '@/lib/xero/sync'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { recordDocumentSave, staleAfterStaffSave } from '@/lib/agent/drafts'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { documentInOrg } from '@/lib/documentAccess'

const NOT_FOUND = () => NextResponse.json({ error: 'Document not found' }, { status: 404 })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guardFullAccessStaff(req)
    if (!g.ok) return g.response
    if (!(await documentInOrg(g.supabase, id, g.orgId))) return NOT_FOUND()
    const { data, error } = await g.supabase.from('documents').select('*').eq('id', id).single()
    if (error) throw error
    return NextResponse.json({ document: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guardFullAccessStaff(req)
    if (!g.ok) return g.response
    if (!(await documentInOrg(g.supabase, id, g.orgId))) return NOT_FOUND()
    const { supabase, userId } = g
    const body = await req.json()
    const { data, error } = await supabase
      .from('documents')
      .update({ content: body.content })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    if (data?.job_id && isAcceptableQuoteType(data.type)) {
      const { count } = await supabase
        .from('quote_acceptances')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', id)
      if (count) after(() => syncJobInvoice(supabase, data.job_id as string, 'quote_edited'))
    }
    if (data?.job_id) {
      after(async () => {
        try {
          const firstName = await getStaffFirstName(userId)
          await recordDocumentSave(supabase, {
            userId,
            firstName,
            doc: { id, job_id: data.job_id as string, type: data.type as string, content: data.content },
          })
          await staleAfterStaffSave(supabase, {
            orgId: g.orgId, jobId: data.job_id as string, userId, firstName, doc: { id, content: data.content },
          })
        } catch (err) {
          console.error('[documents PATCH] agent log line failed', err)
        }
      })
    }
    return NextResponse.json({ document: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guardFullAccessStaff(req)
    if (!g.ok) return g.response
    if (!(await documentInOrg(g.supabase, id, g.orgId))) return NOT_FOUND()
    const { error } = await g.supabase.from('documents').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
