/*
 * app/jobs/queue/page.tsx
 *
 * Full job queue / pipeline view — a kanban-style status board showing all
 * jobs ordered by status pipeline stage (lead → paid). Admins and members
 * with view_all_jobs see every job. Members without it are redirected to /field.
 *
 * STATUS_ORDER determines column ordering in the kanban view. Jobs within each
 * status group are sorted by created_at descending (newest first).
 *
 * This page fetches all jobs (no ?upcoming filter) to provide the complete
 * operations overview, unlike the dashboard which focuses on upcoming scheduled jobs.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CompanyProfile, Job, JobStatus } from '@/lib/types'
import { useUser } from '@/lib/userContext'

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

function JobCard({ job, onDelete }: { job: Job; onDelete: (id: string) => void }) {
  const [showModal, setShowModal] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const { caps } = useUser()
  const price = job.assessment_data?.target_price
  const priceNote = job.assessment_data?.target_price_note

  async function handleConfirm() {
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    setDeleted(true)
    setShowModal(false)
    onDelete(job.id)
  }

  if (deleted) return null

  return (
    <>
      {showModal && (
        <DeleteModal
          clientName={job.client_name}
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
        />
      )}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <Link href={`/jobs/${job.id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{job.client_name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.site_address}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {URGENCY_ICON[job.urgency]} {JOB_TYPE_LABELS[job.job_type] ?? job.job_type}
              </span>
              <span className={`badge badge-${job.urgency}`}>{job.urgency}</span>
            </div>
          </Link>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <span className={`badge badge-${job.status}`}>{STATUS_LABELS[job.status]}</span>
            {caps.view_quote && price && (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#10B981' }}>
                ${price.toLocaleString('en-AU')}{priceNote ? ` ${priceNote}` : ''}
              </span>
            )}
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setShowModal(true) }}
              title="Delete job"
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                padding: '4px 8px', fontSize: 13, color: 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default function JobQueuePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const { org: ctxOrg } = useUser()

  function handleDelete(id: string) {
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/jobs')
      .then(r => r.json())
      .then(data => {
        setJobs(data.jobs ?? [])
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load jobs. Check your Supabase configuration.')
        setLoading(false)
      })
  }, [])

  const brandName = company?.name || ctxOrg?.name || 'Company'

  const grouped = STATUS_ORDER.reduce<Record<JobStatus, Job[]>>((acc, status) => {
    acc[status] = jobs.filter(j => j.status === status)
    return acc
  }, {} as Record<JobStatus, Job[]>)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/" style={{ fontSize: 20, color: 'var(--text-muted)', textDecoration: 'none', lineHeight: 1, padding: '2px 4px' }}>←</Link>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 2 }}>
                {brandName}
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>Job Queue</h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {jobs.length} job{jobs.length !== 1 ? 's' : ''}
            </div>
            <Link href="/settings">
              <button className="btn btn-ghost" style={{ fontSize: 18, padding: '4px 8px' }} title="Company Settings">⚙️</button>
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container" style={{ paddingTop: 24 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <div>Loading jobs...</div>
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: 16, color: '#F87171' }}>
            {error}
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧤</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No jobs yet</div>
            <div style={{ fontSize: 13 }}>Create your first job to get started</div>
          </div>
        )}

        {!loading && !error && STATUS_ORDER.map(status => {
          const group = grouped[status]
          if (group.length === 0) return null
          return (
            <div key={status} style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{group.length}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              {group.map(job => <JobCard key={job.id} job={job} onDelete={handleDelete} />)}
            </div>
          )
        })}
      </div>

      {/* Pinned New Job button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent, var(--bg) 40%)',
        padding: '24px 16px 24px',
        display: 'flex', justifyContent: 'center',
      }}>
        <Link href="/jobs/new">
          <button className="btn btn-primary" style={{ fontSize: 16, padding: '14px 40px', borderRadius: 12, boxShadow: '0 4px 20px rgba(255,107,53,0.4)' }}>
            + New Job
          </button>
        </Link>
      </div>
    </div>
  )
}
