/*
 * POST /api/jobs/[id]/statement-xero
 *
 * Raise the Statement of Accounts' invoice 2 and credit note in Xero as
 * drafts, or update the drafts from the saved statement. Staff approve them in
 * Xero. Returns the job (with the Xero numbers saved on the statement) and one
 * result per document.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import { raiseStatementDocs } from '@/lib/xero/statementDocs'

export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  if (!seesFinancials(guard.role as Parameters<typeof seesFinancials>[0])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const raised = await raiseStatementDocs(guard.supabase, guard.orgId, id)
  const { data: job } = await guard.supabase.from('jobs').select('*').eq('id', id).eq('org_id', guard.orgId).maybeSingle()
  if (!raised.ok) return NextResponse.json({ error: raised.error, results: raised.results, job }, { status: raised.status })
  return NextResponse.json({ results: raised.results, job })
}
