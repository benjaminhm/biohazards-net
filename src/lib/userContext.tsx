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
  /** Tenant org; `show_quick_feedback`, `training_education`, `consultation` (Consultation tile). */
  org: { name: string; slug: string; features?: Record<string, boolean> } | null
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

  return <UserContext.Provider value={ctx}>{children}</UserContext.Provider>
}

export function useUser() { return useContext(UserContext) }
