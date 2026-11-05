'use client'

/*
 * components/workspace/DraftList.tsx
 *
 * Pending agent changes with approve / reject on each, and Accept all /
 * Reject all. Used in the workspace chat (change cards), the workspace right
 * panel, and the Classic job page banner — all hit the same endpoints.
 */
import { useState } from 'react'
import { isOverwrite } from '@/lib/agent/workspaceText'

export interface DraftView {
  id: string
  job_id: string
  kind: 'field' | 'note' | 'status' | 'document'
  target_path: string
  before: unknown
  proposed: unknown
  summary: string
  status: 'pending' | 'approved' | 'rejected' | 'stale'
}

const STATUS_TEXT: Record<DraftView['status'], string> = {
  pending: '',
  approved: 'Approved',
  rejected: 'Rejected',
  stale: 'Out of date',
}

export async function decideDrafts(action: 'approve' | 'reject', ids: string[]): Promise<{ failed: { id: string; error: string }[] }> {
  if (ids.length === 1) {
    const res = await fetch(`/api/agent/drafts/${ids[0]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({}))
    return { failed: res.ok ? [] : [{ id: ids[0], error: data.error || 'Failed' }] }
  }
  const res = await fetch('/api/agent/drafts/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ids }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { failed: ids.map(id => ({ id, error: data.error || 'Failed' })) }
  return { failed: data.failed ?? [] }
}

export default function DraftList({
  drafts,
  onDecided,
  onFocus,
  title,
}: {
  drafts: DraftView[]
  onDecided: () => void
  onFocus?: (d: DraftView) => void
  title?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!drafts.length) return null
  const pending = drafts.filter(d => d.status === 'pending')

  async function decide(action: 'approve' | 'reject', ids: string[]) {
    if (!ids.length || busy) return
    setBusy(true)
    setError('')
    try {
      const { failed } = await decideDrafts(action, ids)
      if (failed.length) setError(failed.map(f => f.error).join(' '))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
      onDecided()
    }
  }

  return (
    <div style={{ border: '1px solid rgba(255,107,53,0.35)', borderRadius: 10, background: 'var(--accent-dim)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {title ?? (pending.length ? `${pending.length} change${pending.length === 1 ? '' : 's'} waiting` : 'Changes')}
        </div>
        {pending.length > 1 && (
          <>
            <button type="button" className="btn btn-ghost" disabled={busy} style={smallBtn} onClick={() => decide('reject', pending.map(d => d.id))}>
              Reject all
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} style={smallBtn} onClick={() => decide('approve', pending.map(d => d.id))}>
              Accept all
            </button>
          </>
        )}
      </div>
      {drafts.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            type="button"
            onClick={() => onFocus?.(d)}
            style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, color: 'var(--text)', fontSize: 13, cursor: onFocus ? 'pointer' : 'default', opacity: d.status === 'pending' ? 1 : 0.55 }}
          >
            {d.summary}
            {d.status === 'pending' && d.kind === 'field' && isOverwrite(d.before) && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#FBBF24' }}>⚠ changes what&apos;s on file</span>
            )}
            {d.status !== 'pending' && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>{STATUS_TEXT[d.status]}</span>}
          </button>
          {d.status === 'pending' && (
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button type="button" aria-label="Approve" title="Approve" disabled={busy} style={iconBtn('#4ADE80')} onClick={() => decide('approve', [d.id])}>✓</button>
              <button type="button" aria-label="Reject" title="Reject" disabled={busy} style={iconBtn('#F87171')} onClick={() => decide('reject', [d.id])}>✕</button>
            </div>
          )}
        </div>
      ))}
      {error && <div style={{ fontSize: 12, color: '#F87171', marginTop: 6 }}>{error}</div>}
    </div>
  )
}

const smallBtn = { padding: '3px 10px', fontSize: 12 } as const

function iconBtn(color: string) {
  return {
    width: 26, height: 26, borderRadius: 6, border: `1px solid ${color}55`, background: 'transparent',
    color, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  } as const
}
