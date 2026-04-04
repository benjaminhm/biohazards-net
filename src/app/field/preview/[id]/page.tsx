/*
 * app/field/preview/[id]/page.tsx
 *
 * Admin-only permanent preview URL — renders exactly what a team member sees
 * on their field page, using their real saved caps and assigned jobs.
 *
 * URL: /field/preview/[person_id]
 * Open in a separate window alongside the Access tab. Save caps → Refresh here.
 */
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import type { TeamCapabilities, Job } from '@/lib/types'
import { DEFAULT_MEMBER_CAPABILITIES, DEFAULT_MANAGER_CAPABILITIES } from '@/lib/types'
import DetailsTab from '@/components/tabs/DetailsTab'

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene', hoarding: 'Hoarding', mold: 'Mould',
  sewage: 'Sewage', trauma: 'Trauma', unattended_death: 'Unattended Death',
  flood: 'Flood', other: 'Other',
}
const URGENCY_COLOR: Record<string, string> = {
  standard: '#60A5FA', urgent: '#F59E0B', emergency: '#EF4444',
}
const ACTIVE_STATUSES = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway']

interface Person { id: string; name: string }

function fmtSchedule(iso: string) {
  const d        = new Date(iso)
  const today    = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const isToday  = d.toDateString() === today.toDateString()
  const day      = isToday ? 'Today'
    : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
    : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return { label: `${day}  ·  ${time}`, isToday }
}

