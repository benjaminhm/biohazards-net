import { NextResponse } from 'next/server'
import { requireTechnician } from '@/lib/recordsAuth'
import { listTechJobs } from '@/lib/jobRecordsStore'

export async function GET() {
  const gate = await requireTechnician()
  if (!gate.ok) return gate.response
  const result = await listTechJobs(gate.supabase, gate.orgId, gate.personId!)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ jobs: result.data })
}
