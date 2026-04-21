/*
 * lib/brainDump/guard.ts
 *
 * Shared auth guard for Brain Dump API routes. Brain Dump is org-admin only
 * (per product spec — it's a management surface, not a field tool) AND
 * per-user-private (every admin has their own list). This helper handles
 * the three common checks:
 *   1. Clerk session
 *   2. Active org membership
 *   3. org_users.role === 'admin'
 *
 * It returns both orgId AND userId so each route can (and must) filter
 * queries by BOTH — cross-org isolation on org_id, per-user isolation on
 * owner_user_id. Bailing returns a NextResponse ready to return.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export interface BrainDumpContext {
  userId: string
  orgId: string
  supabase: ReturnType<typeof createServiceClient>
}

export type BrainDumpGuardResult =
  | { ok: true; ctx: BrainDumpContext }
  | { ok: false; response: NextResponse }

export async function guardBrainDump(req: Request): Promise<BrainDumpGuardResult> {
  const { userId } = await auth()
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { orgId } = await getOrgId(req, userId)
  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      ),
    }
  }

  const supabase = createServiceClient()
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (!orgUser || orgUser.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ok: true, ctx: { userId, orgId, supabase } }
}
