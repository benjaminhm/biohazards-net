/*
 * proxy.ts
 *
 * Runs before a request is completed. Staff routes need a bh_staff session.
 *
 *   login.biohazards.net     — the one staff sign-in. The email decides admin or technician.
 *   app.biohazards.net       — same company app. Sign-in is a self-hosted magic link
 *                              (bh_staff cookie).
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
import { accountsHostTradingName, isPhotoCaptureHost } from '@/lib/tradingNames'
import {
  STAFF_COOKIE,
  STAFF_SESSION_MAX_AGE,
  browserOrigin,
  isDevHost,
  isSecureStaffRequest,
  isStaffAppHost,
  signStaffToken,
  staffSessionIsStale,
  verifyStaffToken,
} from '@/lib/staffSession'
import { resolveActiveMembership } from '@/lib/membership'
import { decideStaffAccess } from '@/lib/staffDesk'

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
  if (pathname === '/photo' || pathname.startsWith('/photo/')) return true
  if (pathname === '/api/photo' || pathname.startsWith('/api/photo/')) return true
  if (isSharedAsset(pathname)) return true
  return false
}

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'login', 'platform', 'admin', 'accounts', 'photo'])

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
  const isLocalDev = isDevHost(host)
  const isCustomDomain =
    !isLocalDev &&
    !isStaffAppHost(host) &&
    !host.endsWith('.biohazards.net') &&
    host !== 'biohazards.net'

  const isPortalPath =
    pathname === '/portal' || pathname.startsWith('/portal/') || pathname.startsWith('/api/portal')
  const isPhotoPath =
    pathname === '/photo' || pathname.startsWith('/photo/') || pathname === '/api/photo' || pathname.startsWith('/api/photo/')

  if (isPhotoCaptureHost(host)) {
    requestHeaders.set('x-subdomain', 'photo')
    if (isSharedAsset(pathname)) {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }
    if (pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/photo'
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
    if (!isPhotoPath) {
      return new NextResponse('Not found', { status: 404 })
    }
    return NextResponse.next({ request: { headers: requestHeaders } })
  }
  if (isPhotoPath) {
    requestHeaders.set('x-subdomain', 'photo')
  }

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
  } else if (slug === 'app' || slug === 'login' || !slug) {
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
  let renewSession: { token: string; secure: boolean } | null = null
  if (!onAccountsHost && !onPublicSite && !isPublicPath(pathname)) {
    const raw = request.cookies.get(STAFF_COOKIE)?.value
    const session = raw ? await verifyStaffToken(raw) : null
    if (!session) {
      return NextResponse.redirect(loginRedirect(request))
    }
    let role: string | null = null
    try {
      const resolved = await resolveActiveMembership(session.userId)
      role = resolved.membership?.role ?? null
    } catch {
      role = null
    }
    const decision = decideStaffAccess(role, pathname)
    if (decision === 'signed-out') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const res = NextResponse.redirect(loginRedirect(request))
      res.cookies.set(STAFF_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isSecureStaffRequest(request),
        maxAge: 0,
        expires: new Date(0),
      })
      return res
    }
    if (decision === 'forbid') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (decision === 'redirect') {
      return NextResponse.redirect(new URL('/tech', browserOrigin(request.url, host, request.headers.get('x-forwarded-proto'))))
    }
    if (staffSessionIsStale(session.issuedAt)) {
      try {
        renewSession = {
          token: await signStaffToken({ userId: session.userId, email: session.email }),
          secure: isSecureStaffRequest(request),
        }
      } catch {
        renewSession = null
      }
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  // cookies.set is what the proxy actually forwards. A raw Set-Cookie header is dropped.
  if (renewSession) {
    const now = Date.now()
    res.cookies.set(STAFF_COOKIE, renewSession.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: renewSession.secure,
      maxAge: STAFF_SESSION_MAX_AGE,
      expires: new Date(now + STAFF_SESSION_MAX_AGE * 1000),
    })
  }
  return res
}

function loginRedirect(request: NextRequest): URL {
  const origin = browserOrigin(request.url, request.headers.get('host'), request.headers.get('x-forwarded-proto'))
  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('redirect_url', `${origin}${request.nextUrl.pathname}${request.nextUrl.search}`)
  return loginUrl
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
