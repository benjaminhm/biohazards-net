/*
 * app/portal/layout.tsx
 *
 * Chrome and gate for the commercial accounts portal.
 *
 * The root layout renders this subtree without ClerkProvider (see the
 * x-subdomain: accounts branch in app/layout.tsx), so authentication is handled
 * here against /api/portal/me:
 *
 *   no session          -> /portal/login
 *   session, stale T&Cs -> /portal/terms until accepted
 *
 * The gate is skipped on the login routes, which must render for signed-out
 * visitors, and on /portal/terms itself.
 */
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { PortalProvider, usePortal } from '@/components/portal/PortalContext'
import {
  PortalHeader,
  PortalNav,
  Spinner,
  buttonStyle,
  container,
  page,
} from '@/components/portal/portalUi'

function isLoginRoute(pathname: string): boolean {
  return pathname === '/portal/login' || pathname.startsWith('/portal/login/')
}

function SignOutButton() {
  const router = useRouter()
  return (
    <button
      type="button"
      style={{ ...buttonStyle('secondary'), padding: '9px 16px', fontSize: 13 }}
      onClick={async () => {
        await fetch('/api/portal/auth/logout', { method: 'POST' })
        router.replace('/portal/login')
      }}
    >
      Sign out
    </button>
  )
}

function PortalGate({ children }: { children: React.ReactNode }) {
  const { me, loading } = usePortal()
  const pathname = usePathname()
  const router = useRouter()
  const onLoginRoute = isLoginRoute(pathname)

  useEffect(() => {
    if (loading || onLoginRoute) return
    if (!me) {
      router.replace('/portal/login')
      return
    }
    if (!me.terms_current && pathname !== '/portal/terms') {
      router.replace('/portal/terms')
    }
  }, [loading, me, onLoginRoute, pathname, router])

  if (onLoginRoute) return <div style={page}>{children}</div>

  if (loading) return <Spinner message="Loading your account…" />
  if (!me) return <Spinner message="Redirecting to sign in…" />

  return (
    <div style={page}>
      <PortalHeader
        brandLabel={me.brand.label}
        accountName={me.account.trading_as || me.account.legal_name}
        right={<SignOutButton />}
      />
      <div style={container}>
        {me.terms_current && <PortalNav current={pathname} />}
        {children}
      </div>
    </div>
  )
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <PortalGate>{children}</PortalGate>
    </PortalProvider>
  )
}
