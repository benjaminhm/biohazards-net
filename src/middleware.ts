/*
 * middleware.ts
 *
 * Next.js edge middleware — runs on every request before any route handler.
 *
 * Three-tier subdomain architecture:
 *
 *   platform.biohazards.net  — platform admin dashboard (you only)
 *                              Gated by PLATFORM_ADMIN_CLERK_IDS env var.
 *                              Routes to /platform/* pages.
 *
 *   app.biohazards.net       — company + team app (all org users)
 *                              Full auth enforced. This is the primary
 *                              login domain for all companies on the platform.
 *
 *   [slug].biohazards.net    — public company website (no auth)
 *                              Sets x-org-slug header so pages/API can
 *                              fetch the right company's public profile.
 *                              Routes to /site/* pages (public website template).
 *                              Google indexed, client-facing, lead capture.
 *
 * Custom domains (e.g. app.brisbanebiohazardcleaning.com.au):
 *   Sets x-org-host header — used by layout.tsx to configure Clerk
 *   as a satellite domain so auth session is shared from app.biohazards.net.
 *
 * Public routes (no auth required):
 *   - All [slug].biohazards.net requests (public websites)
 *   - /login, /invite/:token, /new-client, /accept/:id
 *   - /api/intake, /api/print, /api/sms/inbound, /api/public/*
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getImpersonationReadOnlyFromRequest } from '@/lib/impersonation'

const isPublicRoute = createRouteMatcher([
  '/login(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/new-client(.*)',
  '/accept/(.*)',
  '/pending(.*)',
  '/invite/(.*)',
  '/api/intake(.*)',
  '/api/intake/upload-url(.*)',
  '/api/accept/(.*)',
  '/api/notify-lead(.*)',
  '/api/company(.*)',
  '/api/print/(.*)',
  '/api/invites/(.*)',
  '/api/sms/inbound(.*)',
  '/api/public/(.*)',  // public company profile data for website template
  '/site(.*)',         // public website pages
])

// Reserved subdomains that are not company slugs
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'platform', 'admin'])

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const host = request.headers.get('host') ?? ''
  const requestHeaders = new Headers(request.headers)
  const { pathname } = request.nextUrl

  // Clerk platform invitation emails use /login?__clerk_ticket=…&__clerk_status=sign_up.
  // <SignIn> looks up existing accounts first → "Couldn't find your account." for new invitees.
  // Team invites already use /sign-up; redirect so admins get the same sign-up flow.
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    const sp = request.nextUrl.searchParams
    if (sp.has('__clerk_ticket') || sp.get('__clerk_status') === 'sign_up') {
      const url = request.nextUrl.clone()
      url.pathname = pathname.startsWith('/login/')
        ? `/sign-up${pathname.slice('/login'.length)}`
        : '/sign-up'
      return NextResponse.redirect(url)
    }
  }

  // Match first label of biohazards.net (e.g. 'brisbanebiohazardcleaning' from bbc.biohazards.net)
  const subdomainMatch = host.match(/^([^.]+)\.biohazards\.net$/)
  const slug = subdomainMatch ? subdomainMatch[1] : null
  // Local dev hosts must NOT set x-org-host — otherwise getOrgId looks up orgs.custom_domain = "localhost:3000" and 401s.
  const hostNoPort = host.split(':')[0].toLowerCase()
  const isLocalDev =
    hostNoPort === 'localhost' || hostNoPort === '127.0.0.1' || hostNoPort === '0.0.0.0'
  const isCustomDomain =
    !isLocalDev && !host.endsWith('.biohazards.net') && host !== 'biohazards.net'

  // ── Custom domain (e.g. app.brisbanebiohazardcleaning.com.au) ──
  if (isCustomDomain) {
    requestHeaders.set('x-org-host', host)
  }

  // ── platform.biohazards.net — platform admin only ──
  else if (slug === 'platform') {
    requestHeaders.set('x-subdomain', 'platform')
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.redirect(
        `https://app.biohazards.net/login?redirect_url=https://platform.biohazards.net`
      )
    }

    const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean)

    if (!adminIds.includes(userId)) {
      return new NextResponse('Forbidden — not a platform admin', { status: 403 })
    }

    if (pathname === '/') {
      return NextResponse.redirect(new URL('/platform', request.url))
    }
  }

  // ── app.biohazards.net — company + team app ──
  else if (slug === 'app' || !slug) {
    requestHeaders.set('x-subdomain', 'app')
    // Auth enforced below via isPublicRoute check
  }

  // ── [slug].biohazards.net — public company website ──
  else if (slug && !RESERVED_SUBDOMAINS.has(slug)) {
    requestHeaders.set('x-org-slug', slug)
    requestHeaders.set('x-subdomain', 'site')

    // Rewrite to /site/* so the public website template is served
    // while keeping the URL clean in the browser
    if (!pathname.startsWith('/site') && !pathname.startsWith('/api')) {
      const url = request.nextUrl.clone()
      url.pathname = `/site${pathname === '/' ? '' : pathname}`
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
  }

  // ── Auth enforcement for app subdomain ──
  if (!isPublicRoute(request)) {
    const { userId } = await auth()
    if (!userId) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect_url', request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  // ── Read-only impersonation: block mutating /api/* (session endpoints exempt) ──
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/admin/impersonate')) {
    const m = request.method
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      const { userId } = await auth()
      if (userId) {
        const ro = await getImpersonationReadOnlyFromRequest(request, userId)
        if (ro) {
          return NextResponse.json(
            {
              error:
                'Read-only impersonation is active. Mutating API calls are disabled. End the session from the banner or Platform admin.',
            },
            { status: 403 }
          )
        }
      }
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
