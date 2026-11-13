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
 *   photo.biohazards.net     — PIN photo apps, no staff session. / is the camera
 *                              (/photo), /bulk the bulk loader (/photo/bulk),
 *                              /notes the job notepad (/photo/notes).
 *                              Only /photo and /api/photo are reachable.
 *
 *   notes.biohazards.net     — the job notepad on its own host. / is /photo/notes;
 *                              same PIN session and path limits as photo.
 *
 *   document.<brand>.com.au — documents sent to a client to view or sign.
 *   /<private code> is the document, /<private code>/pdf the signed copy.
 *   Nothing else is reachable on this host.
 *
 *   accounts.<brand>.com.au — commercial trade account portal.
 *   Only /portal and /api/portal are reachable on this host.
 *   The portal has its own bh_portal cookie.
 *
 * There is one company. The host never decides whose data a request sees: that
 * comes from the signed-in person's membership (lib/org.ts). Any other
 * [name].biohazards.net is a 404 (there are no per-company websites), and any
 * other host that reaches this deployment (a Vercel preview address, for
 * example) is the staff app and needs a staff session like app.biohazards.net.
 *
 * Public routes (no staff session required):
 *   - /login, /accept/:id
 *   - /sign/:token, /api/sign/:token (client signing link; the token is the credential)
 *   - /api/auth/*, /api/print, /api/sms/inbound, /api/public/*
 *   - /api/webhooks/inbound-email, /api/webhooks/voip, /api/webhooks/website-enquiry
 *     (shared secret or signature checked in the route)
 *   - /portal/*, /api/portal/*
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { accountsHostTradingName, documentHostTradingName, isNotesCaptureHost, isPhotoCaptureHost, tradingNameLabel } from '@/lib/tradingNames'
import { DOCUMENT_HOST_HEADER, isSigningTokenShape } from '@/lib/signing/hostShape'
import {
  STAFF_COOKIE,
  STAFF_SESSION_MAX_AGE,
  browserOrigin,
  isDevHost,
  isSecureStaffRequest,
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
  // Client signing links. The trailing slash keeps staff /api/signing behind the session.
  if (pathname.startsWith('/sign/')) return true
  if (pathname.startsWith('/api/sign/')) return true
  if (pathname.startsWith('/api/auth/')) return true
  if (pathname.startsWith('/api/company')) return true
  if (pathname.startsWith('/api/print/')) return true
  if (pathname.startsWith('/api/sms/inbound')) return true
  if (pathname.startsWith('/api/webhooks/inbound-email')) return true
  if (pathname === '/api/webhooks/voip') return true
  if (pathname === '/api/webhooks/website-enquiry') return true
  if (pathname.startsWith('/api/public/')) return true
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return true
  if (pathname.startsWith('/api/portal')) return true
  if (pathname === '/photo' || pathname.startsWith('/photo/')) return true
  if (pathname === '/api/photo' || pathname.startsWith('/api/photo/')) return true
  if (isSharedAsset(pathname)) return true
  return false
}

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'login', 'platform', 'admin', 'accounts', 'photo', 'notes'])

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
  const slug = subdomainMatch ? subdomainMatch[1].toLowerCase() : null
  const isLocalDev = isDevHost(host)

  const isPortalPath =
    pathname === '/portal' || pathname.startsWith('/portal/') || pathname.startsWith('/api/portal')
  const isPhotoPath =
    pathname === '/photo' || pathname.startsWith('/photo/') || pathname === '/api/photo' || pathname.startsWith('/api/photo/')

  // Client document links: document.<brand>.com.au/<private code>. The address
  // deliberately says "document", not "sign", and nothing else is reachable here.
  const documentBrand = documentHostTradingName(host)
  if (documentBrand) {
    requestHeaders.set('x-subdomain', 'document')
    const parts = pathname.split('/').filter(Boolean)
    if (parts.length === 0) {
      const brand = tradingNameLabel(documentBrand) ?? 'Documents'
      return new NextResponse(
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${brand}</title></head><body style="margin:0;background:#d6e2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111"><div style="max-width:480px;margin:12vh auto 0;padding:0 16px"><div style="background:#fff;border-radius:14px;padding:28px 24px"><h1 style="font-size:20px;margin:0 0 10px">${brand}</h1><p style="font-size:15px;line-height:1.55;color:#333;margin:0">To open your document, use the link you were sent.</p></div></div></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', [DOCUMENT_HOST_HEADER]: '1' } },
      )
    }
    if (isSigningTokenShape(parts[0]) && (parts.length === 1 || (parts.length === 2 && parts[1] === 'pdf'))) {
      const url = request.nextUrl.clone()
      url.pathname = parts.length === 1 ? `/sign/${parts[0]}` : `/api/sign/${parts[0]}/pdf`
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
    // The page reports back here (view, passcode, sign, decline).
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'sign' && request.method === 'POST') {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }
    return new NextResponse('Not found', { status: 404 })
  }

  const notesHost = isNotesCaptureHost(host)
  if (notesHost || isPhotoCaptureHost(host)) {
    requestHeaders.set('x-subdomain', 'photo')
    if (isSharedAsset(pathname)) {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }
    const shortPaths: Record<string, string> = notesHost
      ? { '/': '/photo/notes' }
      : { '/': '/photo', '/bulk': '/photo/bulk', '/notes': '/photo/notes' }
    if (shortPaths[pathname]) {
      const url = request.nextUrl.clone()
      url.pathname = shortPaths[pathname]
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
  } else if (slug === 'platform') {
    const redirectUrl = new URL(request.url)
    redirectUrl.protocol = 'https:'
    redirectUrl.host = 'app.biohazards.net'
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  } else if (slug && !RESERVED_SUBDOMAINS.has(slug)) {
    // There are no per-company websites: an unknown subdomain is nothing.
    return new NextResponse('Not found', { status: 404 })
  } else if (slug === 'app' || slug === 'login' || !slug) {
    requestHeaders.set('x-subdomain', 'app')
  }

  const onAccountsHost = !!accountsBrand && !portalOnAppOrigin
  let renewSession: { token: string; secure: boolean } | null = null
  if (!onAccountsHost && !isPublicPath(pathname)) {
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
