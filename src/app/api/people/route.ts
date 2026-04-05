/*
 * app/api/people/route.ts
 *
 * GET  /api/people — list all active team members for the org, including
 *   their compliance documents (people_documents join)
 * POST /api/people — create a new team member profile
 *
 * The people table is the staff directory — separate from org_users which
 * tracks Clerk authentication. A person can exist without a linked org_users
 * row (e.g. subcontractors not given app access). The person_id column on
 * org_users links the two when a person is also an app user.
 *
 * Note: this file creates its own Supabase client rather than using
 * createServiceClient() — functionally identical, just older pattern.
 */
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOrgId as resolveOrgId } from '@/lib/org'
import { normalizeOptionalPhoneField } from '@/lib/phone'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await resolveOrgId(req, userId)
  if (!orgId) return NextResponse.json({ people: [] })

  const { data, error } = await supabase
    .from('people')
    .select(`*, people_documents(id, doc_type, label, expiry_date, file_url)`)
    .eq('org_id', orgId)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ people: data ?? [] })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await resolveOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const body = (await req.json()) as Record<string, unknown>
  const row: Record<string, unknown> = { ...body, org_id: orgId }
  for (const key of ['phone', 'emergency_phone'] as const) {
    if (!(key in row)) continue
    const r = normalizeOptionalPhoneField(row[key])
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    if (r.value === undefined) delete row[key]
    else row[key] = r.value
  }
  const { data, error } = await supabase
    .from('people')
    .insert(row)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ person: data })
}
