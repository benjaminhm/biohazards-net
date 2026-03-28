'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Job, JobStatus } from '@/lib/types'

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

function JobCard({ job }: { job: Job }) {
  return (
    <Link href={`/jobs/${job.id}`}>
      <div className="card" style={{ marginBottom: 10, cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
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
          </div>
          <span className={`badge badge-${job.status}`} style={{ flexShrink: 0 }}>
            {STATUS_LABELS[job.status]}
          </span>
        </div>
      </div>
    </Link>
  )
}

export default function JobQueuePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  const grouped = STATUS_ORDER.reduce<Record<JobStatus, Job[]>>((acc, status) => {
    acc[status] = jobs.filter(j => j.status === status)
    return acc
  }, {} as Record<JobStatus, Job[]>)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 2 }}>
              Brisbane Biohazard Cleaning
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Job Queue</h1>
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
              {group.map(job => <JobCard key={job.id} job={job} />)}
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
