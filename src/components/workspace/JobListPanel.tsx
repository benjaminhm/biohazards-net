'use client'

/*
 * components/workspace/JobListPanel.tsx
 *
 * Left panel: every open job, grouped by status, with search. A dot marks
 * unread activity (calls, enquiries, other staff) and a count marks agent
 * drafts waiting for approval. The chevron (open by default for the open job)
 * lists the job's File agent and document agents to talk to directly.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { isPlainClick } from '@/lib/plainClick'
import type { Job, JobStatus } from '@/lib/types'
import type { DocAgentType } from '@/lib/agent/subagents/types'
import DraftList, { type DraftView } from './DraftList'
import JobAgentList from './JobAgentList'
import { triggerNativeHaptic, useIsTabletApp, useOnlineStatus } from '@/lib/tabletApp'

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
  newJobDrafts,
  onNewJobDecided,
  activeJobId,
  activeDocAgent,
  onSelect,
  onSelectAgent,
  agentsRefreshKey,
  loading,
}: {
  jobs: Job[]
  markers: Record<string, JobMarkers>
  newJobDrafts: DraftView[]
  onNewJobDecided: (created: string[]) => void
  activeJobId: string | null
  activeDocAgent: DocAgentType | null
  onSelect: (id: string) => void
  onSelectAgent: (jobId: string, docAgent: DocAgentType | null) => void
  agentsRefreshKey: number
  loading: boolean
}) {
  const [q, setQ] = useState('')
  /** Explicit open/closed per job; the open job is expanded unless closed. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
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

  const waitingCount = Object.values(markers).filter(m => m.pending_drafts || m.unread).length + newJobDrafts.length
  const isTablet = useIsTabletApp()
  const online = useOnlineStatus()

  return (
    <div
      className="rp-rail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        background: 'var(--rail-bg)',
        color: 'var(--rail-text)',
        borderRight: '1px solid var(--rail-border)',
      }}
    >
      <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--rail-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="rp-rail-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search jobs…"
          style={{ fontSize: 13, padding: '8px 11px' }}
        />
        <button
          type="button"
          onClick={() => {
            triggerNativeHaptic('light')
            setWaitingOnly(v => !v)
          }}
          aria-pressed={waitingOnly}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px',
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            border: waitingOnly ? '1px solid rgba(249,115,22,0.35)' : '1px solid var(--rail-border)',
            background: waitingOnly ? 'rgba(249,115,22,0.14)' : 'var(--rail-surface)',
            color: waitingOnly ? '#FB923C' : 'var(--rail-muted)',
            cursor: 'pointer',
          }}
        >
          <span>Needs attention</span>
          <span
            className="num"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 99,
              background: waitingCount ? 'rgba(249,115,22,0.22)' : 'rgba(148,163,184,0.12)',
              color: waitingCount ? '#FB923C' : 'var(--rail-muted)',
            }}
          >
            {waitingCount}
          </span>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {newJobDrafts.length > 0 && (
          <div style={{ padding: '4px 2px 8px' }}>
            <DraftList
              drafts={newJobDrafts}
              title={`New job${newJobDrafts.length === 1 ? '' : 's'} to create`}
              onDecided={onNewJobDecided}
            />
          </div>
        )}
        {loading && <div style={{ padding: 12, fontSize: 13, color: 'var(--rail-muted)' }}>Loading jobs…</div>}
        {!loading && !groups.length && <div style={{ padding: 12, fontSize: 13, color: 'var(--rail-muted)' }}>No jobs</div>}
        {groups.map(g => (
          <div key={g.status} style={{ marginBottom: 6 }}>
            <div style={{ padding: '10px 8px 5px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--rail-dim)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{STATUS_LABELS[g.status]}</span>
              <span className="num">{g.jobs.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {g.jobs.map(j => {
                const m = markers[j.id]
                const active = j.id === activeJobId
                const open = expanded[j.id] ?? active
                return (
                  <div key={j.id}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: 9,
                        background: active ? 'rgba(249,115,22,0.14)' : 'transparent',
                        border: active ? '1px solid rgba(249,115,22,0.32)' : '1px solid transparent',
                        transition: 'background 0.12s, border-color 0.12s',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(e => ({ ...e, [j.id]: !open }))}
                        aria-expanded={open}
                        aria-label={open ? 'Hide agents' : 'Show agents'}
                        title={open ? 'Hide agents' : 'Show agents'}
                        style={{
                          width: 26,
                          alignSelf: 'stretch',
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          color: active ? '#FB923C' : 'var(--rail-dim)',
                          fontSize: 11,
                          padding: '0 0 0 6px',
                          flexShrink: 0,
                        }}
                      >
                        {open ? '▾' : '▸'}
                      </button>
                      <Link
                        href={`/workspace?job=${j.id}`}
                        onClick={e => {
                          if (!isPlainClick(e)) return
                          e.preventDefault()
                          triggerNativeHaptic('light')
                          onSelect(j.id)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flex: 1,
                          minWidth: 0,
                          textAlign: 'left',
                          padding: isTablet ? '9px 10px 9px 2px' : '7px 10px 7px 2px',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 13,
                          lineHeight: 'normal',
                          background: 'transparent',
                          color: active ? '#FFF7ED' : 'var(--rail-text)',
                        }}
                      >
                        <span
                          className="num"
                          style={{
                            fontFamily: 'ui-monospace, Menlo, monospace',
                            fontSize: 11,
                            fontWeight: 700,
                            color: active ? '#FB923C' : '#F97316',
                            flexShrink: 0,
                          }}
                        >
                          {j.job_code ?? '----'}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: active || m?.unread ? 600 : 400 }}>
                          {j.client_name || 'Unnamed'}
                          {suburb(j.site_address) && (
                            <span style={{ color: active ? 'rgba(255,247,237,0.68)' : 'var(--rail-muted)', fontWeight: 400 }}>
                              {' · '}{suburb(j.site_address)}
                            </span>
                          )}
                        </span>
                        {m?.pending_drafts ? (
                          <span
                            title="Agent changes waiting"
                            className="num"
                            style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 99, background: '#F97316', color: '#020617' }}
                          >
                            {m.pending_drafts}
                          </span>
                        ) : null}
                        {m?.unread ? <span title="New activity" style={{ width: 7, height: 7, borderRadius: 4, background: '#38BDF8', flexShrink: 0 }} /> : null}
                      </Link>
                    </div>
                    {open && (
                      <JobAgentList
                        jobId={j.id}
                        isActiveJob={active}
                        activeDocAgent={active ? activeDocAgent : null}
                        refreshKey={active ? agentsRefreshKey : 0}
                        onSelect={agent => onSelectAgent(j.id, agent)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* RankPulse-style live status footer pill */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--rail-border)' }}>
        <div
          style={{
            padding: '7px 10px',
            borderRadius: 9,
            background: 'var(--rail-surface)',
            border: '1px solid var(--rail-border)',
            fontSize: 11,
            color: 'var(--rail-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{isTablet ? 'Tablet Mode' : 'Workspace'}</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: online ? '#34D399' : '#FBBF24',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: online ? '#34D399' : '#FBBF24',
              }}
            />
            {online ? 'Ready' : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  )
}
