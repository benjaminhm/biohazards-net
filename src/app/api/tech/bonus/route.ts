import { NextResponse } from 'next/server'
import { requireTechnician } from '@/lib/recordsAuth'
import { bonusesFor } from '@/lib/jobRecordsStore'
import { brisbaneMonth } from '@/lib/jobRecords'

export async function GET(req: Request) {
  const gate = await requireTechnician()
  if (!gate.ok) return gate.response
  const month = new URL(req.url).searchParams.get('month') || brisbaneMonth(new Date())
  const result = await bonusesFor(gate.supabase, gate.orgId, gate.personId!, month)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
