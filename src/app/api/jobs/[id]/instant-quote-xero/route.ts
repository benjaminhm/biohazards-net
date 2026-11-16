/*
 * POST /api/jobs/[id]/instant-quote-xero
 *
 * Raise the saved Fast Quote in Xero as a draft quote with its scope of work
 * and terms on it, or update the draft from the saved Fast Quote. Staff send
 * it from Xero. Returns the job (with the Xero quote number saved on the Fast
 * Quote) and what was done.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import { raiseFastQuote } from '@/lib/xero/fastQuote'

export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  if (!seesFinancials(guard.role as Parameters<typeof seesFinancials>[0])) {
    return NextResponse.json({ error: 'Your role cannot create quotes in Xero.' }, { status: 403 })
  }
  const { id } = await params
  const raised = await raiseFastQuote(guard.supabase, guard.orgId, id)
  const { data: job } = await guard.supabase.from('jobs').select('*').eq('id', id).eq('org_id', guard.orgId).maybeSingle()
  if (!raised.ok) return NextResponse.json({ error: raised.error, job }, { status: raised.status })
  return NextResponse.json({ result: raised.result, job })
}
