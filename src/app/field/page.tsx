'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import type { Job } from '@/lib/types'

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene', hoarding: 'Hoarding', mold: 'Mold', sewage: 'Sewage',
  trauma: 'Trauma', unattended_death: 'Unattended Death', flood: 'Flood', other: 'Other',
}

const URGENCY_COLORS: Record<string, string> = {
  standard: '#60A5FA', urgent: '#FBBF24', emergency: '#F87171',
}

const ACTIVE_STATUSES = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway']

function fmtSchedule(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const isToday = d.toDateString() === today.toDateString()
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const day = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

export default function FieldPage() {
  const router = useRouter()
  const { name, role, org, loading: userLoading } = useUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userLoading) return
    // Owners/admins/operators should not be on this page
    if (role === 'owner' || role === 'admin') { router.replace('/'); return }
    fetch('/api/jobs')
      .then(r => r.json())
      .then(d => setJobs((d.jobs ?? []).filter((j: Job) => ACTIVE_STATUSES.includes(j.status))))
      .finally(() => setLoading(false))
  }, [userLoading, role, router])

  const today = new Date().toDateString()
  const todayJobs = jobs.filter(j => j.scheduled_at && new Date(j.scheduled_at).toDateString() === today)
  const otherJobs = jobs.filter(j => !j.scheduled_at || new Date(j.scheduled_at).toDateString() !== today)

  if (userLoading || loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '20px 20px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          {org?.name ?? 'Biohazard Cleaning'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 22 }}>Hi {name.split(' ')[0]} 👋</div>
        <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textTransform: 'capitalize', marginTop: 2 }}>{role}</div>
      </div>

      <div style={{ padding: '20px 16px' }}>

        {/* Today's jobs */}
        {todayJobs.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 }}>
              📅 Today
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {todayJobs.map(j => <JobCard key={j.id} job={j} onClick={() => router.push(`/jobs/${j.id}`)} />)}
            </div>
          </section>
        )}

        {/* All active jobs */}
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
            📋 Active Jobs
          </div>
          {otherJobs.length === 0 && todayJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              No active jobs right now.
            </div>
          ) : otherJobs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No other active jobs.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {otherJobs.map(j => <JobCard key={j.id} job={j} onClick={() => router.push(`/jobs/${j.id}`)} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function JobCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const urgencyColor = URGENCY_COLORS[job.urgency] ?? '#60A5FA'

  return (
    <button onClick={onClick} style={{ width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${urgencyColor}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</div>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: urgencyColor + '22', color: urgencyColor, textTransform: 'capitalize', flexShrink: 0 }}>
          {job.urgency}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>📍 {job.site_address}</div>
      {job.scheduled_at && (
        <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>🕐 {fmtSchedule(job.scheduled_at)}</div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize', marginTop: 2 }}>{job.status.replace(/_/g, ' ')}</div>
    </button>
  )
}
