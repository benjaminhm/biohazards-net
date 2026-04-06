/*
 * app/api/website/generate/route.ts
 *
 * POST — AI website generation pipeline (stub). Authenticated org members only.
 *
 * Future: load company_profile, call model(s), write static assets or CMS entries,
 * trigger deploy. For now returns success so the client can proceed to launch (website_live).
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOrgId } from '@/lib/org'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No organisation' }, { status: 400 })

  // Optional: read body for template / tone overrides later
  await req.json().catch(() => ({}))

  return NextResponse.json({
    ok: true,
    stub: true,
    org_id: orgId,
    message: 'AI website generation is not implemented yet — no files were written. Launch will still publish your profile to the public site.',
  })
}
