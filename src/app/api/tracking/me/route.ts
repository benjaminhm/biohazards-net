/*
 * app/api/tracking/me/route.ts
 *
 * GET — the signed-in person, the brand, and the jobs they can follow.
 */
import { NextResponse } from 'next/server'
import { tradingNameLabel } from '@/lib/tradingNames'
import { trackingTradingNameFromRequest } from '@/lib/tracking/header'
import { gateViewer } from '@/lib/tracking/route'

export async function GET(req: Request) {
  const tradingName = trackingTradingNameFromRequest(req)
  const brand = tradingNameLabel(tradingName) ?? 'Job updates'
  const g = await gateViewer(req)
  if (!g.ok) {
    return g.response.status === 401
      ? NextResponse.json({ signedIn: false, brand }, { headers: { 'Cache-Control': 'no-store' } })
      : g.response
  }
  return NextResponse.json(
    {
      signedIn: true,
      brand,
      name: g.jobs[0]?.viewerName ?? '',
      jobs: g.jobs.map(j => ({ id: j.jobId, title: j.siteAddress || j.clientName || 'Your job' })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
