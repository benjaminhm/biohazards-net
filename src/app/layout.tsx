/*
 * app/layout.tsx
 *
 * Root layout — wraps every page in the app.
 * Provider hierarchy (outermost to innermost):
 *   UserProvider    — custom user context (role, capabilities, org membership)
 *   PreviewBanner   — shows when an admin is simulating member capabilities
 *   ServiceWorkerRegistration — registers /sw.js for PWA offline support
 *
 * Staff sign-in is a host-only magic-link cookie (bh_staff), read by /api/me.
 *
 * Commercial accounts portal (x-subdomain: accounts):
 *   Rendered without UserProvider. Trade contacts authenticate with the
 *   portal's own magic-link cookie, and the staff banners stay off a
 *   client-facing surface.
 */
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import { UserProvider } from '@/lib/userContext'
import PreviewBanner from '@/components/PreviewBanner'
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'

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
    return (
      <html lang="en">
        <body style={{ background: '#F5F5F5', color: '#111111' }}>{children}</body>
      </html>
    )
  }

  return (
    <html lang="en">
      <body>
        <UserProvider>
          <PreviewBanner />
          <ServiceWorkerRegistration />
          {children}
        </UserProvider>
      </body>
    </html>
  )
}
