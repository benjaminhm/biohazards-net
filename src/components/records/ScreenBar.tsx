'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

export function ScreenBar({ title, sub, back }: { title: string; sub?: string; back: string }) {
  const router = useRouter()
  return (
    <div style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      position: 'sticky',
      top: 0,
      zIndex: 20,
    }}>
      <button
        type="button"
        onClick={() => router.push(back)}
        style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px', minWidth: 44, minHeight: 44 }}
      >
        ←
      </button>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div>
        {sub ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sub}</div> : null}
      </div>
    </div>
  )
}

export const bigButton: CSSProperties = {
  width: '100%',
  minHeight: 64,
  borderRadius: 16,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 18,
  cursor: 'pointer',
}

export const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px 14px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 16,
}

export function pageWrap(children: ReactNode, bar: ReactNode) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 32 }}>
      {bar}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}
