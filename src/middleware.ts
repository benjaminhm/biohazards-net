import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// ── Platform hosts (not white-label tenants) ───────────────────────────────
const PLATFORM_HOSTS = [
  'app.biohazards.net',
  'biohazards.net',
  'www.biohazards.net',
  'localhost',
  'localhost:3000',
]

// ── Public routes — no auth required ──────────────────────────────────────
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

export default clerkMiddleware(async (auth, request) => {
  const hostname = request.headers.get('host') || ''
  const host = hostname.split(':')[0]

  // Protect non-public routes
  if (!isPublicRoute(request)) {
    await auth.protect()
  }

  // Inject tenant host header for white-label subdomains
  const isPlatform = PLATFORM_HOSTS.some(h => host === h || host.endsWith('.vercel.app'))
  if (!isPlatform) {
    const response = NextResponse.next({ request })
    response.headers.set('x-tenant-host', host)
    return response
  }

  return NextResponse.next({ request })
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
