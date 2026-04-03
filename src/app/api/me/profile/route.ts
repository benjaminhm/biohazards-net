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
 *   phone, address, abn, emergency_contact, emergency_phone
 * Name and role are admin-controlled and cannot be changed here.
 *
 * Returns 404 if the user's org_users row has no person_id linked yet
 * (admin hasn't created their profile or sent them an invite with person_id).
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

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
  const allowed: Record<string, string> = {}
  const SELF_EDIT_FIELDS = ['phone', 'address', 'abn', 'emergency_contact', 'emergency_phone']
  for (const key of SELF_EDIT_FIELDS) {
    if (key in body) allowed[key] = body[key]
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
