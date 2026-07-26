/*
 * POST /api/documents/[id]/release — show or hide a document in the client's
 * commercial accounts portal.
 *
 * Body: { released: boolean }
 *
 * Sibling routes under /api/documents/[id] are intentionally unauthenticated
 * because the public print route reads through them, so this action gets its own
 * guarded route. Releasing a document is a client-facing send: it is what makes a
 * completion report or quote appear in the portal, so it is gated to the same
 * roles that own the full job file.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { verifyImpersonationFromRequest } from '@/lib/impersonation'

const RELEASE_ROLES = new Set(['admin', 'owner', 'manager', 'team_lead'])

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  const { orgId } = await getOrgId(req, userId ?? null)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const impersonation = await verifyImpersonationFromRequest(req, userId)
  if (impersonation?.orgId !== orgId) {
    const { data: orgUser } = await supabase
      .from('org_users')
      .select('role')
      .eq('clerk_user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle()
    const role = (orgUser?.role as string | null)?.trim().toLowerCase()
    if (!role || !RELEASE_ROLES.has(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let released: boolean
  try {
    const body = await req.json()
    released = body?.released === true
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('documents')
    .update({
      released_to_portal_at: released ? new Date().toISOString() : null,
      released_by_user_id: released ? userId : null,
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, released_to_portal_at, released_by_user_id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  return NextResponse.json({ document: data })
}
