/*
 * app/api/me/profile/route.ts
 *
 * GET  /api/me/profile — fetch the current user's own people record
 * PATCH /api/me/profile — update own people record (self-service profile completion)
 *
 * Used by the onboarding checklist so team members can complete their profile
 * without needing admin access to /team/[id].
 *
 * Only fields safe for self-editing are accepted on PATCH:
 *   phone, email, address, abn, emergency_contact, emergency_phone
 * Name and role are admin-controlled and cannot be changed here.
 *
 * Returns 404 if the user's org_users row has no person_id linked yet
 * (admin hasn't created their profile or sent them an invite with person_id).
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeOptionalPhoneField } from '@/lib/phone'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // Get person_id from org_users
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('person_id, org_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!orgUser?.person_id) {
    return NextResponse.json({ person: null })
  }

  const { data: person, error } = await supabase
    .from('people')
    .select('id, name, phone, email, address, abn, emergency_contact, emergency_phone, role')
    .eq('id', orgUser.person_id)
    .eq('org_id', orgUser.org_id)
    .single()

  if (error) return NextResponse.json({ person: null })
  return NextResponse.json({ person })
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data: orgUser } = await supabase
    .from('org_users')
    .select('person_id, org_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!orgUser?.person_id) {
    return NextResponse.json({ error: 'No profile linked to your account' }, { status: 404 })
  }

  // Only allow self-editable fields — name and role stay admin-controlled
  const body = await req.json()
  const allowed: Record<string, string | null> = {}
  const SELF_EDIT_FIELDS = ['phone', 'email', 'address', 'abn', 'emergency_contact', 'emergency_phone'] as const
  const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

  for (const key of SELF_EDIT_FIELDS) {
    if (!(key in body)) continue
    if (key === 'phone' || key === 'emergency_phone') {
      const r = normalizeOptionalPhoneField(body[key])
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
      if (r.value === undefined) continue
      allowed[key] = r.value
    } else if (key === 'email') {
      const v = body[key]
      if (v === undefined) continue
      if (v === null || v === '') {
        allowed[key] = null
        continue
      }
      if (typeof v !== 'string') return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
      const t = v.trim()
      if (!t) {
        allowed[key] = null
        continue
      }
      if (!emailOk(t)) return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
      allowed[key] = t
    } else {
      allowed[key] = body[key]
    }
  }

  const { data: person, error } = await supabase
    .from('people')
    .update(allowed)
    .eq('id', orgUser.person_id)
    .eq('org_id', orgUser.org_id)
    .select('id, name, phone, email, address, abn, emergency_contact, emergency_phone, role')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ person })
}
