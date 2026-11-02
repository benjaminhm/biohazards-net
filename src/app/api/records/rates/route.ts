import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { getRates, saveRates } from '@/lib/jobRecordsStore'
import type { RateCard } from '@/lib/jobRecords'

export async function GET(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const result = await getRates(gate.supabase, gate.orgId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ rates: result.data })
}

export async function PATCH(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const rates: RateCard = {
    biohazard_cents: Math.round(Number(body.biohazard_cents)),
    meth_cents: Math.round(Number(body.meth_cents)),
    mould_cents: Math.round(Number(body.mould_cents)),
    hoarding_cents_per_m3: Math.round(Number(body.hoarding_cents_per_m3)),
    squalor_cents_per_m2: Math.round(Number(body.squalor_cents_per_m2)),
  }
  if (Object.values(rates).some(value => !Number.isFinite(value) || value < 0)) {
    return NextResponse.json({ error: 'Enter amounts in cents.' }, { status: 400 })
  }
  const result = await saveRates(gate.supabase, gate.orgId, gate.userId, rates)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ rates: result.data })
}
