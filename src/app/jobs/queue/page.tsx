/*
 * app/jobs/queue/page.tsx
 *
 * Job Manager — a split view. Left: every job as a compact menu row, grouped
 * by pipeline stage (lead → paid) with search. Right: the selected job's full
 * page in a same-origin iframe (lib/jobEmbed), with status, archive and delete
 * in a toolbar above it. Admins and members with view_all_jobs only; others are
 * redirected to /field.
 *
 * /jobs/queue?job=<id> opens a job. On narrow screens there is no viewer and a
 * row opens the job page directly.
 */
'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CompanyProfile, Job, JobStatus } from '@/lib/types'
import { useUser } from '@/lib/userContext'
import { JOB_EMBED_MSG } from '@/lib/jobEmbed'

const STATUS_ORDER: JobStatus[] = [
  'lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway',
  'completed', 'report_sent', 'paid',
]

const STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'Lead',
  assessed: 'Assessed',
  quoted: 'Quoted',
  accepted: 'Accepted ✓',
  scheduled: 'Scheduled',
  underway: 'Underway',
  completed: 'Completed',
  report_sent: 'Report Sent',
  paid: 'Paid',
}

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene',
  hoarding: 'Hoarding',
  mold: 'Mold',
  sewage: 'Sewage',
  trauma: 'Trauma',
  unattended_death: 'Unattended Death',
  flood: 'Flood',
  other: 'Other',
}

const URGENCY_ICON: Record<string, string> = {
  emergency: '🔴',
  urgent: '🟠',
  standard: '⚪',
}

const WIDE_QUERY = '(min-width: 900px)'

function subscribeWide(cb: () => void) {
  const mql = window.matchMedia(WIDE_QUERY)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true)
}

