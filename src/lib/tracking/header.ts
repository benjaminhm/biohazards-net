/*
 * lib/tracking/header.ts
 *
 * The trading brand of a tracking.<brand>.com.au request, set by the proxy from
 * the host. Kept separate so the proxy does not pull in server-only code.
 */
import { isTradingNameId } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export const TRACKING_TRADING_NAME_HEADER = 'x-tracking-trading-name'

export function trackingTradingNameFromRequest(req: Request): TradingNameId | null {
  const value = req.headers.get(TRACKING_TRADING_NAME_HEADER)
  return isTradingNameId(value) ? value : null
}
