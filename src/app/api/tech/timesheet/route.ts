import { NextResponse } from 'next/server'
import { requireTechnician } from '@/lib/recordsAuth'
import { timesheetFor } from '@/lib/jobRecordsStore'
import { brisbaneWeekStart } from '@/lib/jobRecords'

export async function GET(req: Request) {
  const gate = await requireTechnician()
  if (!gate.ok) return gate.response
  const week = new URL(req.url).searchParams.get('week') || brisbaneWeekStart(new Date())
  const result = await timesheetFor(gate.supabase, gate.orgId, gate.personId!, week)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
