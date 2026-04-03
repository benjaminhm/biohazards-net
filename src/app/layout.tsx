/*
 * app/layout.tsx
 *
 * Root layout — wraps every page in the app.
 * Provider hierarchy (outermost to innermost):
 *   ClerkProvider   — Clerk auth session, required for useAuth()/auth()
 *   UserProvider    — custom user context (role, capabilities, org membership)
 *   PreviewBanner   — shows when an admin is simulating member capabilities
 *   ServiceWorkerRegistration — registers /sw.js for PWA offline support
 *
 * PWA metadata enables "Add to Home Screen" on iOS/Android with correct
 * theme colour and full-screen display.
 */
import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import { UserProvider } from '@/lib/userContext'
import PreviewBanner from '@/components/PreviewBanner'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <UserProvider>
            <PreviewBanner />
            <ServiceWorkerRegistration />
            {children}
          </UserProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
