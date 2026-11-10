/*
 * app/jobs/queue/page.tsx
 *
 * Job Manager — three columns. Left: every job as a compact menu row, grouped
 * by pipeline stage (lead → paid) with search, checkboxes for bulk archive, and
 * a hide toggle remembered in localStorage. Middle: the open job's numbered
 * Home sections (lib/jobHomeSections); the chosen section carries over when
 * switching jobs. Right: the job's full page in a same-origin iframe
 * (lib/jobEmbed) with its own section drawer hidden, and status, archive and
 * delete in a toolbar above it. Admins and members with view_all_jobs only;
 * others are redirected to /field.
 *
 * /jobs/queue?job=<id> opens a job. On narrow screens there is no viewer and a
 * row opens the job page directly. + New Job creates a blank job, adds it to the
 * list and opens it on Initial Contact.
 */
'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CompanyProfile, Job, JobStatus } from '@/lib/types'
import { useUser } from '@/lib/userContext'
import { FILE_MENU_PARAM, JOB_EMBED_MSG } from '@/lib/jobEmbed'
import { isHomeSection, visibleHomeSections, type HomeSection } from '@/lib/jobHomeSections'

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

const WIDE_QUERY = '(min-width: 1100px)'
const LIST_HIDDEN_KEY = 'bh.jobManager.listHidden'

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

