import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import { DevModeProvider } from '@/lib/devMode'
import DevToggle from '@/components/DevToggle'
import DevOverlay from '@/components/DevOverlay'

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
          <DevModeProvider>
            <ServiceWorkerRegistration />
            {children}
            <DevToggle />
            <DevOverlay />
          </DevModeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
