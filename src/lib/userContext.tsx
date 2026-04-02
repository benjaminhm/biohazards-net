'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { TeamCapabilities } from './types'
import { ALL_CAPABILITIES, DEFAULT_MEMBER_CAPABILITIES } from './types'

export type UserRole = 'admin' | 'member'

interface UserCtx {
  userId: string
  name: string
  role: UserRole
  isAdmin: boolean
  caps: TeamCapabilities
  org_id: string | null
  has_org: boolean
  org: { name: string; slug: string } | null
  loading: boolean
}

const defaultCtx: UserCtx = {
  userId: '', name: '', role: 'member', isAdmin: false,
  caps: DEFAULT_MEMBER_CAPABILITIES,
  org_id: null, has_org: false, org: null, loading: true,
}

const UserContext = createContext<UserCtx>(defaultCtx)

const PENDING_EXEMPT = ['/pending', '/invite/', '/login', '/sign-in', '/new-client', '/accept/']

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<UserCtx>(defaultCtx)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => {
        const role: UserRole = d.role === 'admin' ? 'admin' : 'member'
        const isAdmin = role === 'admin'
        const caps: TeamCapabilities = isAdmin
          ? ALL_CAPABILITIES
          : { ...DEFAULT_MEMBER_CAPABILITIES, ...(d.capabilities ?? {}) }
        setCtx({ ...d, role, isAdmin, caps, loading: false })
      })
      .catch(() => setCtx(c => ({ ...c, loading: false })))
  }, [])

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
