import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { getAdminRecord, patchRecordJob } from '@/lib/jobRecordsStore'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await params
  const result = await getAdminRecord(gate.supabase, gate.orgId, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const result = await patchRecordJob(gate.supabase, gate.orgId, gate.userId, id, {
    quoted_m3: body.quoted_m3 === undefined ? undefined : (body.quoted_m3 === null || body.quoted_m3 === '' ? null : Number(body.quoted_m3)),
    quoted_m2: body.quoted_m2 === undefined ? undefined : (body.quoted_m2 === null || body.quoted_m2 === '' ? null : Number(body.quoted_m2)),
    archive: body.archive === true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
