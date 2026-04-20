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

const PRIMARY_SIGN_IN_URL = 'https://app.biohazards.net/login'

export const metadata: Metadata = {
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

export const viewport: Viewport = {
  themeColor: '#FF6B35',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const orgHost = headersList.get('x-org-host')
  const platformSatelliteHost = headersList.get('x-clerk-satellite-host')
  const satelliteDomain = orgHost ?? platformSatelliteHost
  const isSatellite = !!satelliteDomain

  // #region agent log — verify Clerk provider config per request in prod via Vercel runtime logs
  // Remove once we have confirmed isSatellite=false on app.biohazards.net in prod.
  console.log('[clerk-provider-config]', {
    host: headersList.get('host'),
    subdomain: headersList.get('x-subdomain'),
    orgHost,
    platformSatelliteHost,
    isSatellite,
    satelliteDomain: isSatellite ? satelliteDomain : null,
    signInUrl: isSatellite ? PRIMARY_SIGN_IN_URL : '(primary — no override)',
  })
  // #endregion

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