function suburb(address: string | null | undefined): string {
  const parts = (address ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[1].replace(/\s+(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, '') : parts[0] ?? ''
}

function DeleteModal({ clientName, onConfirm, onCancel }: {
  clientName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const match = typed.trim().toLowerCase() === clientName.trim().toLowerCase()

  async function handleConfirm() {
    if (!match) return
    setDeleting(true)
    await onConfirm()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 12,
        border: '1px solid var(--border)', padding: 24,
        width: '100%', maxWidth: 400,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Delete Job</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          This will permanently delete the job and all associated photos and documents.
          Type <strong style={{ color: 'var(--text)' }}>{clientName}</strong> to confirm.
        </div>
        <input
          autoFocus
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={`Type "${clientName}"`}
          onKeyDown={e => { if (e.key === 'Enter' && match) handleConfirm(); if (e.key === 'Escape') onCancel() }}
          style={{
            width: '100%', marginBottom: 16,
            border: `1px solid ${typed.length > 0 ? (match ? '#22C55E' : '#F87171') : 'var(--border)'}`,
            borderRadius: 6, padding: '10px 12px', fontSize: 15,
            background: 'var(--surface-2)', color: 'var(--text)',
            transition: 'border-color 0.15s',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!match || deleting}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              background: match ? '#EF4444' : 'var(--surface-2)',
              color: match ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${match ? '#EF4444' : 'var(--border)'}`,
              cursor: match ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            {deleting ? <span className="spinner" /> : 'Delete Job'}
          </button>
        </div>
      </div>
    </div>
  )
}

function JobRow({ job, active, showPrice, onSelect }: {
  job: Job
  active: boolean
  showPrice: boolean
  onSelect: () => void
}) {
  const price = job.assessment_data?.target_price
  const isArchived = Boolean(job.archived_at)
  const place = suburb(job.site_address)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '8px 12px 8px 10px', border: 'none',
        borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
        background: active ? 'var(--surface-2)' : 'transparent',
        color: 'var(--text)', opacity: isArchived ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
          {job.job_code ?? '----'}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.client_name || 'Unnamed'}
        </span>
        {showPrice && price ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981', flexShrink: 0 }}>
            ${price.toLocaleString('en-AU')}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <span style={{ flexShrink: 0 }}>{URGENCY_ICON[job.urgency]}</span>
        <span style={{ flexShrink: 0 }}>{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</span>
        {place && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>· {place}</span>}
        {isArchived && <span style={{ marginLeft: 'auto', fontWeight: 600, flexShrink: 0 }}>Archived</span>}
      </div>
    </button>
  )
}

function JobViewer({
  job,
  showArchived,
  onJobPatched,
  onRemoveJob,
  onEmbedChanged,
}: {
  job: Job
  showArchived: boolean
  onJobPatched: (job: Job) => void
  onRemoveJob: (id: string) => void
  onEmbedChanged: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showModal, setShowModal] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [archiveSaving, setArchiveSaving] = useState(false)
  const isArchived = Boolean(job.archived_at)
  const base = `/jobs/${job.id}`

  const onChangedRef = useRef(onEmbedChanged)
  useEffect(() => {
    onChangedRef.current = onEmbedChanged
  })

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === JOB_EMBED_MSG.changed) onChangedRef.current()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function refreshFrame() {
    iframeRef.current?.contentWindow?.postMessage({ type: JOB_EMBED_MSG.refresh }, window.location.origin)
  }

  async function handleDelete() {
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    setShowModal(false)
    onRemoveJob(job.id)
  }

  async function handleStatusChange(next: JobStatus) {
    if (next === job.status || statusSaving) return
    setStatusSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update status')
      if (data.job) onJobPatched(data.job)
      refreshFrame()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusSaving(false)
    }
  }

  async function setArchived(archived: boolean) {
    if (archiveSaving) return
    setArchiveSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update archive')
      if (!data.job) return
      if (archived && !showArchived) onRemoveJob(job.id)
      else onJobPatched(data.job)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not update archive')
    } finally {
      setArchiveSaving(false)
    }
  }

  const btn: React.CSSProperties = { fontSize: 12, padding: '5px 10px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {showModal && (
        <DeleteModal
          clientName={job.client_name}
          onConfirm={handleDelete}
          onCancel={() => setShowModal(false)}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <select
          aria-label="Job status"
          value={job.status}
          disabled={statusSaving || isArchived}
          onChange={e => void handleStatusChange(e.target.value as JobStatus)}
          className={`badge badge-${job.status}`}
          style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
            cursor: statusSaving || isArchived ? 'not-allowed' : 'pointer',
            background: 'var(--surface-2)', color: 'inherit',
          }}
        >
          {STATUS_ORDER.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {isArchived && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Archived</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {!isArchived ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Archive this job? It will disappear from the main queue but stay in the database for reporting.')) {
                  void setArchived(true)
                }
              }}
              disabled={archiveSaving}
              title="Archive job"
              className="btn btn-ghost"
              style={{ ...btn, color: 'var(--text-muted)' }}
            >
              Archive
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void setArchived(false)}
              disabled={archiveSaving}
              title="Restore to queue"
              className="btn btn-secondary"
              style={btn}
            >
              Restore
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowModal(true)}
            title="Permanently delete job"
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '4px 8px', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            {'\u{1F5D1}\uFE0F'}
          </button>
          <a href={base} target="_blank" rel="noopener" className="btn btn-ghost" style={{ ...btn, textDecoration: 'none' }} title="Open this job in a new tab">
            Open full page ↗
          </a>
        </div>
      </div>
      <iframe
        key={job.id}
        ref={iframeRef}
        src={base}
        title={`Job ${job.job_code ?? job.client_name ?? ''}`}
        style={{ flex: 1, minHeight: 0, width: '100%', border: 'none', background: 'var(--bg)' }}
      />
    </div>
  )
}

export default function JobQueuePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading jobs…</div>}>
      <JobQueue />
    </Suspense>
  )
}

function JobQueue() {
  const router = useRouter()
  const params = useSearchParams()
  const wide = useIsWide()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(params.get('job'))
  const { org: ctxOrg, loading: userLoading, isAdmin, caps } = useUser()

  // Full pipeline board is for admins and members with view_all_jobs only.
  useEffect(() => {
    if (userLoading) return
    if (!isAdmin && !caps.view_all_jobs) router.replace('/field')
  }, [userLoading, isAdmin, caps.view_all_jobs, router])

  const selectJob = useCallback((id: string | null) => {
    setSelectedId(id)
    router.replace(id ? `/jobs/queue?job=${id}` : '/jobs/queue', { scroll: false })
  }, [router])

  function handleJobPatched(updated: Job) {
    setJobs(prev => prev.map(j => (j.id === updated.id ? updated : j)))
  }

  function handleRemoveJob(id: string) {
    setJobs(prev => prev.filter(j => j.id !== id))
    if (id === selectedId) selectJob(null)
  }

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
      .catch(() => {})
  }, [])

  const loadJobs = useCallback(async (quiet: boolean) => {
    try {
      const r = await fetch(showArchived ? '/api/jobs?include_archived=true' : '/api/jobs')
      const data = (await r.json().catch(() => ({}))) as { jobs?: Job[]; error?: string }
      if (!r.ok) {
        if (quiet) return
        const msg =
          typeof data.error === 'string' && data.error.trim()
            ? data.error
            : r.status === 401
              ? 'Not signed in or no organisation — try signing out and back in.'
              : `Could not load jobs (HTTP ${r.status}).`
        setError(msg)
        setJobs([])
        return
      }
      setError('')
      setJobs(data.jobs ?? [])
    } catch {
      if (!quiet) {
        setError(
          'Could not load jobs (network error or non-JSON response). Check the Vercel deployment and function logs for /api/jobs.',
        )
      }
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => {
    if (userLoading) return
    if (!isAdmin && !caps.view_all_jobs) return
    void loadJobs(false)
  }, [userLoading, isAdmin, caps.view_all_jobs, loadJobs])

  const brandName = company?.name || ctxOrg?.name || 'Company'

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? jobs.filter(j =>
          [j.job_code, j.client_name, j.site_address, j.client_organization_name]
            .some(v => (v ?? '').toLowerCase().includes(needle)))
      : jobs
    return STATUS_ORDER
      .map(status => ({ status, jobs: list.filter(j => j.status === status) }))
      .filter(g => g.jobs.length)
  }, [jobs, q])

  const firstJobId = groups[0]?.jobs[0]?.id ?? null
  useEffect(() => {
    if (wide && !loading && !selectedId && firstJobId) selectJob(firstJobId)
  }, [wide, loading, selectedId, firstJobId, selectJob])

  const selectedJob = selectedId ? jobs.find(j => j.id === selectedId) ?? null : null

  function onRowClick(id: string) {
    if (wide) selectJob(id)
    else router.push(`/jobs/${id}`)
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Link href="/" style={{ fontSize: 20, color: 'var(--text-muted)', textDecoration: 'none', lineHeight: 1, padding: '2px 4px' }}>←</Link>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 2 }}>
              {brandName}
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Job Manager</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/jobs/new">
            <button className="btn btn-primary" style={{ fontSize: 14, padding: '8px 16px' }}>+ New Job</button>
          </Link>
          <Link href="/settings">
            <button className="btn btn-ghost" style={{ fontSize: 18, padding: '4px 8px' }} title="Company Settings">⚙️</button>
          </Link>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: wide ? '340px minmax(0, 1fr)' : '1fr' }}>
        {/* Job menu */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: wide ? '1px solid var(--border)' : 'none' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="input"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search jobs"
              style={{ fontSize: 13, padding: '7px 10px' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={e => {
                    setShowArchived(e.target.checked)
                    setLoading(true)
                  }}
                />
                Show archived
              </label>
              <span>{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                <div style={{ fontSize: 13 }}>Loading jobs...</div>
              </div>
            )}

            {error && (
              <div style={{ margin: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: 12, fontSize: 13, color: '#F87171' }}>
                {error}
              </div>
            )}

            {!loading && !error && jobs.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🧤</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>No jobs yet</div>
                <div style={{ fontSize: 13 }}>Create your first job to get started</div>
              </div>
            )}

            {!loading && !error && jobs.length > 0 && groups.length === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>No jobs match “{q}”</div>
            )}

            {!loading && !error && groups.map(g => (
              <div key={g.status}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)',
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px',
                }}>
                  <span className={`badge badge-${g.status}`}>{STATUS_LABELS[g.status]}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.jobs.length}</span>
                </div>
                {g.jobs.map(job => (
                  <JobRow
                    key={job.id}
                    job={job}
                    active={wide && job.id === selectedId}
                    showPrice={caps.view_quote}
                    onSelect={() => onRowClick(job.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Viewer */}
        {wide && (
          <div style={{ minHeight: 0, minWidth: 0 }}>
            {selectedJob ? (
              <JobViewer
                job={selectedJob}
                showArchived={showArchived}
                onJobPatched={handleJobPatched}
                onRemoveJob={handleRemoveJob}
                onEmbedChanged={() => void loadJobs(true)}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                {loading ? '' : 'Select a job from the list'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
