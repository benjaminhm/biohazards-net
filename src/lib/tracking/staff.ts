/*
 * lib/tracking/staff.ts
 *
 * Staff access to a job's client feed. Anyone with the full job file (admin,
 * owner, manager, team lead) sees it and can show, hide and caption photos.
 * Turning the feed on, choosing who can view it, and replying to clients is
 * for admins, owners and managers.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { createServiceClient } from '@/lib/supabase'

const MANAGE_ROLES = new Set(['admin', 'owner', 'manager'])

export interface StaffFeedJob {
  id: string
  trading_name: string | null
  client_feed_enabled: boolean
  client_name: string | null
  client_phone: string | null
  client_email: string | null
  client_account_id: string | null
}

export type StaffFeedGate =
  | {
      ok: true
      supabase: ReturnType<typeof createServiceClient>
      orgId: string
      userId: string
      canManage: boolean
      job: StaffFeedJob
    }
  | { ok: false; response: NextResponse }

export async function gateStaffFeed(req: Request, jobId: string, opts: { manage?: boolean } = {}): Promise<StaffFeedGate> {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g
  const canManage = MANAGE_ROLES.has(g.role)
  if (opts.manage && !canManage) {
    return { ok: false, response: NextResponse.json({ error: 'Only admins and managers can do this.' }, { status: 403 }) }
  }
  const { data: job } = await g.supabase
    .from('jobs')
    .select('id, trading_name, client_feed_enabled, client_name, client_phone, client_email, client_account_id')
    .eq('id', jobId)
    .eq('org_id', g.orgId)
    .maybeSingle()
  if (!job) return { ok: false, response: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
  return { ok: true, supabase: g.supabase, orgId: g.orgId, userId: g.userId, canManage, job: job as StaffFeedJob }
}

/** The signed-in staff member's name, for "added by" and replies. */
export async function staffName(supabase: ReturnType<typeof createServiceClient>, orgId: string, userId: string): Promise<string> {
  const { data: me } = await supabase.from('org_users').select('person_id').eq('clerk_user_id', userId).eq('org_id', orgId).maybeSingle()
  const personId = (me as { person_id?: string | null } | null)?.person_id
  if (!personId) return ''
  const { data: person } = await supabase.from('people').select('name').eq('id', personId).maybeSingle()
  return ((person as { name?: string } | null)?.name ?? '').trim()
}
