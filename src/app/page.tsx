/*
 * app/page.tsx
 *
 * Dashboard / home page — the main job list for admins and members with
 * the view_all_jobs capability.
 *
 * Non-admins without view_all_jobs are redirected to /field (their personal
 * schedule view) immediately on load. This check runs client-side in a useEffect
 * so the redirect is smooth rather than causing a server-side 302 loop.
 *
 * Features:
 *   - Upcoming jobs section (next 7 days with scheduled_at set).
 *   - Full job list grouped by status (active first, closed at bottom).
 *   - Live clock (fmtBooking) that labels bookings as "Today"/"Tomorrow" for
 *     the field schedule section.
 *
 * Company profile is fetched to personalise the header with the business name.
 *
 * Quick Feedback can be hidden per user (localStorage) or disabled for the whole
 * org by platform admins (`orgs.features.show_quick_feedback === false`).
 * Knowledge Base appears in the tile grid when `orgs.features.training_education` is true (platform org toggle).
 * Job Manager is the first tile (same size as others); at ≥900px with 5+ tiles, grid is 3 columns.
 * When `website_card` is on, a Marketing Manager tile is added to the grid.
 * Inventory Manager is always visible (tracks equipment, tools, consumables & chemicals).
 * New jobs are created from inside Job Manager — there is no separate "New Job" tile.
 * Company settings open from the header cog (not a grid tile).
 * Platform operators see an optional collapsible list of all orgs
 * (GET /api/admin/orgs) when their Clerk user is in PLATFORM_ADMIN_CLERK_IDS.
 */
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { useUser } from '@/lib/userContext'
import type { CompanyProfile, Job } from '@/lib/types'
import OrgAdminHealthCard from '@/components/OrgAdminHealthCard'

