/*
 * lib/tracking/route.ts
 *
 * Shared checks for the /api/tracking routes: the host's brand, the session,
 * and that the signed-in person may see the job.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { TradingNameId } from '@/lib/tradingNames'
import { trackingIsShared, trackingTradingNameFromRequest } from '@/lib/tracking/header'
import { trackingSessionFromRequest, type TrackingClaims } from '@/lib/tracking/session'
import { viewerJobs, type ViewerJob } from '@/lib/tracking/server'

type Supabase = ReturnType<typeof createServiceClient>

export type ViewerGate =
  | { ok: true; supabase: Supabase; tradingName: TradingNameId; session: TrackingClaims; jobs: ViewerJob[] }
  | { ok: false; response: NextResponse }

export async function gateViewer(req: Request): Promise<ViewerGate> {
  const tradingName = trackingTradingNameFromRequest(req)
  if (!tradingName) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const session = await trackingSessionFromRequest(req, tradingName)
  if (!session) return { ok: false, response: NextResponse.json({ error: 'Signed out' }, { status: 401 }) }
  const supabase = createServiceClient()
  const jobs = await viewerJobs(supabase, session.identity, tradingName, trackingIsShared(req))
  return { ok: true, supabase, tradingName, session, jobs }
}
