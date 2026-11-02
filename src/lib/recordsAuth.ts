import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { resolveActiveMembership } from '@/lib/membership'

type Gate =
  | { ok: true; userId: string; orgId: string; personId: string | null; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse }

function denied(status: number, error: string): Gate {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

export async function requireRecordAdmin(req: Request): Promise<Gate> {
  const { userId } = await auth()
  if (!userId) return denied(401, 'Unauthorized')
  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return denied(400, 'No org')
  const { data: me } = await supabase
    .from('org_users')
    .select('role, person_id')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!me || (me.role !== 'admin' && me.role !== 'owner')) return denied(403, 'Forbidden')
  return { ok: true, userId, orgId, personId: me.person_id ?? null, supabase }
}

export async function requireTechnician(): Promise<Gate> {
  const { userId } = await auth()
  if (!userId) return denied(401, 'Unauthorized')
  const resolved = await resolveActiveMembership(userId)
  const membership = resolved.membership
  if (!membership || membership.role !== 'member' || !membership.person_id) return denied(403, 'Forbidden')
  return {
    ok: true,
    userId,
    orgId: membership.org_id,
    personId: membership.person_id,
    supabase: createServiceClient(),
  }
}
