import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/login(.*)',
  '/sign-in(.*)',
  '/new-client(.*)',
  '/accept/(.*)',
  '/api/intake(.*)',
  '/api/accept/(.*)',
  '/api/notify-lead(.*)',
  '/api/company(.*)',
  '/api/print/(.*)',
])

const EXCLUDED_SUBDOMAINS = new Set(['www', 'admin'])

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const host = request.headers.get('host') ?? ''
  const requestHeaders = new Headers(request.headers)

  // Detect subdomain on biohazards.net
  const subdomainMatch = host.match(/^([^.]+)\.biohazards\.net$/)
  const slug = subdomainMatch ? subdomainMatch[1] : null

  if (slug === 'app') {
    requestHeaders.set('x-org-slug', 'app')
  } else if (slug && !EXCLUDED_SUBDOMAINS.has(slug)) {
    requestHeaders.set('x-org-slug', slug)
  } else if (slug === 'admin') {
    requestHeaders.set('x-org-slug', 'admin')

    // Require platform admin role
    const { userId } = await auth()
    const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (!userId || !adminIds.includes(userId)) {
      return new NextResponse('Forbidden', { status: 403 })
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
