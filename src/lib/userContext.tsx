/*
 * lib/userContext.tsx
 *
 * Global client-side user context. Fetches the current user's role,
 * capabilities, and org membership from /api/me on mount, then makes
 * that data available to every component via useUser().
 *
 * The desk is admins and managers only (member sessions are logged out by the
 * proxy). Admins get every capability; managers get the manager defaults plus
 * anything stored on their membership.
 */
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { TeamCapabilities } from './types'
import { ALL_CAPABILITIES, DEFAULT_MANAGER_CAPABILITIES, DEFAULT_MEMBER_CAPABILITIES } from './types'
import { ORG_FEATURES_UPDATED_EVENT } from './menuConfig'

export type UserRole = 'admin' | 'manager' | 'member'

interface UserCtx {
  userId: string
  name: string
  role: UserRole
  isAdmin: boolean
  isManager: boolean
  caps: TeamCapabilities
  org_id: string | null
  has_org: boolean
  /** Tenant org; `show_quick_feedback`, `training_education`, `consultation`, `menu_*`, `ux_tag:*`. */
  org: { name: string; slug: string; features?: Record<string, unknown> } | null
  loading: boolean
}

const defaultCtx: UserCtx = {
  userId: '', name: '', role: 'member', isAdmin: false, isManager: false,
  caps: DEFAULT_MEMBER_CAPABILITIES,
  org_id: null, has_org: false, org: null, loading: true,
}

const UserContext = createContext<UserCtx>(defaultCtx)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<UserCtx>(defaultCtx)

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => {
        const role: UserRole = d.role === 'admin' ? 'admin' : d.role === 'manager' ? 'manager' : 'member'
        const isAdmin   = role === 'admin'
        const isManager = role === 'manager'
        const caps: TeamCapabilities = isAdmin
          ? ALL_CAPABILITIES
          : isManager
            ? { ...DEFAULT_MANAGER_CAPABILITIES, ...(d.capabilities ?? {}) }
            : DEFAULT_MEMBER_CAPABILITIES
        setCtx({ ...d, role, isAdmin, isManager, caps, loading: false })
      })
      .catch(() => setCtx(c => ({ ...c, loading: false })))
  }, [])

  useEffect(() => {
    const applyFeatures = (features: Record<string, unknown>) => {
      setCtx(c => (c.org ? { ...c, org: { ...c.org, features } } : c))
    }
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail
      if (detail && typeof detail === 'object') applyFeatures(detail)
    }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'bh-org-features:sync' && e.data.features && typeof e.data.features === 'object') {
        applyFeatures(e.data.features as Record<string, unknown>)
      }
    }
    window.addEventListener(ORG_FEATURES_UPDATED_EVENT, onCustom)
    window.addEventListener('message', onMsg)
    return () => {
      window.removeEventListener(ORG_FEATURES_UPDATED_EVENT, onCustom)
      window.removeEventListener('message', onMsg)
    }
  }, [])

  return <UserContext.Provider value={ctx}>{children}</UserContext.Provider>
}

export function useUser() { return useContext(UserContext) }
