/*
 * lib/xero/admin.ts
 *
 * Guard for the Xero settings routes: signed-in staff with the admin role.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { resolveActiveMembership } from '@/lib/membership'

export async function requireXeroAdmin(): Promise<{ userId: string; orgId: string } | { response: NextResponse }> {
  const { userId } = await auth()
  if (!userId) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { membership } = await resolveActiveMembership(userId)
  if (!membership || membership.role !== 'admin') {
    return { response: NextResponse.json({ error: 'Only admins can manage the Xero connection' }, { status: 403 }) }
  }
  return { userId, orgId: membership.org_id }
}
