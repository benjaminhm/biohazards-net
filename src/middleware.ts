/*
 * middleware.ts
 *
 * Next.js edge middleware — runs on every request before any route handler.
 * Responsibilities:
 *
 * 1. Subdomain / custom domain detection: reads the Host header and sets
 *    x-org-slug or x-org-host request headers so API routes and pages can
 *    identify the current tenant without another DB lookup.
 *
 * 2. admin.biohazards.net gate: requires the requesting Clerk user to be in
 *    the PLATFORM_ADMIN_CLERK_IDS env var — platform staff only, not org admins.
 *
 * 3. Authentication enforcement: redirects unauthenticated users to /login
 *    for all non-public routes (Clerk handles session verification).
 *
 * Public routes (no auth required) include:
 *   - /new-client     (client intake form)
 *   - /accept/:id     (online quote acceptance)
 *   - /invite/:token  (team invite claim)
 *   - /api/intake     (intake form API)
 *   - /api/print      (document print/PDF)
 *   - /api/sms/inbound (Twilio webhook — must be public)
 *
 * The matcher excludes static assets to avoid running middleware on
 * _next/static, images, and favicon.
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/login(.*)',
  '/sign-in(.*)',
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
])

const EXCLUDED_SUBDOMAINS = new Set(['www', 'admin'])

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const host = request.headers.get('host') ?? ''
  const requestHeaders = new Headers(request.headers)

  // Capture the leftmost label of biohazards.net hosts (e.g. 'brisbane' from brisbane.biohazards.net)
  const subdomainMatch = host.match(/^([^.]+)\.biohazards\.net$/)
  const slug = subdomainMatch ? subdomainMatch[1] : null
  const isCustomDomain = !host.endsWith('.biohazards.net') && host !== 'biohazards.net'

  if (isCustomDomain) {
    // Custom domain e.g. app.brisbanebiohazardcleaning.com.au
    requestHeaders.set('x-org-host', host)
  } else if (slug === 'app') {
    requestHeaders.set('x-org-slug', 'app')
  } else if (slug && !EXCLUDED_SUBDOMAINS.has(slug)) {
    requestHeaders.set('x-org-slug', slug)
  } else if (slug === 'admin') {
    requestHeaders.set('x-org-slug', 'admin')

    // Require authenticated platform admin
    const { userId } = await auth()

    if (!userId) {
      // Redirect to login on main app domain
      return NextResponse.redirect('https://app.biohazards.net/login?redirect_url=https://admin.biohazards.net')
    }

    // PLATFORM_ADMIN_CLERK_IDS is a comma-separated list of Clerk user IDs
    // for internal platform staff — separate from org-level admin role
    const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (!adminIds.includes(userId)) {
      return new NextResponse('Forbidden — not a platform admin', { status: 403 })
    }

    // Redirect admin subdomain root to /admin
    const { pathname } = request.nextUrl
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
  }

  if (!isPublicRoute(request)) {
    const { userId } = await auth()
    if (!userId) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect_url', request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
