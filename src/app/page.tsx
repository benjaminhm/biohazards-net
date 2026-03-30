'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CompanyProfile } from '@/lib/types'

export default function HomePage() {
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [time, setTime] = useState('')
  const router = useRouter()

  async function signOut() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
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
    {
      href: '/jobs/queue',
      icon: '📋',
      label: 'Job Queue',
      sub: 'All active jobs',
      color: '#FF6B35',
    },
    {
      href: '/jobs/new',
      icon: '➕',
      label: 'New Job',
      sub: 'Log a job manually',
      color: '#3B82F6',
    },
    {
      href: '/new-client',
      icon: '👤',
      label: 'New Client',
      sub: 'Client intake form',
      color: '#8B5CF6',
    },
    {
      href: '/intake-send',
      icon: '📤',
      label: 'Send Intake Link',
      sub: 'Text or email a client',
      color: '#14B8A6',
    },
    {
      href: '/settings',
      icon: '⚙️',
      label: 'Settings',
      sub: 'Company profile',
      color: '#666666',
    },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '32px 20px 24px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          marginBottom: 6,
        }}>
          {name}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>Dashboard</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24, fontWeight: 300, color: 'var(--text-muted)', letterSpacing: '-0.02em' }}>
              {time}
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 12,
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Tiles */}
      <div style={{
        flex: 1,
        padding: '24px 16px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        alignContent: 'start',
      }}>
        {/* Job Queue — full width */}
        <Link href={tiles[0].href} style={{ gridColumn: '1 / -1', textDecoration: 'none' }}>
          <div style={{
            background: 'var(--surface)',
            border: `1px solid var(--border)`,
            borderLeft: `4px solid ${tiles[0].color}`,
            borderRadius: 14,
            padding: '20px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            cursor: 'pointer',
          }}>
            <div style={{ fontSize: 32 }}>{tiles[0].icon}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{tiles[0].label}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{tiles[0].sub}</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 20, color: 'var(--text-muted)' }}>›</div>
          </div>
        </Link>

        {/* Remaining tiles — 2 column grid */}
        {tiles.slice(1).map((tile) => (
          <Link key={tile.href} href={tile.href} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--surface)',
              border: `1px solid var(--border)`,
              borderTop: `3px solid ${tile.color}`,
              borderRadius: 14,
              padding: '18px 16px',
              cursor: 'pointer',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{ fontSize: 28 }}>{tile.icon}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{tile.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{tile.sub}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid var(--border)',
        textAlign: 'center',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}>
        biohazards.net
      </div>
    </div>
  )
}
