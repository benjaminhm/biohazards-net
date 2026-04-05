/*
 * DELETE /api/admin/invitations/[id] — revoke a pending Clerk invitation (platform admins only).
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/platformAdmin'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing invitation id' }, { status: 400 })
  }

  try {
    const clerk = await clerkClient()
    await clerk.invitations.revokeInvitation(id.trim())
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Revoke failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
