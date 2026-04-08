/*
 * app/api/invites/route.ts
 *
 * POST /api/invites — create a new invite token for the current org.
 * Only org admins can create invites.
 *
 * Generates a cryptographically random 32-byte hex token (64 chars) as the
 * invite URL token. The token is stored in the invites table with the org,
 * role, and optional person_id so the claim step can link the person profile
 * automatically when the invite is accepted.
 *
 * The invite URL is constructed client-side as: /invite/[token]
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { resolveActiveMembership } from '@/lib/membership'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // Verify user has owner/admin role in this org
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org context' }, { status: 400 })

  const activeMembership = await resolveActiveMembership(userId)
  const orgUser = activeMembership.membership

  if (!orgUser || orgUser.org_id !== orgId || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { role = 'member', label, person_id } = await req.json()
  const token = randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('invites')
    .insert({ org_id: orgId, role, label: label || null, invited_by: userId, token, person_id: person_id || null })
    .select('token')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ token: data.token })
}
