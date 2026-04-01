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
  '/api/accept/(.*)',
  '/api/notify-lead(.*)',
  '/api/company(.*)',
  '/api/print/(.*)',
  '/api/invites/(.*)',
])

const EXCLUDED_SUBDOMAINS = new Set(['www', 'admin'])

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const host = request.headers.get('host') ?? ''
  const requestHeaders = new Headers(request.headers)

  // Detect subdomain on biohazards.net or custom domain
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
