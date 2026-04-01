'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type UserRole = 'owner' | 'admin' | 'operator' | 'field'

interface UserCtx {
  userId: string
  name: string
  role: UserRole
  org_id: string | null
  org: { name: string; slug: string } | null
  loading: boolean
}

const defaultCtx: UserCtx = { userId: '', name: '', role: 'owner', org_id: null, org: null, loading: true }

const UserContext = createContext<UserCtx>(defaultCtx)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<UserCtx>(defaultCtx)

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setCtx({ ...d, loading: false }))
      .catch(() => setCtx(c => ({ ...c, loading: false })))
  }, [])

  return <UserContext.Provider value={ctx}>{children}</UserContext.Provider>
}

export function useUser() { return useContext(UserContext) }

// Permission helpers
export function canSeeAssessment(role: UserRole) { return role === 'owner' || role === 'admin' || role === 'operator' }
export function canSeeClientDetails(role: UserRole) { return role === 'owner' || role === 'admin' || role === 'operator' }
export function canCreateDocuments(role: UserRole) { return role === 'owner' || role === 'admin' || role === 'operator' }
export function canSeeSettings(role: UserRole) { return role === 'owner' || role === 'admin' }
export function isFieldWorker(role: UserRole) { return role === 'field' }
