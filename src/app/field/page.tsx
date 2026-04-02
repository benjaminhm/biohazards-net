'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import type { Job } from '@/lib/types'

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene:    'Crime Scene',
  hoarding:       'Hoarding',
  mold:           'Mould',
  sewage:         'Sewage',
  trauma:         'Trauma',
  unattended_death: 'Unattended Death',
  flood:          'Flood',
  other:          'Other',
}

// Urgency — muted, informational. Field worker doesn't need the stress amplified.
const URGENCY_COLOR: Record<string, string> = {
  standard:  '#60A5FA',
  urgent:    '#F59E0B',
  emergency: '#F87171',
}

const ACTIVE_STATUSES = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway']

function fmtSchedule(iso: string) {
  const d = new Date(iso)
  const today    = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const isToday    = d.toDateString() === today.toDateString()
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const day = isToday ? 'Today' : isTomorrow ? 'Tomorrow'
    : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return { label: `${day}  ·  ${time}`, isToday, isTomorrow }
}

export default function FieldPage() {
  const router = useRouter()
  const { name, isAdmin, org, loading: userLoading } = useUser()
  const [jobs, setJobs]       = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [isPreview, setIsPreview] = useState(false)

  useEffect(() => {
    setIsPreview(localStorage.getItem('preview_as_field') === '1')
  }, [])

  function exitPreview() {
    localStorage.removeItem('preview_as_field')
    router.replace('/')
  }

  useEffect(() => {
    if (userLoading) return
    const preview = localStorage.getItem('preview_as_field') === '1'
    if (isAdmin && !preview) { router.replace('/'); return }
    fetch('/api/jobs')
      .then(r => r.json())
      .then(d => setJobs((d.jobs ?? []).filter((j: Job) => ACTIVE_STATUSES.includes(j.status))))
      .finally(() => setLoading(false))
  }, [userLoading, isAdmin, router])

  const todayStr  = new Date().toDateString()
  const todayJobs = jobs.filter(j => j.scheduled_at && new Date(j.scheduled_at).toDateString() === todayStr)
  const otherJobs = jobs.filter(j => !j.scheduled_at || new Date(j.scheduled_at).toDateString() !== todayStr)

  const firstName = name.split(' ')[0] || 'there'

  if (userLoading || loading) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg)',
      }}>
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 48 }}>

      {/* Preview banner */}
      {isPreview && (
        <div style={{
          background: '#1D4ED8', color: '#fff',
          padding: '11px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>👁 Previewing field worker view</span>
          <button
            onClick={exitPreview}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none',
              borderRadius: 6, padding: '5px 12px',
              color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}
          >
            Exit
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ padding: '28px 20px 24px', borderBottom: '1px solid var(--border)' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {org?.name ?? 'Biohazard Cleaning'}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 4 }}>
          Hi {firstName}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
          {todayJobs.length > 0
            ? `${todayJobs.length} job${todayJobs.length > 1 ? 's' : ''} scheduled for today`
            : 'No jobs scheduled today'}
        </div>
      </div>

      <div style={{ padding: '24px 16px' }}>

        {/* Today's jobs */}
        {todayJobs.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--accent)' }}>
              Today
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {todayJobs.map(j => (
                <FieldJobCard key={j.id} job={j} onClick={() => router.push(`/jobs/${j.id}`)} highlight />
              ))}
            </div>
          </section>
        )}

        {/* All active jobs */}
        <section>
          {otherJobs.length > 0 && (
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              Active Jobs
            </div>
          )}

          {otherJobs.length === 0 && todayJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 44, marginBottom: 16, opacity: 0.6 }}>✓</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Clear queue</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No active jobs right now.</div>
            </div>
          ) : otherJobs.length === 0 ? null : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {otherJobs.map(j => (
                <FieldJobCard key={j.id} job={j} onClick={() => router.push(`/jobs/${j.id}`)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FieldJobCard({ job, onClick, highlight }: {
  job: Job
  onClick: () => void
  highlight?: boolean
}) {
  const urgencyColor = URGENCY_COLOR[job.urgency] ?? '#60A5FA'
  const schedule = job.scheduled_at ? fmtSchedule(job.scheduled_at) : null

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        background: highlight ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${highlight ? 'rgba(255,107,53,0.2)' : 'var(--border)'}`,
        borderLeft: `4px solid ${urgencyColor}`,
        borderRadius: 14,
        padding: '18px 18px 16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        transition: 'background 0.12s',
        minHeight: 80,
      }}
    >
      {/* Row 1: type + urgency dot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>
          {JOB_TYPE_LABELS[job.job_type] ?? job.job_type}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
          background: `${urgencyColor}18`, color: urgencyColor,
          textTransform: 'capitalize', letterSpacing: '0.04em',
        }}>
          {job.urgency}
        </div>
      </div>

      {/* Row 2: address */}
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: schedule ? 8 : 0, lineHeight: 1.4 }}>
        {job.site_address}
      </div>

      {/* Row 3: time (if scheduled) */}
      {schedule && (
        <div style={{
          fontSize: 13, fontWeight: 700,
          color: schedule.isToday ? 'var(--accent)' : 'var(--text-muted)',
          letterSpacing: '-0.01em',
        }}>
          {schedule.label}
        </div>
      )}
    </button>
  )
}
