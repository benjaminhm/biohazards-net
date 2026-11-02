import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { archiveTemplateStep, updateTemplateStep } from '@/lib/jobRecordsStore'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const result = await updateTemplateStep(gate.supabase, gate.orgId, id, {
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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await params
  const result = await archiveTemplateStep(gate.supabase, gate.orgId, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
