/*
 * app/api/admin/invite/route.ts
 *
 * POST /api/admin/invite — platform-level Clerk invitation.
 * Restricted to PLATFORM_ADMIN_CLERK_IDS (not org admins — this is for
 * onboarding new businesses onto the platform).
 *
 * Sends a Clerk sign-up invitation email. The redirectUrl takes the new user
 * directly to their org's subdomain after signup, or the main app if no slug.
 * ignoreExisting: true prevents errors when re-inviting the same email.
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const PLATFORM_ADMIN_IDS = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !PLATFORM_ADMIN_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, org_slug } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const redirectUrl = org_slug
    ? `https://${org_slug}.biohazards.net/`
    : `https://app.biohazards.net/`

  const clerk = await clerkClient()
  await clerk.invitations.createInvitation({
    emailAddress: email,
    redirectUrl,
    publicMetadata: { invited_to_org: org_slug ?? null },
    ignoreExisting: true,
  })

  return NextResponse.json({ ok: true })
}
