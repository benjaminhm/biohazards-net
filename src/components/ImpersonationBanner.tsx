/*
 * components/ImpersonationBanner.tsx
 *
 * Fixed banner when a platform admin is impersonating a tenant org (training /
 * debugging). Exit calls DELETE /api/admin/impersonate and reloads.
 */
'use client'

import { useUser } from '@/lib/userContext'

export default function ImpersonationBanner() {
  const { impersonating, impersonationReadOnly, exitImpersonation } = useUser()
  if (!impersonating) return null

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10000,
          background: '#C2410C',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          flexWrap: 'wrap',
        }}
      >
        <span>
          🔧 Impersonating organisation
          {impersonationReadOnly ? ' (read-only)' : ' (full access)'}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>|</span>
        <span style={{ opacity: 0.9, fontWeight: 400 }}>
          For support and debugging — all actions are audited
        </span>
        <button
          type="button"
          onClick={() => void exitImpersonation()}
          style={{
            marginLeft: 4,
            padding: '3px 10px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.4)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          End session
        </button>
      </div>
      <div style={{ height: 40 }} />
    </>
  )
}
