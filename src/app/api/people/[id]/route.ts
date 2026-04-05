/*
 * app/api/people/[id]/route.ts
 *
 * GET    /api/people/[id] — fetch a single person with their compliance documents
 * PATCH  /api/people/[id] — update person profile fields
 * DELETE /api/people/[id] — remove a team member from the org
 *
 * Scoped by org_id from tenant resolution (including platform impersonation).
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await resolveOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })
  const { id } = await params

  const { data, error } = await supabase
    .from('people')
    .select(`*, people_documents(*)`)
    .eq('id', id)
    .eq('org_id', orgId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ person: data })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await resolveOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as Record<string, unknown>
  const patch: Record<string, unknown> = { ...body }
  for (const key of ['phone', 'emergency_phone'] as const) {
    if (!(key in patch)) continue
    const r = normalizeOptionalPhoneField(patch[key])
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    if (r.value === undefined) delete patch[key]
    else patch[key] = r.value
  }

  const { data, error } = await supabase
    .from('people')
    .update(patch)
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ person: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await resolveOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })
  const { id } = await params

  const { error } = await supabase.from('people').delete().eq('id', id).eq('org_id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
