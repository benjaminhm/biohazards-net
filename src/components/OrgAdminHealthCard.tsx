'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from '@/lib/userContext'
import type { CompanyProfile } from '@/lib/types'

const LS_PREFIX = 'bh_org_admin_health_dismissed:'

type Person = {
  id: string
  name: string
  role?: string | null
  status?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
}

type Check = {
  id: string
  label: string
  ok: boolean
  href: string
}

export default function OrgAdminHealthCard() {
  const { isAdmin, isManager, name, org_id, loading: userLoading } = useUser()
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [hidden, setHidden] = useState(false)

  const canSee = isAdmin || isManager

  useEffect(() => {
    if (userLoading || !canSee) return
    setLoading(true)
    Promise.all([
      fetch('/api/company').then(r => r.json()).catch(() => ({ company: null })),
      fetch('/api/people').then(r => r.json()).catch(() => ({ people: [] })),
    ])
      .then(([c, p]) => {
        setCompany(c.company ?? null)
        setPeople(p.people ?? [])
      })
      .finally(() => setLoading(false))
  }, [userLoading, canSee])

  const checks = useMemo(() => {
    const orgChecks: Check[] = [
      { id: 'org-name', label: 'Company name', ok: !!company?.name?.trim(), href: '/settings' },
      { id: 'org-phone', label: 'Company phone', ok: !!company?.phone?.trim(), href: '/settings' },
      { id: 'org-email', label: 'Company email', ok: !!company?.email?.trim(), href: '/settings' },
      { id: 'org-abn', label: 'Company ABN', ok: !!company?.abn?.trim(), href: '/settings' },
      { id: 'org-address', label: 'Company address', ok: !!company?.address?.trim(), href: '/settings' },
      { id: 'org-logo', label: 'Company logo', ok: !!company?.logo_url?.trim(), href: '/settings' },
    ]

    const leadership = people.filter(p => p.status !== 'archived' && ['admin', 'owner', 'manager'].includes((p.role ?? '').toLowerCase()))
    const leadershipChecks: Check[] = [
      { id: 'leaders-exist', label: 'At least one administrator/manager profile', ok: leadership.length > 0, href: '/team' },
      { id: 'leaders-phone', label: 'Leadership phone numbers complete', ok: leadership.length > 0 && leadership.every(p => !!p.phone?.trim()), href: '/team' },
      { id: 'leaders-email', label: 'Leadership emails complete', ok: leadership.length > 0 && leadership.every(p => !!p.email?.trim()), href: '/team' },
      { id: 'leaders-address', label: 'Leadership addresses complete', ok: leadership.length > 0 && leadership.every(p => !!p.address?.trim()), href: '/team' },
    ]

    const activePeople = people.filter(p => p.status !== 'archived')
    const teamChecks: Check[] = [
      { id: 'team-has-member', label: 'At least one active team profile', ok: activePeople.length > 0, href: '/team' },
    ]

    return [...orgChecks, ...leadershipChecks, ...teamChecks]
  }, [company, people])

  const done = checks.filter(c => c.ok).length
  const total = checks.length
  const missing = checks.filter(c => !c.ok)
  const signature = `${org_id ?? 'none'}:${missing.map(m => m.id).sort().join(',')}`

  useEffect(() => {
    if (!org_id) return
    const dismissed = localStorage.getItem(`${LS_PREFIX}${org_id}`)
    setHidden(dismissed === signature)
  }, [org_id, signature])

  if (userLoading || loading || !canSee || hidden) return null
  if (total === 0) return null

  const allDone = done === total
  const roleLabel = isAdmin ? 'Administrator' : 'Manager'
  const firstName = (name || '').trim().split(' ')[0] || roleLabel
  const nextStep = missing[0] ?? null
  const completed = checks.filter(c => c.ok)

  return (
    <div style={{ padding: '0 20px 10px' }}>
      <div style={{
        background: allDone ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.08)',
        border: `1px solid ${allDone ? 'rgba(34,197,94,0.22)' : 'rgba(245,158,11,0.22)'}`,
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', textAlign: 'left', padding: 0, flex: 1 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 28, height: 28, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: '#111',
                background: allDone ? '#22C55E' : '#F59E0B',
              }}>
                {done}/{total}
              </span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                Welcome {firstName}, let&apos;s get setup
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {allDone ? 'Setup complete. Keep details current for smoother operations.' : `Step ${done + 1} of ${total}`}
            </div>
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!allDone && (
              <button
                type="button"
                onClick={() => {
                  if (!org_id) return
                  localStorage.setItem(`${LS_PREFIX}${org_id}`, signature)
                  setHidden(true)
                }}
                style={{
                  padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>

        {expanded && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextStep && (
              <Link href={nextStep.href} style={{ textDecoration: 'none' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px',
                  borderRadius: 10, border: '1px solid rgba(245,158,11,0.3)',
                  background: 'rgba(245,158,11,0.08)',
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: 99, flexShrink: 0,
                    border: '2px solid #F59E0B', color: '#F59E0B',
                    fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {done + 1}
                  </span>
                  <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700, flex: 1 }}>
                    {nextStep.label}
                  </span>
                  <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>Add →</span>
                </div>
              </Link>
            )}

            {completed.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>
                  Completed
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {completed.map(check => (
                    <div key={check.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                      borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(34,197,94,0.05)',
                    }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 99, flexShrink: 0,
                        border: '2px solid #22C55E', background: '#22C55E', color: '#fff', fontSize: 11, fontWeight: 800,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>✓</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>{check.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
