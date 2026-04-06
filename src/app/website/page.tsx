/*
 * app/website/page.tsx
 *
 * Organisation website / marketing area — shell for future content (orgs.features.website_card).
 */
'use client'

import Link from 'next/link'
import { useUser } from '@/lib/userContext'

export default function WebsitePage() {
  const { org, loading } = useUser()
  const enabled = org?.features?.website_card === true

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: '24px 20px 40px' }}>
      <Link
        href="/"
        style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}
      >
        ← Dashboard
      </Link>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 }}>
        Website
      </h1>
      {!loading && org && !enabled ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          The website card is not enabled for your organisation. Contact your platform administrator if you need access.
        </p>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          Public site links and marketing tools will appear here.
        </p>
      )}
    </div>
  )
}
