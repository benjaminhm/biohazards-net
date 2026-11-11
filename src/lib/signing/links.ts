/*
 * lib/signing/links.ts
 *
 * Where a client's document link points. A brand with its own document host
 * (document.forensiccleaningqld.com.au) gets links there; every other brand,
 * and that brand too until its host is actually connected, gets a link on the
 * app address.
 *
 * "Connected" is checked, not assumed: a link is something a client will tap,
 * and a host that is in the code but not yet in DNS would give them a dead
 * page. The host's home page is served by proxy.ts with a marker header, so one
 * small request proves the host reaches this app.
 */
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'
import { buildSigningLinks } from '@/lib/signing/core'
import type { SigningLinks } from '@/lib/signing/core'
import { DOCUMENT_HOST_HEADER } from '@/lib/signing/hostShape'

const LIVE_FOR_MS = 10 * 60 * 1000
const RETRY_AFTER_MS = 60 * 1000
const checked = new Map<string, { live: boolean; at: number }>()

async function documentHostIsLive(host: string): Promise<boolean> {
  const known = checked.get(host)
  const now = Date.now()
  if (known && now - known.at < (known.live ? LIVE_FOR_MS : RETRY_AFTER_MS)) return known.live
  let live = false
  try {
    const res = await fetch(`https://${host}/`, {
      method: 'HEAD',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    live = res.headers.get(DOCUMENT_HOST_HEADER) === '1'
  } catch {
    live = false
  }
  checked.set(host, { live, at: now })
  return live
}

export interface DocumentHostStatus {
  /** The brand's document host when it is connected and working, otherwise null. */
  liveHost: string | null
  /** The brand's document host when it is set in the code but not reachable yet. */
  pendingHost: string | null
}

export async function documentHostStatus(tradingName: string | null | undefined): Promise<DocumentHostStatus> {
  const host = isTradingNameId(tradingName) ? tradingNameOption(tradingName)?.documentHost ?? null : null
  if (!host) return { liveHost: null, pendingHost: null }
  return (await documentHostIsLive(host)) ? { liveHost: host, pendingHost: null } : { liveHost: null, pendingHost: host }
}

/** The links for one request, on the brand's document host when it is connected. */
export async function signingLinks(
  tradingName: string | null | undefined,
  token: string,
): Promise<SigningLinks & { pendingHost: string | null }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const status = await documentHostStatus(tradingName)
  return { ...buildSigningLinks(token, appUrl, status.liveHost), pendingHost: status.pendingHost }
}
