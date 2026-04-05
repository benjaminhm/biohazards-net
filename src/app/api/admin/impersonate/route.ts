/*
 * app/api/admin/impersonate/route.ts
 *
 * POST   — start impersonation (platform admin only). Sets httpOnly JWT cookie.
 * DELETE — end session, clear cookie, audit.
 * GET    — current session status (for /admin UI).
 *
 * Requires IMPERSONATION_SECRET (min 32 chars) and impersonation_audit table.
 */
import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isPlatformAdmin } from '@/lib/platformAdmin'
import {
  IMPERSONATION_COOKIE,
  signImpersonationToken,
  verifyImpersonationToken,
} from '@/lib/impersonation'

export async function GET() {
  const { userId } = await auth()
  if (!userId || !isPlatformAdmin(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cookieStore = await cookies()
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value
  if (!raw) return NextResponse.json({ active: false })

  const claims = await verifyImpersonationToken(raw, userId)
  if (!claims) return NextResponse.json({ active: false })

  return NextResponse.json({
    active: true,
    org_id: claims.orgId,
    org_slug: claims.orgSlug,
    org_name: claims.orgName,
    read_only: claims.readOnly,
  })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !isPlatformAdmin(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { org_id?: string; reason?: string; read_only?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = body.org_id?.trim()
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const readOnly = body.read_only !== false

  try {
    const supabase = createServiceClient()
    const { data: org, error: orgErr } = await supabase
      .from('orgs')
      .select('id, name, slug')
      .eq('id', orgId)
      .eq('is_active', true)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organisation not found or inactive' }, { status: 404 })
    }

    const token = await signImpersonationToken(userId, {
      orgId: org.id as string,
      orgSlug: org.slug as string,
      orgName: org.name as string,
      readOnly,
    })

    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 2000) : null

    await supabase.from('impersonation_audit').insert({
      actor_clerk_id: userId,
      org_id: org.id,
      action: 'start',
      reason,
      read_only: readOnly,
    })

    const cookieStore = await cookies()
    cookieStore.set(IMPERSONATION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7200,
    })

    return NextResponse.json({
      ok: true,
      org_id: org.id,
      org_slug: org.slug,
      read_only: readOnly,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed'
    if (msg.includes('IMPERSONATION_SECRET')) {
      return NextResponse.json(
        {
          error:
            'Server misconfigured: add IMPERSONATION_SECRET to .env.local next to package.json (32+ characters, e.g. openssl rand -hex 32), then restart npm run dev.',
        },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE() {
  const { userId } = await auth()
  if (!userId || !isPlatformAdmin(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cookieStore = await cookies()
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value

  if (raw) {
    const claims = await verifyImpersonationToken(raw, userId)
    if (claims) {
      const supabase = createServiceClient()
      await supabase.from('impersonation_audit').insert({
        actor_clerk_id: userId,
        org_id: claims.orgId,
        action: 'end',
        read_only: claims.readOnly,
      })
    }
  }

  cookieStore.delete(IMPERSONATION_COOKIE)

  return NextResponse.json({ ok: true })
}
