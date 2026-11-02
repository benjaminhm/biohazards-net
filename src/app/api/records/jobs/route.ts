import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { createRecordJob, listRecordJobs } from '@/lib/jobRecordsStore'

export async function GET(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const status = new URL(req.url).searchParams.get('status')
  const result = await listRecordJobs(gate.supabase, gate.orgId, status)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ jobs: result.data })
}

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const result = await createRecordJob(gate.supabase, gate.orgId, gate.userId, {
    address: String(body.address ?? ''),
    client_reference: String(body.client_reference ?? ''),
    job_type: String(body.job_type ?? ''),
    quoted_m3: body.quoted_m3 == null || body.quoted_m3 === '' ? null : Number(body.quoted_m3),
    quoted_m2: body.quoted_m2 == null || body.quoted_m2 === '' ? null : Number(body.quoted_m2),
    assigned_person_id: String(body.assigned_person_id ?? ''),
    lead: body.lead === true,
    lead_uplift_percent: Number(body.lead_uplift_percent ?? 0),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
