import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { createTemplateStep, listTemplates } from '@/lib/jobRecordsStore'

export async function GET(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const result = await listTemplates(gate.supabase, gate.orgId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ templates: result.data })
}

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const result = await createTemplateStep(gate.supabase, gate.orgId, {
    job_type: String(body.job_type ?? ''),
    title: String(body.title ?? ''),
    instruction: String(body.instruction ?? ''),
    step_type: String(body.step_type ?? ''),
    required: body.required !== false,
    min_photos: Number(body.min_photos ?? 1),
    checklist_items: Array.isArray(body.checklist_items) ? body.checklist_items.map(String) : [],
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
