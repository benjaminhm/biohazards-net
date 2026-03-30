import { NextRequest, NextResponse } from 'next/server'

// ── Tenant resolution ──────────────────────────────────────────────────────
// Hosts that are the platform itself — not white-label tenants
const PLATFORM_HOSTS = [
  'app.biohazards.net',
  'biohazards.net',
  'www.biohazards.net',
  'localhost:3000',
  'localhost',
]

// ── Auth ───────────────────────────────────────────────────────────────────
// Paths that are always public — no password required
const PUBLIC_PREFIXES = [
  '/login',
  '/new-client',
  '/accept/',           // /accept/[jobId] quote acceptance
  '/api/auth',          // login / logout API
  '/api/accept/',       // quote acceptance API
  '/api/notify-lead',   // public intake webhook
  '/_next',
  '/favicon',
  '/manifest',
  '/icons',
  '/apple-touch-icon',
]

const SESSION_COOKIE = 'bh_session'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hostname = request.headers.get('host') || ''
  const host = hostname.split(':')[0]

  // ── 1. Skip auth for public paths ─────────────────────────────────────
  const isPublic = PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
  if (!isPublic) {
    const session = request.cookies.get(SESSION_COOKIE)
    const appPassword = process.env.APP_PASSWORD

    // If APP_PASSWORD is not set, allow through (dev mode)
    if (appPassword && session?.value !== appPassword) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // ── 2. Tenant header injection for white-label subdomains ──────────────
  const isPlatform = PLATFORM_HOSTS.some(h => host === h || host.endsWith('.vercel.app'))
  if (!isPlatform) {
    const response = NextResponse.next()
    response.headers.set('x-tenant-host', host)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
