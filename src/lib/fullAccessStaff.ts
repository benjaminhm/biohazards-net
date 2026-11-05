/*
 * lib/fullAccessStaff.ts
 *
 * Guard for staff surfaces that need the full job file (admin, owner, manager,
 * team lead). Returns the org and user, or a response to return.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

const FULL_ACCESS_ROLES = new Set(['admin', 'owner', 'manager', 'team_lead'])

export type FullAccessResult =
  | { ok: true; userId: string; orgId: string; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse }

export async function guardFullAccessStaff(req: Request): Promise<FullAccessResult> {
  const { userId } = await auth()
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) {
    return { ok: false, response: NextResponse.json({ error: 'Organisation inactive or you have no active organisation' }, { status: 403 }) }
  }
  const supabase = createServiceClient()
  const { data } = await supabase.from('org_users').select('role').eq('clerk_user_id', userId).eq('org_id', orgId).maybeSingle()
  if (!FULL_ACCESS_ROLES.has((data as { role?: string } | null)?.role ?? '')) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, userId, orgId, supabase }
}
