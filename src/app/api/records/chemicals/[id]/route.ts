import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { updateChemical } from '@/lib/jobRecordsStore'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const result = await updateChemical(gate.supabase, gate.orgId, id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    dwell_minutes: body.dwell_minutes == null ? undefined : Number(body.dwell_minutes),
    archive: body.archive === true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
