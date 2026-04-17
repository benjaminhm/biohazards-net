/*
 * GET /api/company/chemicals/sds?path=<storage-path>
 *
 * Signed-URL proxy for SDS PDFs stored in the `company-assets` bucket under
 * `sds/<orgId>/...`. We NEVER hand out raw public URLs — SDSs can contain
 * proprietary formulation detail so the route enforces:
 *   1. User is authenticated.
 *   2. The requested path begins with `sds/<their-active-orgId>/` so a user in
 *      org A can't enumerate and pull org B's SDSs.
 *   3. We generate a short-lived signed URL and 302 redirect the browser.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

const SIGNED_TTL_SECONDS = 60 * 5

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 403 })

  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!path) return NextResponse.json({ error: 'path query param required' }, { status: 400 })

  const expectedPrefix = `sds/${orgId}/`
  if (!path.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Path does not belong to your organisation' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from('company-assets')
    .createSignedUrl(path, SIGNED_TTL_SECONDS)
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message || 'Could not sign SDS URL' },
      { status: 500 },
    )
  }
  return NextResponse.redirect(data.signedUrl)
}
