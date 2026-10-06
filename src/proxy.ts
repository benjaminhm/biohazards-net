/*
 * proxy.ts
 *
 * Runs before a request is completed. Staff routes need a bh_staff session.
 *
 *   app.biohazards.net       — company app. Sign-in is a self-hosted magic link
 *                              (bh_staff cookie). This is the login domain.
 *
 *   platform.biohazards.net  — legacy host; redirects to app.biohazards.net.
 *
 *   [slug].biohazards.net    — public company website (no auth).
 *                              Sets x-org-slug and rewrites to /site/*.
 *
 * Custom domains (e.g. app.brisbanebiohazardcleaning.com.au):
 *   Sets x-org-host so getOrgId can resolve orgs.custom_domain.
 *
 *   accounts.<brand>.com.au — commercial trade account portal.
 *   Matched before the custom-domain branch and deliberately does NOT set
 *   x-org-host. Only /portal and /api/portal are reachable on this host.
 *   The portal has its own bh_portal cookie.
 *
 * Public routes (no staff session required):
 *   - All [slug].biohazards.net requests (public websites)
 *   - /login, /accept/:id
 *   - /api/auth/*, /api/print, /api/sms/inbound, /api/public/*
 *   - /portal/*, /api/portal/*
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { accountsHostTradingName } from '@/lib/tradingNames'
import { getStaffSessionFromNextRequest } from '@/lib/staffSession'

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login' || pathname.startsWith('/login/')) return true
  if (pathname.startsWith('/accept/')) return true
  if (pathname.startsWith('/api/accept/')) return true
  if (pathname.startsWith('/api/auth/')) return true
  if (pathname.startsWith('/api/company')) return true
  if (pathname.startsWith('/api/print/')) return true
  if (pathname.startsWith('/api/sms/inbound')) return true
  if (pathname.startsWith('/api/webhooks/inbound-email')) return true
  if (pathname.startsWith('/api/public/')) return true
  if (pathname.startsWith('/site')) return true
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return true
  if (pathname.startsWith('/api/portal')) return true
  if (isSharedAsset(pathname)) return true
  return false
}

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'platform', 'admin', 'accounts'])

function isSharedAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/robots.txt'
  )
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const requestHeaders = new Headers(request.headers)
  const { pathname } = request.nextUrl

  const subdomainMatch = host.match(/^([^.]+)\.biohazards\.net$/)
  const slug = subdomainMatch ? subdomainMatch[1] : null
  const hostNoPort = host.split(':')[0].toLowerCase()
  const isLocalDev =
    hostNoPort === 'localhost' || hostNoPort === '127.0.0.1' || hostNoPort === '0.0.0.0'
  const isCustomDomain =
    !isLocalDev && !host.endsWith('.biohazards.net') && host !== 'biohazards.net'

  const isPortalPath =
    pathname === '/portal' || pathname.startsWith('/portal/') || pathname.startsWith('/api/portal')

  const portalOnAppOrigin = isLocalDev || process.env.VERCEL_ENV === 'preview'
  const accountsBrand =
    accountsHostTradingName(host) ??
    (portalOnAppOrigin && isPortalPath
      ? process.env.ACCOUNTS_PORTAL_DEV_TRADING_NAME || 'forensic_cleaning_qld'
      : null)

  if (accountsBrand) {
    requestHeaders.set('x-subdomain', 'accounts')
    requestHeaders.set('x-portal-trading-name', accountsBrand)

    if (!portalOnAppOrigin) {
      if (isSharedAsset(pathname)) {
        return NextResponse.next({ request: { headers: requestHeaders } })
      }
      if (pathname === '/') {
        const url = request.nextUrl.clone()
        url.pathname = '/portal'
        return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
      }
      if (!isPortalPath) {
        return new NextResponse('Not found', { status: 404 })
      }
    }
  } else if (isPortalPath) {
    return new NextResponse('Not found', { status: 404 })
  } else if (isCustomDomain) {
    requestHeaders.set('x-org-host', host)
  } else if (slug === 'platform') {
    const redirectUrl = new URL(request.url)
    redirectUrl.protocol = 'https:'
    redirectUrl.host = 'app.biohazards.net'
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  } else if (slug === 'app' || !slug) {
    requestHeaders.set('x-subdomain', 'app')
  } else if (slug && !RESERVED_SUBDOMAINS.has(slug)) {
    requestHeaders.set('x-org-slug', slug)
    requestHeaders.set('x-subdomain', 'site')

    if (!pathname.startsWith('/site') && !pathname.startsWith('/api')) {
      const url = request.nextUrl.clone()
      url.pathname = `/site${pathname === '/' ? '' : pathname}`
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
  }

  const onAccountsHost = !!accountsBrand && !portalOnAppOrigin
  const onPublicSite = !!slug && !RESERVED_SUBDOMAINS.has(slug) && slug !== 'app' && slug !== 'platform'
  if (!onAccountsHost && !onPublicSite && !isPublicPath(pathname)) {
    const session = await getStaffSessionFromNextRequest(request)
    if (!session) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect_url', request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
