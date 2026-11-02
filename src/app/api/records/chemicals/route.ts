import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { createChemical, listChemicals } from '@/lib/jobRecordsStore'

export async function GET(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const result = await listChemicals(gate.supabase, gate.orgId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ chemicals: result.data })
}

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null)
  const result = await createChemical(gate.supabase, gate.orgId, String(body?.name ?? ''), Number(body?.dwell_minutes))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
