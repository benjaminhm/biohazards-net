/*
 * app/field/page.tsx
 *
 * Field worker view — a simplified job schedule for team members who don't
 * need the full job list. Shows only the jobs assigned to the current user
 * that are in an active status (lead → underway). Completed/paid jobs are omitted
 * to keep the view focused on what needs doing today.
 *
 * Admins who land here are redirected back to the dashboard (/). Members with
 * view_all_jobs also redirect because they have a richer dashboard experience.
 * Only members without view_all_jobs are meant to stay on this page.
 *
 * ACTIVE_STATUSES is the filter — it excludes 'completed', 'report_sent', 'paid'
 * so the field worker sees a short actionable list rather than job history.
 *
 * fmtSchedule() shows relative time labels ("Today", "Tomorrow", day name) so
 * field workers can scan their schedule at a glance without reading full dates.
 */
'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { useUser } from '@/lib/userContext'
import OnboardingChecklist from '@/components/OnboardingChecklist'

interface FieldJob {
  id: string
  status: string
  urgency: string
  job_type: string
  site_address: string
  scheduled_at: string | null
  assigned_tasks?: { id: string; body: string; completed: boolean }[]
  assigned_note?: { id: string; note: string; updated_at: string } | null
}

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

function subscribePreviewState() {
  return () => {}
}

function getPreviewStateSnapshot() {
  const isPreview = localStorage.getItem('preview_as_field') === '1' ? '1' : '0'
  const name = localStorage.getItem('preview_name') ?? ''
  return `${isPreview}|${name}`
}

function getPreviewStateServerSnapshot() {
  return '0|'
}

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
  const { signOut } = useClerk()
  const { name, isAdmin, org, loading: userLoading } = useUser()
  const [showMenu, setShowMenu]     = useState(false)
  const [jobs, setJobs]             = useState<FieldJob[]>([])
  const [loading, setLoading]       = useState(true)
  const previewState = useSyncExternalStore(
    subscribePreviewState,
    getPreviewStateSnapshot,
    getPreviewStateServerSnapshot
  )
  const [isPreviewRaw, previewName] = previewState.split('|')
  const isPreview = isPreviewRaw === '1'

  function exitPreview() {
    localStorage.removeItem('preview_as_field')
    localStorage.removeItem('preview_caps')
    localStorage.removeItem('preview_name')
    router.replace('/')
  }

  useEffect(() => {
    if (userLoading) return
    const preview = localStorage.getItem('preview_as_field') === '1'
    if (isAdmin && !preview) { router.replace('/'); return }
    fetch('/api/field/jobs')
      .then(r => r.json())
      .then(d => setJobs((d.jobs ?? []).filter((j: FieldJob) => ACTIVE_STATUSES.includes(j.status))))
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

      {/* Onboarding checklist — shown until profile is complete */}
      {!isPreview && <OnboardingChecklist />}

      {/* Preview banner */}
      {isPreview && (
        <div style={{
          background: '#1D4ED8', color: '#fff',
          padding: '11px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>👁 Previewing as {previewName || 'field worker'}</span>
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
      <div style={{ padding: '28px 20px 24px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
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

        {/* Account menu — top right */}
        <div style={{ position: 'absolute', top: 20, right: 20 }}>
          <button
            onClick={() => setShowMenu(m => !m)}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 99, width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, cursor: 'pointer', color: 'var(--text-muted)',
            }}
          >
            ···
          </button>
          {showMenu && (
            <div style={{
              position: 'absolute', top: 44, right: 0,
              background: 'var(--surface)', border: '1px solid var(--border-2)',
              borderRadius: 12, minWidth: 160, zIndex: 100,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}>
              <button
                onClick={() => signOut({ redirectUrl: '/login' })}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '13px 16px', background: 'none', border: 'none',
                  fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span>→</span> Sign out
              </button>
            </div>
          )}
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
                <FieldJobCard key={j.id} job={j} onClick={() => router.push(`/field/jobs/${j.id}`)} highlight />
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
                <FieldJobCard key={j.id} job={j} onClick={() => router.push(`/field/jobs/${j.id}`)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FieldJobCard({ job, onClick, highlight }: {
  job: FieldJob
  onClick: () => void
  highlight?: boolean
}) {
  const urgencyColor = URGENCY_COLOR[job.urgency] ?? '#60A5FA'
  const schedule = job.scheduled_at ? fmtSchedule(job.scheduled_at) : null
  const tasks = job.assigned_tasks ?? []
  const openTasks = tasks.filter(task => !task.completed)
  const note = (job.assigned_note?.note ?? '').trim()

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

      {tasks.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: openTasks.length ? 'var(--accent)' : '#22C55E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {openTasks.length ? `${openTasks.length} assigned task${openTasks.length > 1 ? 's' : ''}` : 'All assigned tasks done'}
          </div>
          {tasks.slice(0, 3).map(task => (
            <div key={task.id} style={{
              fontSize: 12,
              color: task.completed ? 'var(--text-muted)' : 'var(--text)',
              textDecoration: task.completed ? 'line-through' : 'none',
              lineHeight: 1.35,
            }}>
              {task.completed ? '✓' : '•'} {task.body}
            </div>
          ))}
          {tasks.length > 3 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              +{tasks.length - 3} more
            </div>
          )}
        </div>
      )}

      {note && (
        <div style={{ marginTop: tasks.length > 0 ? 10 : 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.18)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Job note
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
            {note}
          </div>
        </div>
      )}
    </button>
  )
}
