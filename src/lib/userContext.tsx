'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export type UserRole = 'owner' | 'admin' | 'operator' | 'field'

interface UserCtx {
  userId: string
  name: string
  role: UserRole
  org_id: string | null
  has_org: boolean
  org: { name: string; slug: string } | null
  loading: boolean
}

const defaultCtx: UserCtx = { userId: '', name: '', role: 'owner', org_id: null, has_org: false, org: null, loading: true }

const UserContext = createContext<UserCtx>(defaultCtx)

// Paths where no redirect should happen even if user has no org
const PENDING_EXEMPT = ['/pending', '/invite/', '/login', '/sign-in', '/new-client', '/accept/']

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<UserCtx>(defaultCtx)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setCtx({ ...d, loading: false }))
      .catch(() => setCtx(c => ({ ...c, loading: false })))
  }, [])

  // Redirect to /pending if user is authenticated but has no org assignment
  useEffect(() => {
    if (ctx.loading) return
    if (!ctx.userId) return
    if (ctx.has_org) return
    const exempt = PENDING_EXEMPT.some(p => pathname.startsWith(p))
    if (!exempt) router.replace('/pending')
  }, [ctx.loading, ctx.userId, ctx.has_org, pathname, router])

  return <UserContext.Provider value={ctx}>{children}</UserContext.Provider>
}

export function useUser() { return useContext(UserContext) }

// Permission helpers
export function canSeeAssessment(role: UserRole) { return role === 'owner' || role === 'admin' || role === 'operator' }
export function canSeeClientDetails(role: UserRole) { return role === 'owner' || role === 'admin' || role === 'operator' }
export function canCreateDocuments(role: UserRole) { return role === 'owner' || role === 'admin' || role === 'operator' }
export function canSeeSettings(role: UserRole) { return role === 'owner' || role === 'admin' }
export function isFieldWorker(role: UserRole) { return role === 'field' }
