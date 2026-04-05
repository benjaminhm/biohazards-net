/*
 * GET /api/admin/invitations — list Clerk sign-up invitations (platform admins only).
 * Paginates through Clerk’s API and returns newest-first.
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/platformAdmin'

export type SerializedInvitation = {
  id: string
  emailAddress: string
  status: string
  createdAt: number
  updatedAt: number
  url: string | null
  revoked: boolean
  publicMetadata: Record<string, unknown> | null
}

function serialize(inv: {
  id: string
  emailAddress: string
  status: string
  createdAt: number
  updatedAt: number
  url?: string
  revoked?: boolean
  publicMetadata: Record<string, unknown> | null
}): SerializedInvitation {
  return {
    id: inv.id,
    emailAddress: inv.emailAddress,
    status: inv.status,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    url: inv.url ?? null,
    revoked: inv.revoked ?? false,
    publicMetadata: inv.publicMetadata ?? null,
  }
}

export async function GET() {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const clerk = await clerkClient()
  const all: SerializedInvitation[] = []
  const limit = 100
  let offset = 0

  for (let guard = 0; guard < 50; guard++) {
    const res = await clerk.invitations.getInvitationList({ limit, offset })
    const batch = res.data ?? []
    for (const inv of batch) {
      all.push(serialize(inv))
    }
    if (batch.length < limit) break
    offset += limit
  }

  all.sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ invitations: all })
}
