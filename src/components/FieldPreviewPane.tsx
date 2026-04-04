/*
 * components/FieldPreviewPane.tsx
 *
 * Live phone-frame preview for the admin Access tab. Renders a simulated
 * field worker experience driven directly from the form's live caps state —
 * no page reload, no localStorage, no switching devices.
 *
 * Shows the person's actual assigned jobs in a mobile frame. Tapping a job
 * drills into the detail view using the same DetailsTab (readOnly) used by
 * real field workers. The visible tabs update instantly as the admin toggles
 * capabilities in the form beside it.
 *
 * AI briefing is suppressed (skipBriefing) — no cost from clicking around.
 * The frame scrolls independently of the admin form.
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import type { TeamCapabilities } from '@/lib/types'
import type { Job } from '@/lib/types'
import DetailsTab from '@/components/tabs/DetailsTab'

interface Props {
  personId: string
  personName: string
  caps: TeamCapabilities
  role: 'admin' | 'manager' | 'member'
}

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene', hoarding: 'Hoarding', mold: 'Mould',
  sewage: 'Sewage', trauma: 'Trauma', unattended_death: 'Unattended Death',
  flood: 'Flood', other: 'Other',
}
const URGENCY_COLOR: Record<string, string> = {
  standard: '#60A5FA', urgent: '#F59E0B', emergency: '#EF4444',
}
const ACTIVE_STATUSES = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway']

type Screen = { view: 'list' } | { view: 'job'; job: Job }

export default function FieldPreviewPane({ personId, personName, caps, role }: Props) {
  const [jobs, setJobs]         = useState<Job[]>([])
  const [loading, setLoading]   = useState(true)
  const [screen, setScreen]     = useState<Screen>({ view: 'list' })

  const fetchJobs = useCallback(() => {
    setLoading(true)
    fetch(`/api/jobs?preview_person_id=${personId}`)
      .then(r => r.json())
      .then(d => setJobs((d.jobs ?? []).filter((j: Job) => ACTIVE_STATUSES.includes(j.status))))
      .finally(() => setLoading(false))
  }, [personId])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const isReadOnly = role !== 'admin' && !caps.edit_job_details

  // Which tabs would this person see on a job detail?
  const visibleTabs = [
    { id: 'details',    label: 'Details',    show: true },
    { id: 'assessment', label: 'Assessment', show: caps.view_assessment },
    { id: 'quote',      label: 'Quote',      show: caps.view_quote },
    { id: 'photos',     label: 'Photos',     show: caps.upload_photos_assigned || caps.upload_photos_any },
    { id: 'docs',       label: 'Docs',       show: caps.generate_documents },
    { id: 'sms',        label: '💬 SMS',     show: caps.send_sms },
  ].filter(t => t.show)

  const firstName = personName.split(' ')[0] || personName

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        Live Preview — {personName}
      </div>

      {/* Phone frame */}
      <div style={{
        width: 320,
        height: 620,
        borderRadius: 36,
        border: '8px solid #1a1a1a',
        boxShadow: '0 0 0 1px #333, 0 24px 60px rgba(0,0,0,0.5)',
        background: 'var(--bg)',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Notch */}
        <div style={{
          height: 28, background: '#1a1a1a', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 80, height: 10, borderRadius: 8, background: '#333' }} />
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {screen.view === 'list' ? (
            <ListScreen
              jobs={jobs}
              loading={loading}
              firstName={firstName}
              caps={caps}
              onSelect={job => setScreen({ view: 'job', job })}
            />
          ) : (
            <JobScreen
              job={screen.job}
              isReadOnly={isReadOnly}
              visibleTabs={visibleTabs}
              onBack={() => setScreen({ view: 'list' })}
            />
          )}
        </div>

        {/* Home indicator */}
        <div style={{
          height: 20, background: 'var(--bg)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 100, height: 4, borderRadius: 4, background: 'var(--border)' }} />
        </div>
      </div>

      {/* Caps summary below frame */}
      <div style={{ marginTop: 14, width: 320 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Visible tabs on job
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {visibleTabs.map(t => (
            <span key={t.id} style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
              background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.25)',
            }}>{t.label}</span>
          ))}
          {['details', 'assessment', 'quote', 'photos', 'docs', 'sms'].filter(id => !visibleTabs.find(t => t.id === id)).map(id => (
            <span key={id} style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
              background: 'rgba(100,100,100,0.08)', color: 'var(--text-muted)', border: '1px solid var(--border)',
              textDecoration: 'line-through',
            }}>{id}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── List screen ──────────────────────────────────────────────────────────────

function ListScreen({ jobs, loading, firstName, caps, onSelect }: {
  jobs: Job[]
  loading: boolean
  firstName: string
  caps: TeamCapabilities
  onSelect: (job: Job) => void
}) {
  const todayStr  = new Date().toDateString()
  const todayJobs = jobs.filter(j => j.scheduled_at && new Date(j.scheduled_at).toDateString() === todayStr)
  const otherJobs = jobs.filter(j => !j.scheduled_at || new Date(j.scheduled_at).toDateString() !== todayStr)

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Biohazard Cleaning
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Hi {firstName}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {loading ? 'Loading…' : todayJobs.length > 0
            ? `${todayJobs.length} job${todayJobs.length > 1 ? 's' : ''} today`
            : 'No jobs today'}
        </div>
        {!caps.view_all_jobs && (
          <div style={{ marginTop: 8, fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(96,165,250,0.12)', color: '#60A5FA', display: 'inline-block', fontWeight: 700 }}>
            Assigned jobs only
          </div>
        )}
      </div>

      <div style={{ padding: '16px 12px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)', fontSize: 13 }}>Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>No active jobs</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {caps.view_all_jobs ? 'No active jobs in the org.' : `No jobs assigned to ${firstName} yet.`}
            </div>
          </div>
        ) : (
          <>
            {todayJobs.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Today</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {todayJobs.map(j => <MiniJobCard key={j.id} job={j} onClick={() => onSelect(j)} highlight />)}
                </div>
              </div>
            )}
            {otherJobs.length > 0 && (
              <div>
                {todayJobs.length > 0 && <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 4 }}>Active Jobs</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {otherJobs.map(j => <MiniJobCard key={j.id} job={j} onClick={() => onSelect(j)} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MiniJobCard({ job, onClick, highlight }: { job: Job; onClick: () => void; highlight?: boolean }) {
  const urgencyColor = URGENCY_COLOR[job.urgency] ?? '#60A5FA'
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left',
      background: highlight ? 'var(--surface-2)' : 'var(--surface)',
      border: `1px solid ${highlight ? 'rgba(255,107,53,0.2)' : 'var(--border)'}`,
      borderLeft: `3px solid ${urgencyColor}`,
      borderRadius: 10, padding: '12px 12px 10px',
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</div>
        <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: `${urgencyColor}18`, color: urgencyColor }}>
          {job.urgency}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{job.site_address}</div>
      {job.scheduled_at && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginTop: 5 }}>
          {new Date(job.scheduled_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </button>
  )
}

// ── Job detail screen ────────────────────────────────────────────────────────

function JobScreen({ job, isReadOnly, visibleTabs, onBack }: {
  job: Job
  isReadOnly: boolean
  visibleTabs: { id: string; label: string }[]
  onBack: () => void
}) {
  const [activeTab, setActiveTab] = useState('details')

  // Reset to details if active tab gets hidden by a cap change
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === activeTab)) setActiveTab('details')
  }, [visibleTabs, activeTab])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mini header */}
      <div style={{
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '10px 12px 0', position: 'sticky', top: 0, zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button onClick={onBack} style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, lineHeight: 1 }}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isReadOnly
                ? `${JOB_TYPE_LABELS[job.job_type] ?? job.job_type} · ${job.site_address.split(',')[0]}`
                : `${job.client_name} — ${JOB_TYPE_LABELS[job.job_type] ?? job.job_type}`}
            </div>
          </div>
        </div>
        {/* Tab bar */}
        <div style={{ display: 'flex', overflowX: 'auto', gap: 0, marginLeft: -12, marginRight: -12, paddingLeft: 12 }}>
          {visibleTabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flexShrink: 0, padding: '6px 10px', fontSize: 10, fontWeight: 700,
              color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'none', border: 'none', borderBottomStyle: 'solid',
              borderBottomWidth: 2,
              borderBottomColor: activeTab === t.id ? 'var(--accent)' : 'transparent',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
        {activeTab === 'details' && (
          <DetailsTab
            job={job}
            onJobUpdate={() => {}}
            readOnly={isReadOnly}
            skipBriefing
          />
        )}
        {activeTab !== 'details' && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>
              {activeTab === 'assessment' ? '📋' : activeTab === 'quote' ? '💰' : activeTab === 'photos' ? '📷' : activeTab === 'docs' ? '📄' : '💬'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} tab
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Visible with current permissions
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
