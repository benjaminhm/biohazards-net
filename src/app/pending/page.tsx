/*
 * app/pending/page.tsx
 *
 * Holding page for users who have signed up (exist in Clerk) but have not
 * yet been linked to any org (no org_users row). UserProvider redirects here
 * when /api/me returns has_org: false.
 *
 * The page tells the user to ask their manager for an invite link and provides
 * a sign-out button in case they need to log in with a different account.
 *
 * Displays the user's email address from Clerk so they can confirm they're
 * signed in with the right account before contacting their admin.
 *
 * This is a dead-end page — the user can't do anything here except sign out
 * or wait for the platform admin to add them via the admin dashboard.
 */
'use client'

import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/nextjs'

export default function PendingPage() {
  const { signOut, user } = useClerk()
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (user) {
      setEmail(user.emailAddresses[0]?.emailAddress ?? '')
    }
  }, [user])

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        textAlign: 'center',
      }}>
        {/* Icon */}
        <div style={{ fontSize: 56, marginBottom: 20 }}>⏳</div>

        {/* Heading */}
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          Account Pending
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 28 }}>
          Your account has been created but hasn&apos;t been linked to an organisation yet.
          <br /><br />
          Ask your manager to send you an invite link, or contact your admin to get set up.
        </div>

        {/* Email pill */}
        {email && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '8px 16px',
            fontSize: 13,
            color: 'var(--text-muted)',
            marginBottom: 32,
          }}>
            <span style={{ fontSize: 16 }}>✉️</span>
            {email}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 24 }} />

        {/* Sign out */}
        <button
          onClick={() => signOut({ redirectUrl: '/login' })}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 24px',
            fontSize: 14,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Sign out
        </button>

        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-muted)', opacity: 0.5 }}>
          biohazards.net
        </div>
      </div>
    </div>
  )
}
