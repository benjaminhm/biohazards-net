'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { useUser } from '@/lib/userContext'
import type { CompanyProfile, Job, TeamCapabilities } from '@/lib/types'
import { DEFAULT_MEMBER_CAPABILITIES } from '@/lib/types'

function fmtBooking(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const isToday    = d.toDateString() === today.toDateString()
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow'
    : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return { dayLabel, time, isToday, isTomorrow }
}

export default function HomePage() {
  const [company, setCompany]   = useState<CompanyProfile | null>(null)
  const [time, setTime]         = useState('')
  const [upcoming, setUpcoming] = useState<Job[]>([])
  const { signOut } = useClerk()
  const { caps, isAdmin, loading: userLoading, previewMode } = useUser()
  const [showPreviewPicker, setShowPreviewPicker] = useState(false)
  const router = useRouter()

  // Non-admins without view_all_jobs go to their field view
  useEffect(() => {
    if (!userLoading && !isAdmin && !caps.view_all_jobs) router.replace('/field')
  }, [userLoading, isAdmin, caps.view_all_jobs, router])

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
      .catch(() => {})

    fetch('/api/jobs?upcoming=true')
      .then(r => r.json())
      .then(d => setUpcoming(d.jobs ?? []))
      .catch(() => {})

    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [])

  const name = company?.name || 'Brisbane Biohazard Cleaning'

  const tiles = [
    { href: '/jobs/new',    icon: '＋', label: 'New Job',         sub: 'Log manually',       color: '#3B82F6' },
    { href: '/team',        icon: '⬡',  label: 'Team',            sub: 'Staff & contractors', color: '#10B981' },
    { href: '/new-client',  icon: '◎',  label: 'New Client',      sub: 'Intake form',        color: '#8B5CF6' },
    { href: '/intake-send', icon: '↗',  label: 'Send Intake',     sub: 'Text or email',      color: '#14B8A6' },
    { href: '/settings',    icon: '◈',  label: 'Settings',        sub: 'Company profile',    color: '#555' },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <header style={{ padding: '28px 20px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>
                {name}
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
                background: isAdmin ? 'rgba(255,107,53,0.15)' : 'rgba(255,255,255,0.08)',
                color: isAdmin ? 'var(--accent)' : 'var(--text-muted)',
                border: `1px solid ${isAdmin ? 'rgba(255,107,53,0.3)' : 'var(--border)'}`,
              }}>
                {isAdmin ? 'Administrator' : 'Team Member'}
              </span>
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
              Dashboard
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
            <span className="num" style={{ fontSize: 20, fontWeight: 300, color: 'var(--text-muted)', letterSpacing: '-0.02em' }}>
              {time}
            </span>
            {isAdmin && !previewMode && (
              <button
                onClick={() => setShowPreviewPicker(true)}
                title="Preview as team member"
                style={{
                  width: 34, height: 34, borderRadius: 8,
                  border: '1px solid var(--border-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-muted)', fontSize: 14,
                  transition: 'all 0.12s', background: 'none', cursor: 'pointer',
                }}
              >
                👁
              </button>
            )}
            <button
              onClick={() => signOut({ redirectUrl: '/login' })}
              style={{
                height: 34, padding: '0 12px', borderRadius: 8,
                border: '1px solid var(--border-2)',
                color: 'var(--text-muted)', fontSize: 12, fontWeight: 500,
                transition: 'all 0.12s',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Job Queue — Hero tile ── */}
      <div style={{ padding: '0 20px 4px' }}>
        <Link href="/jobs/queue" style={{ display: 'block' }}>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '22px 22px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            transition: 'border-color 0.15s, background 0.15s',
            position: 'relative',
            overflow: 'hidden',
          }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'
              ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
            }}
          >
            {/* Left accent line */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: 3, background: 'var(--accent)', borderRadius: '99px 0 0 99px',
            }} />
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: 'var(--accent-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0, marginLeft: 4,
            }}>
              📋
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em', marginBottom: 2 }}>
                Job Queue
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                All active jobs — track, update, dispatch
              </div>
            </div>
            <div style={{ fontSize: 22, color: 'var(--text-dim)', flexShrink: 0 }}>›</div>
          </div>
        </Link>
      </div>

      {/* ── Secondary tiles — 2 col grid ── */}
      <div style={{
        flex: 1,
        padding: '12px 20px 20px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        alignContent: 'start',
      }}>
        {tiles.map(tile => (
          <Link key={tile.href} href={tile.href} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '18px 16px 16px',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              transition: 'border-color 0.15s, background 0.15s',
              position: 'relative',
              overflow: 'hidden',
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'
                ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
              }}
            >
              {/* Top colour stripe */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: 2, background: tile.color, opacity: 0.7,
              }} />
              <div style={{ fontSize: 22, marginTop: 4 }}>{tile.icon}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', marginBottom: 2 }}>
                  {tile.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {tile.sub}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Upcoming Bookings ── */}
      {upcoming.length > 0 && (
        <div style={{ padding: '0 20px 28px' }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Upcoming Bookings
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map(job => {
              const { dayLabel, time: t, isToday } = fmtBooking(job.scheduled_at!)
              return (
                <Link key={job.id} href={`/jobs/${job.id}`}>
                  <div style={{
                    background: 'var(--surface)',
                    border: `1px solid ${isToday ? 'rgba(255,107,53,0.3)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                  }}>
                    <div style={{ textAlign: 'center', minWidth: 46, flexShrink: 0 }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700,
                        color: isToday ? 'var(--accent)' : 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2,
                      }}>
                        {dayLabel}
                      </div>
                      <div className="num" style={{ fontSize: 17, fontWeight: 700 }}>{t}</div>
                    </div>
                    <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.client_name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.site_address || job.job_type.replace(/_/g, ' ')}
                      </div>
                      {job.schedule_note && (
                        <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.schedule_note}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 16, color: 'var(--text-dim)', flexShrink: 0 }}>›</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'center',
      }}>
        <span className="eyebrow" style={{ opacity: 0.35 }}>biohazards.net</span>
      </div>

      {/* ── Preview Picker Modal ── */}
      {showPreviewPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px 48px', width: '100%', maxWidth: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>👁 Preview as Team Member</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              Temporarily view the app with a team member&apos;s capabilities. You remain an Administrator — exit preview to restore full access.
            </div>

            {([
              {
                label: 'Default Team Member',
                sub: 'Upload photos to assigned jobs only. No financial or doc access.',
                caps: DEFAULT_MEMBER_CAPABILITIES,
              },
              {
                label: 'Field + Assessment',
                sub: 'View all jobs, upload photos, view and edit assessment.',
                caps: { ...DEFAULT_MEMBER_CAPABILITIES, view_all_jobs: true, view_assessment: true, edit_assessment: true, use_smartfill: true, upload_photos_any: true } as TeamCapabilities,
              },
              {
                label: 'Senior Team Member',
                sub: 'Most access except admin settings and financial data.',
                caps: { ...DEFAULT_MEMBER_CAPABILITIES, view_all_jobs: true, create_jobs: true, edit_job_details: true, change_job_status: true, view_assessment: true, edit_assessment: true, use_smartfill: true, generate_documents: true, edit_documents: true, send_documents: true, upload_photos_assigned: true, upload_photos_any: true, view_team_profiles: true, send_sms: true } as TeamCapabilities,
              },
            ] as { label: string; sub: string; caps: TeamCapabilities }[]).map(preset => (
              <button
                key={preset.label}
                onClick={() => {
                  localStorage.setItem('preview_caps', JSON.stringify(preset.caps))
                  window.location.reload()
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '13px 14px', borderRadius: 10, marginBottom: 8,
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{preset.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{preset.sub}</div>
              </button>
            ))}

            <button
              onClick={() => setShowPreviewPicker(false)}
              style={{ width: '100%', marginTop: 8, padding: '13px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
