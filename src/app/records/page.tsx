'use client'

import Link from 'next/link'
import { ScreenBar } from '@/components/records/ScreenBar'

const LINKS = [
  { href: '/records/jobs', label: 'Jobs', sub: 'Create a job and assign it' },
  { href: '/records/templates', label: 'Templates', sub: 'Steps for each job type' },
  { href: '/records/chemicals', label: 'Chemicals', sub: 'Name and dwell time' },
  { href: '/records/technicians', label: 'Technicians', sub: 'Who can sign in on the phone' },
  { href: '/records/rates', label: 'Rates', sub: 'Bonus amounts' },
  { href: '/records/exports', label: 'Exports', sub: 'Timesheets and bonus statements' },
]

export default function RecordsHomePage() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      <ScreenBar title="Job Records" back="/" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {LINKS.map(link => (
          <Link key={link.href} href={link.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '18px 16px',
              minHeight: 72,
            }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{link.label}</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>{link.sub}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
