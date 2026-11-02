import { NextResponse } from 'next/server'
import { requireTechnician } from '@/lib/recordsAuth'
import { savePhoto } from '@/lib/jobRecordsStore'

export async function POST(req: Request) {
  const gate = await requireTechnician()
  if (!gate.ok) return gate.response
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing photo.' }, { status: 400 })
  const bytes = Buffer.from(await file.arrayBuffer())
  const lat = Number(form.get('lat'))
  const lng = Number(form.get('lng'))
  const result = await savePhoto(gate.supabase, gate.orgId, gate.personId!, {
    jobId: String(form.get('job_id') ?? ''),
    stepId: String(form.get('step_id') ?? ''),
    bytes,
    deviceTime: String(form.get('device_time') ?? ''),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
