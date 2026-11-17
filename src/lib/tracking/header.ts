/*
 * lib/tracking/header.ts
 *
 * The trading brand of a tracking.<brand>.com.au request, set by the proxy from
 * the host. Kept separate so the proxy does not pull in server-only code.
 *
 * On the shared host (tracking.biohazards.net) the proxy also sets the shared
 * header: a client there sees their jobs on every brand. The proxy removes any
 * copy of it a browser sends.
 */
import { isTradingNameId } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export const TRACKING_TRADING_NAME_HEADER = 'x-tracking-trading-name'
export const TRACKING_SHARED_HEADER = 'x-tracking-shared'

export function trackingTradingNameFromRequest(req: Request): TradingNameId | null {
  const value = req.headers.get(TRACKING_TRADING_NAME_HEADER)
  return isTradingNameId(value) ? value : null
}

export function trackingIsShared(req: Request): boolean {
  return req.headers.get(TRACKING_SHARED_HEADER) === '1'
}
