/*
 * lib/userContext.tsx
 *
 * Global client-side user context. Fetches the current user's role,
 * capabilities, and org membership from /api/me on mount, then makes
 * that data available to every component via useUser().
 *
 * Key behaviours:
 * - If the user has no org membership (has_org: false), they are redirected
 *   to /pending unless they are on an exempt route (invite/login/new-client).
 * - If the user is an admin with localStorage 'preview_caps' set, those
 *   capabilities replace ALL_CAPABILITIES — enabling admin-as-member preview.
 * - For non-admins, capabilities = DEFAULT_MEMBER_CAPABILITIES merged with
 *   any custom capabilities returned by /api/me.
 *
 * exitPreview() removes preview_caps from localStorage and reloads the page
 * so the admin's real capabilities are re-applied.
 */
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
  previewMode: boolean
  exitPreview: () => void
}

const defaultCtx: UserCtx = {
  userId: '', name: '', role: 'member', isAdmin: false,
  caps: DEFAULT_MEMBER_CAPABILITIES,
  org_id: null, has_org: false, org: null, loading: true,
  previewMode: false,
  exitPreview: () => {},
}

const UserContext = createContext<UserCtx>(defaultCtx)

// Routes that don't require org membership — new users land on /pending while
// they wait for an admin to invite them to an org.
const PENDING_EXEMPT = ['/pending', '/invite/', '/login', '/sign-in', '/new-client', '/accept/']

/*
 * Reads preview capabilities from localStorage — only valid for admins.
 * JSON.parse wrapped in try/catch in case the stored value is malformed.
 */
function getPreviewCaps(): TeamCapabilities | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('preview_caps')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<UserCtx>(defaultCtx)
  const pathname = usePathname()
  const router = useRouter()

  function exitPreview() {
    localStorage.removeItem('preview_caps')
    window.location.reload()
  }

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => {
        const role: UserRole = d.role === 'admin' ? 'admin' : 'member'
        const isAdmin = role === 'admin'
        // Only admins can enter preview mode; non-admins never have preview_caps
        const previewCaps = isAdmin ? getPreviewCaps() : null
        const previewMode = !!previewCaps
        // Priority: preview caps > admin full caps > member defaults merged with custom
        const caps: TeamCapabilities = previewCaps
          ?? (isAdmin ? ALL_CAPABILITIES : { ...DEFAULT_MEMBER_CAPABILITIES, ...(d.capabilities ?? {}) })
        setCtx({ ...d, role, isAdmin, caps, loading: false, previewMode, exitPreview })
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
