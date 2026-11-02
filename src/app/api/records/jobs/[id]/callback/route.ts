import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { markCallback } from '@/lib/jobRecordsStore'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const result = await markCallback(gate.supabase, gate.orgId, gate.userId, id, String(body.reason ?? ''))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
