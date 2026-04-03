/*
 * components/ServiceWorkerRegistration.tsx
 *
 * Renders nothing — exists only as a client component that registers /sw.js
 * on mount. Mounted in the root layout to enable PWA offline caching across
 * the entire app.
 *
 * Registration is guarded by 'serviceWorker' in navigator so it silently skips
 * on browsers that don't support it (desktop Safari before 15.4, older Android).
 */
'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('SW registered:', reg.scope))
        .catch((err) => console.warn('SW registration failed:', err))
    }
  }, [])

  return null
}
