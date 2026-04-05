/*
 * POST /api/admin/invitations/[id]/resend — revoke the invite and create a fresh one with the same
 * email and public metadata (platform admins only). Returns the new invitation including url.
 */
import type { ClerkClient } from '@clerk/backend'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/platformAdmin'

async function findInvitationById(clerk: ClerkClient, id: string) {
  const limit = 100
  let offset = 0
  for (let guard = 0; guard < 50; guard++) {
    const res = await clerk.invitations.getInvitationList({ limit, offset })
    const batch = res.data ?? []
    const hit = batch.find(i => i.id === id)
    if (hit) return hit
    if (batch.length < limit) break
    offset += limit
  }
  return null
}

function redirectFromMetadata(meta: Record<string, unknown> | null | undefined) {
  const slug = meta && typeof meta.invited_to_org === 'string' ? meta.invited_to_org.trim() : ''
  if (slug) return `https://${slug}.biohazards.net/`
  return `https://app.biohazards.net/`
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing invitation id' }, { status: 400 })
  }

  const clerk = await clerkClient()
  const existing = await findInvitationById(clerk, id.trim())
  if (!existing) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }
  if (existing.status !== 'pending') {
    return NextResponse.json(
      { error: `Only pending invitations can be resent (status: ${existing.status})` },
      { status: 400 }
    )
  }

  const meta = (existing.publicMetadata ?? null) as Record<string, unknown> | null
  const redirectUrl = redirectFromMetadata(meta)

  try {
    await clerk.invitations.revokeInvitation(id.trim())
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Revoke failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  try {
    const created = await clerk.invitations.createInvitation({
      emailAddress: existing.emailAddress,
      redirectUrl,
      publicMetadata: meta ?? {},
      ignoreExisting: true,
    })
    return NextResponse.json({
      invitation: {
        id: created.id,
        emailAddress: created.emailAddress,
        status: created.status,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        url: created.url ?? null,
        revoked: created.revoked ?? false,
        publicMetadata: (created.publicMetadata ?? null) as Record<string, unknown> | null,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to create replacement invite'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
