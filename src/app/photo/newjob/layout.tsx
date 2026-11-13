/*
 * app/photo/newjob/layout.tsx
 *
 * Page title and home-screen name for the phone new-job form. The root layout
 * names every photo-host page "Field Photo Capture".
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'New job',
  description: 'Create a job and add client details from your phone',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'New job',
  },
}

export default function NewJobLayout({ children }: { children: React.ReactNode }) {
  return children
}
