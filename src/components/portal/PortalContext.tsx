/*
 * components/portal/PortalContext.tsx
 *
 * Session context for the accounts portal, fetched once from /api/portal/me.
 *
 * Deliberately not the staff UserProvider (lib/userContext.tsx): that one calls
 * /api/me and assumes a Clerk user. A trade contact has neither.
 */
'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { PortalMe } from '@/lib/types'

interface PortalContextValue {
  me: PortalMe | null
  loading: boolean
  /** Re-read the session after the profile or terms change. */
  refresh: () => Promise<void>
}

const PortalCtx = createContext<PortalContextValue>({
  me: null,
  loading: true,
  refresh: async () => {},
})

export function usePortal() {
  return useContext(PortalCtx)
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<PortalMe | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/me', { cache: 'no-store' })
      setMe(res.ok ? await res.json() : null)
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PortalCtx.Provider value={{ me, loading, refresh: load }}>{children}</PortalCtx.Provider>
  )
}
