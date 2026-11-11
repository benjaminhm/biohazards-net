/*
 * GET    /api/xero — connection status for the admin's org (no tokens returned)
 * DELETE /api/xero — revoke at Xero and remove the stored connection
 *
 * Admin only.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireXeroAdmin } from '@/lib/xero/admin'
import { disconnectXero, xeroConfigured, xeroRedirectUri } from '@/lib/xero/client'

export async function GET(req: Request) {
  const guard = await requireXeroAdmin()
  if ('response' in guard) return guard.response
  const { data } = await createServiceClient()
    .from('xero_connections')
    .select('tenant_name, connected_at')
    .eq('org_id', guard.orgId)
    .maybeSingle()
  return NextResponse.json({
    configured: xeroConfigured(),
    connected: Boolean(data),
    tenant_name: data?.tenant_name ?? null,
    connected_at: data?.connected_at ?? null,
    redirect_uri: xeroRedirectUri(req),
  })
}

export async function DELETE() {
  const guard = await requireXeroAdmin()
  if ('response' in guard) return guard.response
  await disconnectXero(createServiceClient(), guard.orgId)
  return NextResponse.json({ ok: true })
}
