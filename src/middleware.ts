import { NextRequest, NextResponse } from 'next/server'

// Hosts that are the platform itself — not tenants
const PLATFORM_HOSTS = [
  'app.biohazards.net',
  'biohazards.net',
  'www.biohazards.net',
  'localhost:3000',
  'localhost',
]

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const host = hostname.split(':')[0] // strip port

  // Pass platform hosts straight through
  if (PLATFORM_HOSTS.some(h => host === h || host.endsWith('.vercel.app'))) {
    return NextResponse.next()
  }

  // Custom domain or subdomain — inject tenant hint as header
  // API routes and the app read x-tenant-host to load the right company profile
  const response = NextResponse.next()
  response.headers.set('x-tenant-host', host)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
