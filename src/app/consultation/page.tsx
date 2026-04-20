/*
 * app/consultation/page.tsx
 *
 * Consultation — placeholder page for the Consultation home-screen tile.
 *
 * Gated on the platform org feature flag `orgs.features.consultation`
 * (toggled from /platform/orgs/[id] → Consultation card). When the flag is
 * off, the dashboard tile is hidden but this route still resolves so deep
 * links don't 404. The actual module is not built yet — this shell is the
 * starting point when we begin implementing consultation flows.
 */
'use client'

import Link from 'next/link'
import { useUser } from '@/lib/userContext'

export default function ConsultationPage() {
  const { org, loading } = useUser()
  const enabled = org?.features?.consultation === true

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
        Consultation
      </h1>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Client consultations
      </div>

      {!loading && org && !enabled ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          Consultation is not enabled for your organisation. Contact your platform administrator if you need access.
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
          <div style={{ fontSize: 30, marginBottom: 10 }}>💬</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Coming soon</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
            This is where client consultation flows will live — intake conversations, scoping notes,
            and hand-off to a job file once the engagement is confirmed.
          </p>
        </div>
      )}
    </div>
  )
}
