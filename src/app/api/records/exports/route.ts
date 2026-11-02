import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { exportBonuses, exportTimesheets } from '@/lib/jobRecordsStore'
import { brisbaneMonth, brisbaneWeekStart } from '@/lib/jobRecords'

export async function GET(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  if (kind === 'timesheet') {
    const week = url.searchParams.get('week') || brisbaneWeekStart(new Date())
    const result = await exportTimesheets(gate.supabase, gate.orgId, week)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return new NextResponse(result.data, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="timesheets-${week}.csv"`,
      },
    })
  }
  if (kind === 'bonus') {
    const month = url.searchParams.get('month') || brisbaneMonth(new Date())
    const result = await exportBonuses(gate.supabase, gate.orgId, month)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return new NextResponse(result.data, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bonuses-${month}.csv"`,
      },
    })
  }
  return NextResponse.json({ error: 'Choose timesheet or bonus.' }, { status: 400 })
}
