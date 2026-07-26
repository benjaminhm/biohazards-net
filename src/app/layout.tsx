/*
 * app/layout.tsx
 *
 * Root layout — wraps every page in the app.
 * Provider hierarchy (outermost to innermost):
 *   ClerkProvider   — Clerk auth session, required for useAuth()/auth()
 *   UserProvider    — custom user context (role, capabilities, org membership)
 *   ImpersonationBanner — platform admin viewing a tenant org (training/debug)
 *   PreviewBanner   — shows when an admin is simulating member capabilities
 *   ServiceWorkerRegistration — registers /sw.js for PWA offline support
 *
 * Satellite domain detection:
 *   - x-org-host: custom tenant domains (non-biohazards.net).
 *   - x-clerk-satellite-host: platform.biohazards.net (session lives on app.*).
 *   ClerkProvider uses isSatellite + signInUrl=app login so cookies sync correctly.
 *   This runs server-side (via headers()) so Clerk is configured before any
 *   client JS runs — fixing the "Production Keys are only allowed for domain" error.
 *
 * Commercial accounts portal (x-subdomain: accounts):
 *   Rendered without ClerkProvider at all. Trade contacts authenticate with the
 *   portal's own magic-link cookie, and mounting Clerk on a host that is neither
 *   the primary domain nor a configured satellite throws "Production Keys are
 *   only allowed for domain". Skipping UserProvider also keeps /api/me and the
 *   staff banners out of a client-facing surface.
 *
 * PWA metadata enables "Add to Home Screen" on iOS/Android with correct
 * theme colour and full-screen display.
 */
import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { headers } from 'next/headers'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import { UserProvider } from '@/lib/userContext'
import PreviewBanner from '@/components/PreviewBanner'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'

const PRIMARY_SIGN_IN_URL = 'https://app.biohazards.net/login'

/*
 * Per-host metadata. The accounts portal is client-facing and may be a different
 * trading brand, so it must not inherit the staff app's title, PWA manifest or
 * icons — a Forensic Cleaning QLD client should never see "Brisbane Biohazard
 * Cleaning" in their tab. It is also noindex: the portal is private.
 */
export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()

  if (headersList.get('x-subdomain') === 'accounts') {
    const id = headersList.get('x-portal-trading-name')
    const brand = (isTradingNameId(id) ? tradingNameOption(id)?.label : null) ?? 'Accounts'
    return {
      title: `${brand} — Trade Accounts`,
      description: `Trade account portal for ${brand}`,
      robots: { index: false, follow: false },
    }
  }

  return {
    title: 'Brisbane Biohazard Cleaning',
    description: 'Job management for Brisbane Biohazard Cleaning',
    manifest: '/manifest.json',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: 'BioHazard',
    },
    icons: {
      icon: '/icon-192.png',
      apple: '/apple-touch-icon.png',
    },
  }
}

export const viewport: Viewport = {
  themeColor: '#FF6B35',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()

  if (headersList.get('x-subdomain') === 'accounts') {
    // globals.css is a dark staff theme; the portal is light and client-facing,
    // so override the body tokens rather than leaking black behind the page.
    return (
      <html lang="en">
        <body style={{ background: '#F5F5F5', color: '#111111' }}>{children}</body>
      </html>
    )
  }

  const orgHost = headersList.get('x-org-host')
  const platformSatelliteHost = headersList.get('x-clerk-satellite-host')
  const satelliteDomain = orgHost ?? platformSatelliteHost
  const isSatellite = !!satelliteDomain

  return (
    <ClerkProvider
      isSatellite={isSatellite}
      domain={isSatellite ? (satelliteDomain ?? undefined) : undefined}
      signInUrl={isSatellite ? PRIMARY_SIGN_IN_URL : undefined}
    >
      <html lang="en">
        <body>
          <UserProvider>
            <ImpersonationBanner />
            <PreviewBanner />
            <ServiceWorkerRegistration />
            {children}
          </UserProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
