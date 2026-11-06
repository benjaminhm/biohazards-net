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
import { parseTarget, patchLines } from '@/lib/agent/patchDraft'
import { newJobLines, type NewJobProposal, type PossibleDuplicate } from '@/lib/agent/newJobDraft'
import { draftedByLabel } from '@/lib/agent/subagents/labels'

export interface DraftView {
  id: string
  job_id: string | null
  kind: 'field' | 'note' | 'status' | 'document' | 'new_job'
  target_path: string
  before: unknown
  proposed: unknown
  summary: string
  status: 'pending' | 'approved' | 'rejected' | 'stale'
  created_by?: string
}

const STATUS_TEXT: Record<DraftView['status'], string> = {
  pending: '',
  approved: 'Approved',
  rejected: 'Rejected',
  stale: 'Out of date',
}

export interface DecideResult {
  failed: { id: string; error: string }[]
  /** Jobs created by approving 'new_job' drafts. */
  created: string[]
}

function createdJobs(list: unknown): string[] {
  return (Array.isArray(list) ? (list as DraftView[]) : [])
    .filter(d => d?.kind === 'new_job' && d.status === 'approved' && d.job_id)
    .map(d => d.job_id as string)
}

export async function decideDrafts(action: 'approve' | 'reject', ids: string[]): Promise<DecideResult> {
  if (ids.length === 1) {
    const res = await fetch(`/api/agent/drafts/${ids[0]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { failed: [{ id: ids[0], error: data.error || 'Failed' }], created: [] }
    return { failed: [], created: createdJobs([data.draft]) }
  }
  const res = await fetch('/api/agent/drafts/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ids }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { failed: ids.map(id => ({ id, error: data.error || 'Failed' })), created: [] }
  return { failed: data.failed ?? [], created: createdJobs(data.done) }
}

export default function DraftList({
  drafts,
  onDecided,
  onFocus,
  title,
}: {
  drafts: DraftView[]
  onDecided: (created: string[]) => void
  onFocus?: (d: DraftView) => void
  title?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!drafts.length) return null
  const pending = drafts.filter(d => d.status === 'pending' && d.kind !== 'new_job')
  const onlyNewJobs = drafts.every(d => d.kind === 'new_job')

  async function decide(action: 'approve' | 'reject', ids: string[]) {
    if (!ids.length || busy) return
    setBusy(true)
    setError('')
    let created: string[] = []
    try {
      const r = await decideDrafts(action, ids)
      created = r.created
      if (r.failed.length) setError(r.failed.map(f => f.error).join(' '))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
      onDecided(created)
    }
  }

  return (
    <div style={{ border: '1px solid rgba(255,107,53,0.35)', borderRadius: 10, background: 'var(--accent-dim)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {title ?? (onlyNewJobs ? 'Create job' : pending.length ? `${pending.length} change${pending.length === 1 ? '' : 's'} waiting` : 'Changes')}
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
      {drafts.map(d => d.kind === 'new_job' ? (
        <NewJobCard key={d.id} d={d} busy={busy} onDecide={action => decide(action, [d.id])} />
      ) : (
        <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            type="button"
            onClick={() => onFocus?.(d)}
            style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, color: 'var(--text)', fontSize: 13, cursor: onFocus ? 'pointer' : 'default', opacity: d.status === 'pending' ? 1 : 0.55 }}
          >
            {draftedByLabel(d.created_by) && (
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>{draftedByLabel(d.created_by)}</div>
            )}
            {d.summary}
            {d.status === 'pending' && d.kind === 'field' && isOverwrite(d.before) && (
              <span style={warnStyle}>⚠ changes what&apos;s on file</span>
            )}
            {d.status !== 'pending' && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>{STATUS_TEXT[d.status]}</span>}
            {d.kind === 'document' && parseTarget(d.target_path) && (
              <div style={{ marginTop: 4, display: 'grid', gap: 2 }}>
                {patchLines(d.before, d.proposed).map(l => (
                  <div key={l.path} style={{ fontSize: 12, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{l.path}</span>
                    {': '}
                    {l.overwrite ? `${l.before} → ${l.after}` : l.after}
                    {d.status === 'pending' && l.overwrite && <span style={warnStyle}>⚠ overwrites</span>}
                  </div>
                ))}
              </div>
            )}
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

function NewJobCard({ d, busy, onDecide }: { d: DraftView; busy: boolean; onDecide: (action: 'approve' | 'reject') => void }) {
  const lines = newJobLines((d.proposed ?? {}) as Partial<NewJobProposal>)
  const dups = ((d.before as { possible_duplicates?: PossibleDuplicate[] } | null)?.possible_duplicates ?? [])
  const done = d.status === 'approved' ? 'Created' : d.status === 'rejected' ? 'Discarded' : STATUS_TEXT[d.status]
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)', opacity: d.status === 'pending' ? 1 : 0.55 }}>
      <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
        {lines.length ? lines.map(l => (
          <div key={l.label} style={{ overflowWrap: 'anywhere' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{l.label}: </span>{l.value}
          </div>
        )) : <div style={{ color: 'var(--text-muted)' }}>Empty job, no details yet</div>}
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>New lead · job type Other</div>
      </div>
      {dups.map(x => (
        <div key={x.id} style={{ ...warnStyle, marginLeft: 0, marginTop: 4, display: 'block' }}>
          ⚠ Possible duplicate: #{x.job_code ?? ''} {x.client_name ?? ''}{x.site_address ? ` · ${x.site_address}` : ''} ({x.reasons.join(', ')})
        </div>
      ))}
      {d.status === 'pending' ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} style={smallBtn} onClick={() => onDecide('approve')}>Create</button>
          <button type="button" className="btn btn-ghost" disabled={busy} style={smallBtn} onClick={() => onDecide('reject')}>Discard</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{done}</div>
      )}
    </div>
  )
}

const smallBtn = { padding: '3px 10px', fontSize: 12 } as const
const warnStyle = { marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#FBBF24' } as const

function iconBtn(color: string) {
  return {
    width: 26, height: 26, borderRadius: 6, border: `1px solid ${color}55`, background: 'transparent',
    color, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  } as const
}
