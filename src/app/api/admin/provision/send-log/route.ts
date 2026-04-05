/*
 * GET /api/admin/provision/send-log?org_id=uuid
 *
 * Recent platform invite email/SMS sends for an org (audit).
 * Platform admin only.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const ids = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.includes(userId)
}

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = new URL(req.url).searchParams.get('org_id')?.trim()
  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('platform_invite_send_log')
    .select('id, person_id, channel, recipient, org_name, admin_name, invite_url, provider_id, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sends: data ?? [] })
}