function JobRow({ job, active, showPrice, checked, onCheck, onSelect }: {
  job: Job
  active: boolean
  showPrice: boolean
  checked: boolean
  onCheck: (checked: boolean) => void
  onSelect: () => void
}) {
  const price = job.assessment_data?.target_price
  const isArchived = Boolean(job.archived_at)
  const place = suburb(job.site_address)

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
      background: active ? 'var(--surface-2)' : checked ? 'rgba(255,107,53,0.06)' : 'transparent',
      opacity: isArchived ? 0.7 : 1,
    }}>
      <label style={{ display: 'flex', alignItems: 'center', padding: '0 4px 0 9px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onCheck(e.target.checked)}
          aria-label={`Select ${job.client_name || 'job'}`}
        />
      </label>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        style={{
          display: 'block', flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
          padding: '8px 12px 8px 6px', border: 'none', background: 'transparent', color: 'var(--text)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
            {job.job_code ?? '----'}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.client_name || 'New job'}
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
    </div>
  )
}

function FileMenu({ job, sections, active, onOpen }: {
  job: Job
  sections: { id: HomeSection; label: string }[]
  active: HomeSection | null
  onOpen: (section: HomeSection) => void
}) {
  return (
    <nav aria-label="Job file sections" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', borderRight: '1px solid var(--border)' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', minWidth: 0 }}>
        <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>
          {job.job_code ? `#${job.job_code}` : 'Job file'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.client_name || 'Unnamed'}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sections.map((s, i) => {
          const selected = s.id === active
          return (
            <button
              key={s.id}
              type="button"
              aria-current={selected ? 'page' : undefined}
              onClick={() => onOpen(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: selected ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: selected ? 'var(--blue)' : 'var(--text)',
                fontSize: 13, fontWeight: selected ? 700 : 600,
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: '50%', fontSize: 11, fontWeight: 700, flexShrink: 0,
                background: selected ? 'var(--blue)' : 'var(--surface-2)',
                color: selected ? '#fff' : 'var(--text-muted)',
              }}>
                {i + 1}
              </span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function JobViewer({
  job,
  sections,
  section,
  showArchived,
  onSectionShown,
  onJobPatched,
  onRemoveJob,
  onEmbedChanged,
}: {
  job: Job
  sections: { id: HomeSection; label: string }[]
  section: HomeSection | null
  showArchived: boolean
  onSectionShown: (section: HomeSection) => void
  onJobPatched: (job: Job) => void
  onRemoveJob: (id: string) => void
  onEmbedChanged: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showModal, setShowModal] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [archiveSaving, setArchiveSaving] = useState(false)
  const [shown, setShown] = useState<HomeSection | null>(null)
  const isArchived = Boolean(job.archived_at)
  const base = `/jobs/${job.id}`
  const hasMenu = sections.length > 0
  // Fixed per job (the viewer is keyed by job id) so later section changes don't reload the frame.
  const [frameSrc] = useState(() => {
    if (!hasMenu) return base
    const qs = new URLSearchParams({ [FILE_MENU_PARAM]: 'parent' })
    if (section) {
      qs.set('tab', 'home')
      qs.set('section', section)
    }
    return `${base}?${qs}`
  })

  const onChangedRef = useRef(onEmbedChanged)
  const onShownRef = useRef(onSectionShown)
  useEffect(() => {
    onChangedRef.current = onEmbedChanged
    onShownRef.current = onSectionShown
  })

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === JOB_EMBED_MSG.changed) onChangedRef.current()
      else if (e.data?.type === JOB_EMBED_MSG.location) {
        const onHome = e.data.tab === 'home' && isHomeSection(e.data.section)
        setShown(onHome ? e.data.section : null)
        if (onHome) onShownRef.current(e.data.section)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /** A generated document opens outside the job page, where no bridge listens, so reload the job page at the section. */
  function openSection(next: HomeSection) {
    const win = iframeRef.current?.contentWindow
    let bridged = false
    try {
      bridged = win?.location.pathname === base
        && new URLSearchParams(win.location.search).get(FILE_MENU_PARAM) === 'parent'
    } catch {}
    if (win && !bridged) {
      const qs = new URLSearchParams({ [FILE_MENU_PARAM]: 'parent', tab: 'home', section: next })
      win.location.assign(`${base}?${qs}`)
      return
    }
    win?.postMessage({ type: JOB_EMBED_MSG.openSection, section: next }, window.location.origin)
  }

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
    <div style={{ display: 'grid', gridTemplateColumns: hasMenu ? '230px minmax(0, 1fr)' : 'minmax(0, 1fr)', minHeight: 0, height: '100%' }}>
      {hasMenu && <FileMenu job={job} sections={sections} active={shown} onOpen={openSection} />}
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
          ref={iframeRef}
          src={frameSrc}
          title={`Job ${job.job_code ?? job.client_name ?? ''}`}
          style={{ flex: 1, minHeight: 0, width: '100%', border: 'none', background: 'var(--bg)' }}
        />
      </div>
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
  const [section, setSection] = useState<HomeSection | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [listHidden, setListHidden] = useState(false)
  const { org: ctxOrg, loading: userLoading, isAdmin, caps } = useUser()
  const fileSections = useMemo(() => visibleHomeSections(caps), [caps])

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

  useEffect(() => {
    setListHidden(window.localStorage.getItem(LIST_HIDDEN_KEY) === '1')
  }, [])

  function toggleList() {
    setListHidden(h => {
      window.localStorage.setItem(LIST_HIDDEN_KEY, h ? '0' : '1')
      return !h
    })
  }

  const checkedJobs = jobs.filter(j => checkedIds.has(j.id))
  const checkedArchived = checkedJobs.filter(j => j.archived_at).length
  const checkedActive = checkedJobs.length - checkedArchived

  function setChecked(ids: string[], on: boolean) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function bulkArchive(archived: boolean) {
    const targets = checkedJobs.filter(j => Boolean(j.archived_at) !== archived)
    if (!targets.length || bulkSaving) return
    const n = targets.length
    if (archived && !window.confirm(`Archive ${n} job${n === 1 ? '' : 's'}? They will disappear from the main queue but stay in the database for reporting.`)) return
    setBulkSaving(true)
    const results = await Promise.all(targets.map(j =>
      fetch(`/api/jobs/${j.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      }).then(r => r.ok).catch(() => false),
    ))
    const failed = results.filter(ok => !ok).length
    await loadJobs(true)
    if (archived && !showArchived && selectedId && targets.some(j => j.id === selectedId)) selectJob(null)
    setCheckedIds(new Set())
    setBulkSaving(false)
    if (failed) window.alert(`${failed} of ${n} job${n === 1 ? '' : 's'} could not be ${archived ? 'archived' : 'restored'}.`)
  }

  function onRowClick(id: string) {
    if (wide) selectJob(id)
    else router.push(`/jobs/${id}`)
  }

  async function createJob() {
    if (creating) return
    setCreating(true)
    try {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blank: true }),
      })
      const data = (await r.json().catch(() => ({}))) as { job?: Job; error?: string }
      if (!r.ok || !data.job) throw new Error(data.error || 'Could not create the job.')
      const job = data.job
      if (!wide) {
        router.push(`/jobs/${job.id}?tab=home&section=initial_contact`)
        return
      }
      setJobs(prev => [job, ...prev.filter(j => j.id !== job.id)])
      setQ('')
      setListHidden(false)
      setSection('initial_contact')
      selectJob(job.id)
      setCreating(false)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create the job.')
      setCreating(false)
    }
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
          <button type="button" className="btn btn-primary" disabled={creating} onClick={() => void createJob()} style={{ fontSize: 14, padding: '8px 16px' }}>
            {creating ? <span className="spinner" /> : '+ New Job'}
          </button>
          <Link href="/settings">
            <button className="btn btn-ghost" style={{ fontSize: 18, padding: '4px 8px' }} title="Company Settings">⚙️</button>
          </Link>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: !wide ? '1fr' : listHidden ? '36px minmax(0, 1fr)' : '340px minmax(0, 1fr)' }}>
        {/* Job menu */}
        {wide && listHidden ? (
          <button
            type="button"
            onClick={toggleList}
            title="Show job list"
            aria-label="Show job list"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 12,
              border: 'none', borderRight: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
            }}
          >
            <span>»</span>
            <span style={{ writingMode: 'vertical-rl', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Jobs · {jobs.length}
            </span>
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: wide ? '1px solid var(--border)' : 'none' }}>
            <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search jobs"
                  style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '7px 10px' }}
                />
                {wide && (
                  <button
                    type="button"
                    onClick={toggleList}
                    title="Hide job list"
                    aria-label="Hide job list"
                    className="btn btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 14, color: 'var(--text-muted)' }}
                  >
                    «
                  </button>
                )}
              </div>
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
              {checkedJobs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: 'var(--surface-2)', fontSize: 12 }}>
                  <span style={{ flex: 1, fontWeight: 700 }}>{checkedJobs.length} selected</span>
                  {checkedActive > 0 && (
                    <button type="button" className="btn btn-primary" disabled={bulkSaving} onClick={() => void bulkArchive(true)} style={{ fontSize: 12, padding: '4px 10px' }}>
                      {bulkSaving ? <span className="spinner" /> : `Archive${checkedArchived ? ` ${checkedActive}` : ''}`}
                    </button>
                  )}
                  {checkedArchived > 0 && (
                    <button type="button" className="btn btn-secondary" disabled={bulkSaving} onClick={() => void bulkArchive(false)} style={{ fontSize: 12, padding: '4px 10px' }}>
                      {`Restore${checkedActive ? ` ${checkedArchived}` : ''}`}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" disabled={bulkSaving} onClick={() => setCheckedIds(new Set())} style={{ fontSize: 12, padding: '4px 8px', color: 'var(--text-muted)' }}>
                    Clear
                  </button>
                </div>
              )}
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

              {!loading && !error && groups.map(g => {
                const ids = g.jobs.map(j => j.id)
                const nChecked = ids.filter(id => checkedIds.has(id)).length
                return (
                  <div key={g.status}>
                    <div style={{
                      position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)',
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px',
                    }}>
                      <input
                        type="checkbox"
                        checked={nChecked === ids.length}
                        ref={el => { if (el) el.indeterminate = nChecked > 0 && nChecked < ids.length }}
                        onChange={e => setChecked(ids, e.target.checked)}
                        aria-label={`Select all ${STATUS_LABELS[g.status]} jobs`}
                        title={`Select all ${STATUS_LABELS[g.status]}`}
                      />
                      <span className={`badge badge-${g.status}`}>{STATUS_LABELS[g.status]}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.jobs.length}</span>
                    </div>
                    {g.jobs.map(job => (
                      <JobRow
                        key={job.id}
                        job={job}
                        active={wide && job.id === selectedId}
                        showPrice={caps.view_quote}
                        checked={checkedIds.has(job.id)}
                        onCheck={on => setChecked([job.id], on)}
                        onSelect={() => onRowClick(job.id)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Viewer */}
        {wide && (
          <div style={{ minHeight: 0, minWidth: 0 }}>
            {selectedJob ? (
              <JobViewer
                key={selectedJob.id}
                job={selectedJob}
                sections={fileSections}
                section={section}
                onSectionShown={setSection}
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
