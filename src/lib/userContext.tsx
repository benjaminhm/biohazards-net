/*
 * lib/userContext.tsx
 *
 * Global client-side user context. Fetches the current user's role,
 * capabilities, and org membership from /api/me on mount, then makes
 * that data available to every component via useUser().
 *
 * Key behaviours:
 * - If the user has no org membership (has_org: false), they are redirected
 *   to /pending unless they are on an exempt route (invite/login).
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
  /** Tenant org; `show_quick_feedback`, `training_education`, `website_card` (Marketing Manager tile), `consultation` (Consultation tile). */
  org: { name: string; slug: string; features?: Record<string, boolean> } | null
  loading: boolean
  previewMode: boolean
  exitPreview: () => void
  /** Platform-admin tenant impersonation (see /api/admin/impersonate) */
  impersonating: boolean
  impersonationReadOnly: boolean
  exitImpersonation: () => Promise<void>
}

const defaultCtx: UserCtx = {
  userId: '', name: '', role: 'member', isAdmin: false, isManager: false,
  caps: DEFAULT_MEMBER_CAPABILITIES,
  org_id: null, has_org: false, org: null, loading: true,
  previewMode: false,
  exitPreview: () => {},
  impersonating: false,
  impersonationReadOnly: false,
  exitImpersonation: async () => {},
}

const UserContext = createContext<UserCtx>(defaultCtx)

// Routes that don't require org membership — new users land on /pending while
// they wait for an admin to invite them to an org.
// Platform super-admins may have no org_users row yet; /platform and /admin must stay reachable.
const PENDING_EXEMPT = ['/pending', '/invite/', '/login', '/sign-in', '/accept/', '/platform', '/admin']

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

  async function exitImpersonation() {
    await fetch('/api/admin/impersonate', { method: 'DELETE' })
    window.location.reload()
  }

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => {
        const role: UserRole = d.role === 'admin' ? 'admin' : d.role === 'manager' ? 'manager' : 'member'
        const isAdmin   = role === 'admin'
        const isManager = role === 'manager'
        const impersonating = !!d.impersonating
        const impersonationReadOnly = !!d.impersonation_read_only
        // Only admins can enter preview mode; managers/members never have preview_caps
        const previewCaps = isAdmin && !impersonating ? getPreviewCaps() : null
        const previewMode = !!previewCaps
        // Priority: preview caps > admin full caps > manager defaults (+ custom) > member defaults (+ custom)
        const baseCaps = isAdmin
          ? ALL_CAPABILITIES
          : isManager
            ? { ...DEFAULT_MANAGER_CAPABILITIES, ...(d.capabilities ?? {}) }
            : { ...DEFAULT_MEMBER_CAPABILITIES,  ...(d.capabilities ?? {}) }
        /*
         * Legacy-member shim for the 10 Home sub-tab caps (view_home_*). Any
         * existing member whose org_users row pre-dates these caps will have
         * them missing from the stored capabilities object — the merge above
         * then falls through to DEFAULT_MEMBER_CAPABILITIES (all false) and
         * they would see no Home at all. As a one-time migration, if the user
         * currently has generate_documents (the old Home gate) and no
         * view_home_* key has been explicitly stored, grant all ten. Once an
         * admin saves caps for this member, the keys are persisted in DB and
         * the branch stops firing.
         */
        const dbCaps = (d.capabilities ?? {}) as Record<string, unknown>
        const hasAnyStoredHomeCap =
          'view_home_initial_contact'   in dbCaps ||
          'view_home_onsite_assessment' in dbCaps ||
          'view_home_scope_of_work'     in dbCaps ||
          'view_home_quote'             in dbCaps ||
          'view_home_legal'             in dbCaps ||
          'view_home_safety_compliance' in dbCaps ||
          'view_home_plan'              in dbCaps ||
          'view_home_execute'           in dbCaps ||
          'view_home_verify'            in dbCaps ||
          'view_home_review'            in dbCaps
        const migratedBase: TeamCapabilities = (!isAdmin && !isManager && baseCaps.generate_documents && !hasAnyStoredHomeCap)
          ? {
              ...baseCaps,
              view_home_initial_contact:   true,
              view_home_onsite_assessment: true,
              view_home_scope_of_work:     true,
              view_home_quote:             true,
              view_home_legal:             true,
              view_home_safety_compliance: true,
              view_home_plan:              true,
              view_home_execute:           true,
              view_home_verify:            true,
              view_home_review:            true,
            }
          : baseCaps
        const caps: TeamCapabilities = previewCaps ?? migratedBase
        setCtx({
          ...d,
          role,
          isAdmin,
          isManager,
          caps,
          loading: false,
          previewMode,
          exitPreview,
          impersonating,
          impersonationReadOnly,
          exitImpersonation,
        })
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