const LS_HIDE_FEEDBACK = 'bh_dash_quick_feedback_hidden'
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
  const { caps, isAdmin, loading: userLoading, previewMode, org: ctxOrg } = useUser()
  const [actions, setActions] = useState<{
    type: string; title: string; description: string; href: string; severity: string
    person_id?: string; person_email?: string | null; person_phone?: string | null; missing?: string[]
  }[]>([])
  const [actionsExpanded, setActionsExpanded] = useState(true)
  const [nudgeSent, setNudgeSent] = useState<Record<string, 'sending' | 'sent' | 'error'>>({})
  const [review, setReview] = useState<object | null | 'loading'>('loading')
  const [hideQuickFeedback, setHideQuickFeedback] = useState(false)
  /** ≥900px: use 3 columns when we have 6 tiles (2×3 layout); otherwise 2 columns. */
  const [desktopWide, setDesktopWide] = useState(false)
  const router = useRouter()

  // Non-admins without view_all_jobs go to their field view
  useEffect(() => {
    if (!userLoading && !isAdmin && !caps.view_all_jobs) router.replace('/field')
  }, [userLoading, isAdmin, caps.view_all_jobs, router])

  useEffect(() => {
    try {
      setHideQuickFeedback(localStorage.getItem(LS_HIDE_FEEDBACK) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const sync = () => setDesktopWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
      .catch(() => {})

    // Fetch admin action items (incomplete profiles, expiring certs etc)
    fetch('/api/admin/actions')
      .then(r => r.json())
      .then(d => setActions(d.actions ?? []))
      .catch(() => {})

    fetch('/api/review')
      .then(r => r.json())
      .then(d => setReview(d.review ?? null))
      .catch(() => setReview(null))

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

  async function sendNudge(action: typeof actions[0]) {
    if (!action.person_id) return
    setNudgeSent(s => ({ ...s, [action.person_id!]: 'sending' }))
    try {
      const res = await fetch('/api/admin/actions/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: action.person_id, type: action.type, missing: action.missing }),
      })
      setNudgeSent(s => ({ ...s, [action.person_id!]: res.ok ? 'sent' : 'error' }))
    } catch {
      setNudgeSent(s => ({ ...s, [action.person_id!]: 'error' }))
    }
  }

  const name = company?.name || ctxOrg?.name || 'Company'

  /** Org-level switch from /api/me — when false, Quick Feedback is not shown on this tenant's home. */
  const homeQuickFeedbackAllowed =
    !userLoading && ctxOrg != null && ctxOrg.features?.show_quick_feedback !== false

  /** Same flag as platform org “Training & education” — when false, Knowledge Base tile is not shown on home. */
  const trainingPortalEnabled =
    !userLoading && ctxOrg != null && ctxOrg.features?.training_education === true

  /** Platform org Marketing Manager toggle — tile on home only when true (default off). */
  const websiteCardEnabled =
    !userLoading && ctxOrg != null && ctxOrg.features?.website_card === true

  const dashboardGridTiles = [
    {
      href: '/jobs/queue',
      icon: '📋',
      label: 'Job Manager',
      sub: 'All active jobs — track, update, dispatch',
      color: 'var(--accent)',
    },
    {
      href: '/team',
      icon: '⬡',
      label: 'Team Manager',
      sub: 'Staff & contractors',
      color: '#10B981',
    },
    {
      href: '/inventory',
      icon: '📦',
      label: 'Inventory Manager',
      sub: 'Equipment, tools, consumables & chemicals',
      color: '#3B82F6',
    },
    ...(trainingPortalEnabled
      ? [{
          href: '/training',
          icon: '📖',
          label: 'Knowledge Base',
          sub: 'Courses & resources',
          color: '#F59E0B',
        }]
      : []),
    ...(websiteCardEnabled
      ? [{
          href: '/website',
          icon: '🌐',
          label: 'Marketing Manager',
          sub: 'Public site & marketing',
          color: '#06B6D4',
        }]
      : []),
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
            <Link
              href="/settings"
              title="Company settings"
              aria-label="Company settings"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, flexShrink: 0, borderRadius: 8,
                border: '1px solid var(--border-2)',
                color: 'var(--text-muted)', fontSize: 18, lineHeight: 1,
                textDecoration: 'none', transition: 'background 0.12s, border-color 0.12s, color 0.12s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--surface-2)'
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'var(--border-2)'
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              ⚙
            </Link>
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

      <OrgAdminHealthCard />

      {/* ── Action Required ── admin only, shown when there are items ── */}
      {isAdmin && !previewMode && actions.length > 0 && (
        <div style={{ padding: '0 20px 4px' }}>
          <div style={{
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 16, overflow: 'hidden',
          }}>
            {/* Header */}
            <button
              onClick={() => setActionsExpanded(e => !e)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '14px 18px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text)', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  background: '#EF4444', color: '#fff',
                  borderRadius: 99, fontSize: 11, fontWeight: 800,
                  padding: '2px 8px', lineHeight: 1.5,
                }}>
                  {actions.length}
                </span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Action Required</span>
              </div>
              <span style={{
                fontSize: 12, color: 'var(--text-dim)',
                display: 'inline-block',
                transform: actionsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
              }}>▲</span>
            </button>

            {/* Items */}
            {actionsExpanded && (
              <div style={{ borderTop: '1px solid rgba(239,68,68,0.15)' }}>
                {actions.map((a, i) => {
                  const nudgeState = a.person_id ? nudgeSent[a.person_id] : undefined
                  const canNudge = a.person_id && (a.person_email || a.person_phone)
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 18px',
                      borderBottom: i < actions.length - 1 ? '1px solid rgba(239,68,68,0.1)' : 'none',
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: 99, flexShrink: 0,
                        background: a.severity === 'high' ? '#EF4444' : '#F59E0B',
                      }} />
                      <Link href={a.href} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                          {a.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                          {a.description}
                        </div>
                      </Link>
                      {canNudge && (
                        nudgeState === 'sent' ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#4ADE80', flexShrink: 0 }}>
                            ✓ Sent
                          </span>
                        ) : (
                          <button
                            onClick={() => sendNudge(a)}
                            disabled={nudgeState === 'sending'}
                            title={`Send reminder via ${a.person_email ? 'email' : 'SMS'}`}
                            style={{
                              flexShrink: 0,
                              padding: '5px 10px', borderRadius: 6,
                              border: '1px solid rgba(239,68,68,0.3)',
                              background: 'rgba(239,68,68,0.06)',
                              color: nudgeState === 'error' ? '#EF4444' : '#F87171',
                              fontSize: 11, fontWeight: 700, cursor: 'pointer',
                              opacity: nudgeState === 'sending' ? 0.6 : 1,
                            }}
                          >
                            {nudgeState === 'sending' ? '…' : nudgeState === 'error' ? 'Failed' : `${a.person_email ? '✉' : '💬'} Remind`}
                          </button>
                        )
                      )}
                      {!canNudge && (
                        <span style={{ fontSize: 16, color: 'var(--text-dim)', flexShrink: 0 }}>›</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Dashboard tiles — Job / Team / Inventory (+ Knowledge Base + Marketing Manager when enabled); 3 cols on wide desktop when 5+ tiles ── */}
      <div style={{
        flex: 1,
        padding: '12px 20px 20px',
        display: 'grid',
        gridTemplateColumns:
          desktopWide && dashboardGridTiles.length >= 5
            ? 'repeat(3, minmax(0, 1fr))'
            : 'repeat(2, minmax(0, 1fr))',
        gap: 10,
        alignContent: 'start',
      }}>
        {dashboardGridTiles.map(tile => (
          <Link key={tile.href} href={tile.href} style={{ textDecoration: 'none', minWidth: 0 }}>
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '18px 16px 16px',
              height: '100%',
              minHeight: 108,
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
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: 2, background: tile.color, opacity: 0.7,
              }} />
              <div style={{ fontSize: 22, marginTop: 4 }}>{tile.icon}</div>
              <div style={{ flex: 1 }}>
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

      {/* ── Quick Feedback — admin only; org can disable via platform; hideable per user ── */}
      {homeQuickFeedbackAllowed && isAdmin && !previewMode && review === null && (
        <div style={{ padding: '0 20px 20px' }}>
          {hideQuickFeedback ? (
            <button
              type="button"
              onClick={() => {
                setHideQuickFeedback(false)
                try {
                  localStorage.removeItem(LS_HIDE_FEEDBACK)
                } catch {
                  /* ignore */
                }
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px dashed var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Show Quick Feedback
            </button>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="eyebrow" style={{ color: 'var(--text-dim)' }}>Quick Feedback</span>
                <button
                  type="button"
                  onClick={() => {
                    setHideQuickFeedback(true)
                    try {
                      localStorage.setItem(LS_HIDE_FEEDBACK, '1')
                    } catch {
                      /* ignore */
                    }
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-muted)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Hide
                </button>
              </div>
              <ReviewCard onSubmitted={() => setReview({})} />
            </div>
          )}
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
    </div>
  )
}

/* ── ReviewCard ── */
function ReviewCard({ onSubmitted }: { onSubmitted: () => void }) {
  const [rating, setRating]     = useState(0)
  const [hovered, setHovered]   = useState(0)
  const [body, setBody]         = useState('')
  const [name, setName]         = useState('')
  const [saving, setSaving]     = useState(false)
  const [done, setDone]         = useState(false)

  async function handleSubmit() {
    if (!rating) return
    setSaving(true)
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, body, reviewer_name: name }),
      })
      if (!res.ok) return
      setDone(true)
      setTimeout(onSubmitted, 1200)
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div style={{
        background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
        borderRadius: 16, padding: '22px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🙏</div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Thanks for the feedback!</div>
      </div>
    )
  }

  const display = hovered || rating

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: '20px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
        Quick Feedback
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>How is biohazards.net working for you?</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.5 }}>
        Takes 30 seconds. Your feedback helps us improve the platform.
      </div>

      {/* Stars */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[1, 2, 3, 4, 5].map(s => (
          <button
            key={s}
            onMouseEnter={() => setHovered(s)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => setRating(s)}
            style={{
              fontSize: 28, background: 'none', border: 'none', cursor: 'pointer',
              padding: '2px 4px', lineHeight: 1,
              filter: s <= display ? 'none' : 'grayscale(1) opacity(0.3)',
              transform: s <= display ? 'scale(1.1)' : 'scale(1)',
              transition: 'transform 0.1s, filter 0.1s',
            }}
          >
            ⭐
          </button>
        ))}
        {rating > 0 && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>
            {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][rating]}
          </span>
        )}
      </div>

      {/* Optional text */}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Any comments? (optional)"
        rows={2}
        style={{
          width: '100%', marginBottom: 10,
          padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--text)', fontSize: 13,
          resize: 'none', boxSizing: 'border-box',
        }}
      />
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Your name (optional)"
        style={{
          width: '100%', marginBottom: 14,
          padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--text)', fontSize: 13,
          boxSizing: 'border-box',
        }}
      />

      <button
        onClick={handleSubmit}
        disabled={!rating || saving}
        style={{
          width: '100%', padding: '13px',
          borderRadius: 12, border: 'none',
          background: rating ? 'var(--accent)' : 'var(--surface-3)',
          color: rating ? '#fff' : 'var(--text-dim)',
          fontWeight: 700, fontSize: 14, cursor: rating ? 'pointer' : 'default',
          opacity: saving ? 0.7 : 1,
          transition: 'background 0.2s',
        }}
      >
        {saving ? 'Saving…' : 'Submit Review'}
      </button>
    </div>
  )
}