export default function FieldPreviewPage() {
  const { id: personId } = useParams() as { id: string }
  const router = useRouter()
  const { isAdmin, loading: userLoading } = useUser()

  // ── All state/hooks at top — no early returns before this point ──────────────
  const [person,      setPerson]      = useState<Person | null>(null)
  const [caps,        setCaps]        = useState<TeamCapabilities>(DEFAULT_MEMBER_CAPABILITIES)
  const [role,        setRole]        = useState<'admin' | 'manager' | 'member'>('member')
  const [jobs,        setJobs]        = useState<Job[]>([])
  const [loading,     setLoading]     = useState(true)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [activeTab,   setActiveTab]   = useState('details')

  // Guard — admins only
  useEffect(() => {
    if (!userLoading && !isAdmin) router.replace('/')
  }, [userLoading, isAdmin, router])

  // Load person caps + assigned jobs
  useEffect(() => {
    if (userLoading || !isAdmin) return
    setLoading(true)
    Promise.all([
      fetch(`/api/people/${personId}`).then(r => r.json()),
      fetch(`/api/people/${personId}/access`).then(r => r.json()),
      fetch(`/api/jobs?preview_person_id=${personId}`).then(r => r.json()),
    ]).then(([personData, accessData, jobsData]) => {
      if (personData.person) setPerson(personData.person)
      const access = accessData.access
      if (access) {
        const r = access.role as 'admin' | 'manager' | 'member'
        setRole(r)
        const base = r === 'manager' ? DEFAULT_MANAGER_CAPABILITIES : DEFAULT_MEMBER_CAPABILITIES
        setCaps({ ...base, ...(access.capabilities ?? {}) })
      }
      const allJobs: Job[] = jobsData.jobs ?? []
      setJobs(allJobs.filter((j: Job) => ACTIVE_STATUSES.includes(j.status)))
    }).finally(() => setLoading(false))
  }, [personId, userLoading, isAdmin])

  // Reset to Details tab whenever a different job is opened
  useEffect(() => { setActiveTab('details') }, [selectedJob?.id])

  // ── Derived values (no hooks below this line) ────────────────────────────────
  const isReadOnly = role !== 'admin' && !caps.edit_job_details
  const todayStr   = new Date().toDateString()
  const todayJobs  = jobs.filter(j => j.scheduled_at && new Date(j.scheduled_at).toDateString() === todayStr)
  const otherJobs  = jobs.filter(j => !j.scheduled_at || new Date(j.scheduled_at).toDateString() !== todayStr)
  const firstName  = (person?.name ?? '').split(' ')[0] || 'Member'

  const visibleTabs = [
    { id: 'details',    label: 'Details',    show: true },
    { id: 'assessment', label: 'Assessment', show: caps.view_assessment },
    { id: 'quote',      label: 'Quote',      show: caps.view_quote },
    { id: 'photos',     label: 'Photos',     show: caps.upload_photos_assigned || caps.upload_photos_any },
    { id: 'documents',  label: 'Docs',       show: caps.generate_documents },
    { id: 'messages',   label: '💬 SMS',     show: caps.send_sms },
  ].filter(t => t.show)

  // ── Conditional renders (after all hooks) ────────────────────────────────────
  if (userLoading || loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span className="spinner" />
      </div>
    )
  }

  if (!person) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Person not found.
      </div>
    )
  }

  // ── Job detail view ──────────────────────────────────────────────────────────
  if (selectedJob) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 40 }}>
        <PreviewBanner name={person.name} role={role} onBack={() => setSelectedJob(null)} backLabel="← Jobs" />

        {/* Job header + tab bar */}
        <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '12px 16px 0', position: 'sticky', top: 48, zIndex: 9 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
            {isReadOnly
              ? `${JOB_TYPE_LABELS[selectedJob.job_type] ?? selectedJob.job_type} · ${selectedJob.site_address.split(',')[0]}`
              : `${selectedJob.client_name} — ${JOB_TYPE_LABELS[selectedJob.job_type] ?? selectedJob.job_type}`}
          </div>
          <div style={{ display: 'flex', overflowX: 'auto', marginLeft: -16, marginRight: -16, paddingLeft: 16 }}>
            {visibleTabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                flexShrink: 0, padding: '8px 14px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: `2px solid ${activeTab === t.id ? 'var(--accent)' : 'transparent'}`,
                background: 'none', border: 'none', cursor: 'pointer',
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>
          {activeTab === 'details' ? (
            <DetailsTab job={selectedJob} onJobUpdate={() => {}} readOnly={isReadOnly} />
          ) : (
            <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>
                {activeTab === 'assessment' ? '📋' : activeTab === 'quote' ? '💰' : activeTab === 'photos' ? '📷' : activeTab === 'documents' ? '📄' : '💬'}
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} tab
              </div>
              <div style={{ fontSize: 13 }}>Visible to {firstName} with current permissions.</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Job list view ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 48 }}>
      <PreviewBanner name={person.name} role={role} onBack={() => router.push(`/team/${personId}`)} backLabel="← Profile" />

      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Biohazard Cleaning
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 4 }}>Hi {firstName}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {todayJobs.length > 0 ? `${todayJobs.length} job${todayJobs.length > 1 ? 's' : ''} scheduled for today` : 'No jobs scheduled today'}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 700,
            background: role === 'admin' ? 'rgba(255,107,53,0.12)' : role === 'manager' ? 'rgba(139,92,246,0.12)' : 'rgba(96,165,250,0.12)',
            color: role === 'admin' ? '#FF6B35' : role === 'manager' ? '#8B5CF6' : '#60A5FA',
          }}>
            {role === 'admin' ? '🛡 Administrator' : role === 'manager' ? '🗂 Manager' : '👷 Team Member'}
          </span>
          {!caps.view_all_jobs && (
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 700, background: 'rgba(100,100,100,0.08)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              Assigned jobs only
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '20px 16px' }}>
        {jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 44, marginBottom: 16, opacity: 0.5 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>No active jobs</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {caps.view_all_jobs ? 'No active jobs in the org.' : `No active jobs assigned to ${firstName}.`}
            </div>
          </div>
        )}

        {todayJobs.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Today</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {todayJobs.map(j => <PreviewJobCard key={j.id} job={j} onClick={() => setSelectedJob(j)} highlight />)}
            </div>
          </section>
        )}

        {otherJobs.length > 0 && (
          <section>
            {todayJobs.length > 0 && (
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, marginTop: 4 }}>Active Jobs</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {otherJobs.map(j => <PreviewJobCard key={j.id} job={j} onClick={() => setSelectedJob(j)} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PreviewBanner({ name, role, onBack, backLabel }: {
  name: string; role: string; onBack: () => void; backLabel: string
}) {
  const roleColor = role === 'admin' ? '#FF6B35' : role === 'manager' ? '#8B5CF6' : '#60A5FA'
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 20,
      background: '#0f0f0f', color: '#fff', borderBottom: `2px solid ${roleColor}`,
      padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>
          {backLabel}
        </button>
        <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>👁 Previewing <span style={{ color: roleColor }}>{name}</span></span>
      </div>
      <button onClick={() => window.location.reload()} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer' }}>
        ↻ Refresh
      </button>
    </div>
  )
}

function PreviewJobCard({ job, onClick, highlight }: { job: Job; onClick: () => void; highlight?: boolean }) {
  const urgencyColor = URGENCY_COLOR[job.urgency] ?? '#60A5FA'
  const schedule = job.scheduled_at ? fmtSchedule(job.scheduled_at) : null
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left',
      background: highlight ? 'var(--surface-2)' : 'var(--surface)',
      border: `1px solid ${highlight ? 'rgba(255,107,53,0.2)' : 'var(--border)'}`,
      borderLeft: `4px solid ${urgencyColor}`,
      borderRadius: 14, padding: '16px 16px 14px',
      cursor: 'pointer', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</div>
        <div style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: `${urgencyColor}18`, color: urgencyColor }}>
          {job.urgency}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: schedule ? 8 : 0 }}>
        {job.site_address}
      </div>
      {schedule && (
        <div style={{ fontSize: 13, fontWeight: 700, color: schedule.isToday ? 'var(--accent)' : 'var(--text-muted)' }}>
          {schedule.label}
        </div>
      )}
    </button>
  )
}
