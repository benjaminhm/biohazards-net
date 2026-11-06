/*
 * GET /api/jobs/[id]/xero-deposit
 *
 * What has been paid on the job's Xero invoice, to prefill the Statement of
 * Accounts deposit. Read only; never writes to Xero. { connected: false }
 * when Xero is not set up for the organisation.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import { jobInvoicePaid } from '@/lib/xero/payments'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  if (!seesFinancials(guard.role as Parameters<typeof seesFinancials>[0])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  try {
    return NextResponse.json(await jobInvoicePaid(guard.supabase, guard.orgId, id))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Reading the Xero invoice failed' }, { status: 502 })
  }
}
