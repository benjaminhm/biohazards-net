/*
 * components/ClerkProviderWrapper.tsx
 *
 * Dynamic ClerkProvider wrapper that detects whether the app is running
 * on a satellite domain (e.g. app.brisbanebiohazardcleaning.com.au) or
 * the primary domain (biohazards.net / app.biohazards.net).
 *
 * Clerk satellite domains share the auth session from the primary domain.
 * When running as a satellite, ClerkProvider must be told:
 *   - isSatellite: true
 *   - domain: the current hostname (so Clerk knows where it is)
 *   - signInUrl: the primary domain's sign-in URL (where auth actually happens)
 *
 * Primary domain runs ClerkProvider with no special props.
 *
 * This runs client-side so window.location.hostname is available.
 * The layout.tsx imports this instead of ClerkProvider directly.
 */
'use client'

import { ClerkProvider } from '@clerk/nextjs'

const PRIMARY_DOMAIN = 'app.biohazards.net'
const SIGN_IN_URL = `https://${PRIMARY_DOMAIN}/login`

export default function ClerkProviderWrapper({ children }: { children: React.ReactNode }) {
  // Detect if we're on a satellite domain at runtime
  const hostname = typeof window !== 'undefined' ? window.location.hostname : PRIMARY_DOMAIN
  const isSatellite = hostname !== PRIMARY_DOMAIN && !hostname.endsWith('biohazards.net') && hostname !== 'localhost'

  if (isSatellite) {
    return (
      <ClerkProvider
        isSatellite
        domain={hostname}
        signInUrl={SIGN_IN_URL}
      >
        {children}
      </ClerkProvider>
    )
  }

  return (
    <ClerkProvider>
      {children}
    </ClerkProvider>
  )
}
