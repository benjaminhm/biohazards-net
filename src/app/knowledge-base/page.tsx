/*
 * app/knowledge-base/page.tsx
 *
 * Knowledge Base — empty shell. Gated by `orgs.features.training_education`
 * (platform org toggle; DB flag name retained for compatibility). The previous
 * implementation (catalog, student management, case-study lifecycle, portal
 * preview) has been cleared so the room can be redesigned from zero. When
 * design is ready, start work here.
 */
'use client'

import Link from 'next/link'
import { useUser } from '@/lib/userContext'

export default function KnowledgeBasePage() {
  const { org, loading } = useUser()
  const enabled = org?.features?.training_education === true

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: '24px 20px 40px',
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 20,
        }}
      >
        ← Dashboard
      </Link>

      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>
        Knowledge Base
      </h1>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Courses &amp; resources
      </div>

      {!loading && org && !enabled ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          Knowledge Base is not enabled for your organisation. Contact your platform administrator if you need access.
        </p>
      ) : (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px dashed var(--border)',
            borderRadius: 16,
            padding: '28px 22px',
            maxWidth: 520,
          }}
        >
          <div style={{ fontSize: 30, marginBottom: 10 }}>📖</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Coming soon</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
            This room is being redesigned. Courses, resources, and learning material will live here once the new Knowledge Base is ready.
          </p>
        </div>
      )}
    </div>
  )
}
