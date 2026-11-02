import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { reorderTemplateSteps } from '@/lib/jobRecordsStore'

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
  const result = await reorderTemplateSteps(gate.supabase, gate.orgId, String(body?.job_type ?? ''), ids)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
