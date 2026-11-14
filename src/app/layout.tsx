/*
 * app/layout.tsx
 *
 * Root layout — wraps every page in the app.
 * Provider hierarchy (outermost to innermost):
 *   UserProvider    — custom user context (role, capabilities, org membership)
 *   ServiceWorkerRegistration — registers /sw.js for PWA offline support
 *   Notepad         — floating private notepad for desk staff, on every page
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
import Notepad from '@/components/Notepad'
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()

  if (headersList.get('x-subdomain') === 'photo') {
    return {
      title: 'Field Photo Capture — Forensic Cleaning QLD',
      description: 'Timestamped, geolocated field photo capture',
      robots: { index: false, follow: false },
      appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'FCQ Photo',
      },
      icons: {
        icon: '/icon-192.png',
        apple: '/apple-touch-icon.png',
      },
    }
  }

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
    title: 'Biohazard Cleaning QLD',
    description: 'Job management for Biohazard Cleaning QLD',
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

  if (headersList.get('x-subdomain') === 'photo') {
    return (
      <html lang="en">
        <body>
          <ServiceWorkerRegistration />
          {children}
        </body>
      </html>
    )
  }

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
          <ServiceWorkerRegistration />
          {children}
          <Notepad />
        </UserProvider>
      </body>
    </html>
  )
}
