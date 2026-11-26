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
 *
 * Client photo feed (x-subdomain: tracking): same, with its own bh_tracking cookie.
 */
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import ThemeSync from '@/components/ThemeSync'
import { UserProvider } from '@/lib/userContext'
import Notepad from '@/components/Notepad'
import UxTagger from '@/components/UxTagger'
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'

/** Pre-paint theme bootstrap so Light/Dark never flickers on reload or inside the JobPanel iframe. */
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('bh_theme');var isTab=!!window.__bhDataEntry||navigator.userAgent.indexOf('BiohazardsDataEntry')!==-1;if(!isTab){try{if(window.top&&window.top!==window&&window.top.__bhDataEntry)isTab=true;}catch(e){}}if(isTab)document.documentElement.classList.add('tablet-app');var mode=(t==='light'||t==='dark')?t:(isTab?'light':'dark');document.documentElement.setAttribute('data-theme',mode);document.documentElement.style.colorScheme=mode;}catch(e){}})();`

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

  if (headersList.get('x-subdomain') === 'tracking') {
    const id = headersList.get('x-tracking-trading-name')
    const brand = (isTradingNameId(id) ? tradingNameOption(id)?.label : null) ?? 'Job updates'
    return {
      title: `${brand} — Job photos`,
      description: `Photos of your job from ${brand}`,
      robots: { index: false, follow: false },
    }
  }

  if (headersList.get('x-subdomain') === 'cobid') {
    return {
      title: 'Hazmat Management — Co-Bid Workspace',
      description: 'Multi-OpCo commercial ring-fenced co-bidding workspace',
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
  themeColor: '#020617',
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

  if (headersList.get('x-subdomain') === 'tracking') {
    return (
      <html lang="en">
        <body style={{ background: '#FAFAFA', color: '#111111' }}>{children}</body>
      </html>
    )
  }

  if (headersList.get('x-subdomain') === 'cobid') {
    return (
      <html lang="en">
        <body style={{ background: '#F8FAFC', color: '#0F172A' }}>{children}</body>
      </html>
    )
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <UserProvider>
          <ServiceWorkerRegistration />
          {children}
          <Notepad />
          <UxTagger />
        </UserProvider>
      </body>
    </html>
  )
}
