'use client'

/*
 * components/workspace/JobListPanel.tsx
 *
 * Left panel: every open job, grouped by status, with search. A dot marks
 * unread activity (calls, enquiries, other staff) and a count marks agent
 * drafts waiting for approval.
 */
import { useMemo, useState } from 'react'
import type { Job, JobStatus } from '@/lib/types'

export interface JobMarkers { pending_drafts: number; unread: number }

export const STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'Lead', assessed: 'Assessed', quoted: 'Quoted', accepted: 'Accepted',
  scheduled: 'Scheduled', underway: 'Underway', completed: 'Completed',
  report_sent: 'Report sent', paid: 'Paid',
}
const ORDER: JobStatus[] = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway', 'completed', 'report_sent', 'paid']

export function suburb(address: string | null | undefined): string {
  const parts = (address ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[1].replace(/\s+(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, '') : parts[0] ?? ''
}

export default function JobListPanel({
  jobs,
  markers,
  activeJobId,
  onSelect,
  loading,
}: {
  jobs: Job[]
  markers: Record<string, JobMarkers>
  activeJobId: string | null
  onSelect: (id: string) => void
  loading: boolean
}) {
  const [q, setQ] = useState('')
  const [waitingOnly, setWaitingOnly] = useState(false)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = jobs.filter(j => {
      if (waitingOnly) {
        const m = markers[j.id]
        if (!m || (!m.pending_drafts && !m.unread)) return false
      }
      if (!needle) return true
      return [j.job_code, j.client_name, j.site_address, j.client_organization_name]
        .some(v => (v ?? '').toLowerCase().includes(needle))
    })
    return ORDER.map(s => ({ status: s, jobs: list.filter(j => j.status === s) })).filter(g => g.jobs.length)
  }, [jobs, markers, q, waitingOnly])

  const waitingCount = Object.values(markers).filter(m => m.pending_drafts || m.unread).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', borderRight: '1px solid var(--border)' }}>
      <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          className="input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search jobs"
          style={{ fontSize: 13, padding: '7px 10px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={waitingOnly} onChange={e => setWaitingOnly(e.target.checked)} />
          Needs me{waitingCount ? ` (${waitingCount})` : ''}
        </label>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading jobs…</div>}
        {!loading && !groups.length && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>No jobs</div>}
        {groups.map(g => (
          <div key={g.status}>
            <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {STATUS_LABELS[g.status]} · {g.jobs.length}
            </div>
            {g.jobs.map(j => {
              const m = markers[j.id]
              const active = j.id === activeJobId
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => onSelect(j.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 13,
                    background: active ? 'var(--surface-2)' : 'transparent',
                    borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
                    {j.job_code ?? '----'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: m?.unread ? 700 : 400 }}>
                    {j.client_name || 'Unnamed'}
                    {suburb(j.site_address) && <span style={{ color: 'var(--text-muted)' }}> · {suburb(j.site_address)}</span>}
                  </span>
                  {m?.pending_drafts ? (
                    <span title="Agent changes waiting" style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: 'var(--accent)', color: '#000' }}>
                      {m.pending_drafts}
                    </span>
                  ) : null}
                  {m?.unread ? <span title="New activity" style={{ width: 7, height: 7, borderRadius: 4, background: '#60A5FA', flexShrink: 0 }} /> : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
