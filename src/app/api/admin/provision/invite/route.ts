/*
 * app/api/admin/provision/invite/route.ts
 *
 * POST /api/admin/provision/invite — generate a fresh invite for an existing
 * person in an org. Used by the company profile page to refresh expired invites
 * or create one where none exists yet.
 *
 * Platform admin only.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminIds.includes(userId)
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { org_id, person_id } = await req.json()
  if (!org_id || !person_id) {
    return NextResponse.json({ error: 'org_id and person_id are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const token = randomBytes(32).toString('hex')
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: invite, error } = await supabase
    .from('invites')
    .insert({
      org_id,
      role: 'admin',
      person_id,
      invited_by: userId,
      token,
      expires_at,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    invite_token: invite.token,
    invite_url: `https://app.biohazards.net/invite/${invite.token}`,
  })
}
