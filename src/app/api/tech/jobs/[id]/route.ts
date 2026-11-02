import { NextResponse } from 'next/server'
import { requireTechnician } from '@/lib/recordsAuth'
import {
  acceptJob,
  addNote,
  clockOff,
  clockOn,
  closeJob,
  getTechJob,
  saveComment,
  saveStep,
  startDwell,
} from '@/lib/jobRecordsStore'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTechnician()
  if (!gate.ok) return gate.response
  const { id } = await params
  const result = await getTechJob(gate.supabase, gate.orgId, gate.personId!, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTechnician()
  if (!gate.ok) return gate.response
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? '')
  const personId = gate.personId!
  const lat = body.lat == null ? null : Number(body.lat)
  const lng = body.lng == null ? null : Number(body.lng)
  const point = {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  }
  const result = action === 'accept'
    ? await acceptJob(gate.supabase, gate.orgId, personId, id)
    : action === 'clock_on'
      ? await clockOn(gate.supabase, gate.orgId, personId, id, point.lat, point.lng)
      : action === 'clock_off'
        ? await clockOff(gate.supabase, gate.orgId, personId, id, point.lat, point.lng)
        : action === 'note'
          ? await addNote(gate.supabase, gate.orgId, personId, id, String(body.body ?? ''))
          : action === 'step'
            ? await saveStep(gate.supabase, gate.orgId, personId, id, String(body.step_id ?? ''), {
                note_text: typeof body.note_text === 'string' ? body.note_text : undefined,
                test_text: typeof body.test_text === 'string' ? body.test_text : undefined,
                ticks: Array.isArray(body.ticks) ? body.ticks.map((item: unknown) => item === true) : undefined,
                skip: body.skip === true,
              })
            : action === 'dwell'
              ? await startDwell(gate.supabase, gate.orgId, personId, id, String(body.step_id ?? ''), String(body.chemical_id ?? ''))
              : action === 'close'
                ? await closeJob(gate.supabase, gate.orgId, personId, id, Number(body.pending_uploads ?? 0))
                : action === 'comment'
                  ? await saveComment(gate.supabase, gate.orgId, personId, id, String(body.body ?? ''))
                  : { ok: false as const, error: 'Unknown action.', status: 400 }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
