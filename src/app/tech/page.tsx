'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { pendingCount } from '@/lib/photoQueue'

interface TechJob {
  id: string
  job_number: string
  address: string
  job_type_label: string
  status: string
  today: boolean
}

export default function TechHomePage() {
  const [name, setName] = useState('')
  const [jobs, setJobs] = useState<TechJob[]>([])
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')

  function load() {
    fetch('/api/me').then(res => res.json()).then(data => setName(data.name ?? '')).catch(() => {})
    fetch('/api/tech/jobs')
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load jobs.')
        setJobs(data.jobs ?? [])
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load jobs.'))
    pendingCount().then(setPending).catch(() => {})
  }

  useEffect(() => {
    load()
    const onFlush = () => load()
    window.addEventListener('fcq-photos-flushed', onFlush)
    return () => window.removeEventListener('fcq-photos-flushed', onFlush)
  }, [])

  function signOut() {
    fetch('/api/auth/sign-out', { method: 'POST' }).finally(() => window.location.assign('/login'))
  }

  return (
    <main style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', padding: '24px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>My jobs</p>
      <h1 style={{ margin: 0, fontSize: 32 }}>{name || 'Technician'}</h1>
      {pending > 0 && <p style={{ margin: 0, fontWeight: 800 }}>{pending} upload{pending === 1 ? '' : 's'} pending</p>}
      {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
      {jobs.length === 0 && !error && <p style={{ color: 'var(--text-muted)' }}>No jobs assigned.</p>}
      {jobs.map(job => (
        <Link key={job.id} href={`/tech/jobs/${job.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, minHeight: 88 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{job.today ? 'Today · ' : ''}{job.job_number}</div>
            <div style={{ marginTop: 4 }}>{job.address}</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{job.job_type_label} · {job.status.replace('_', ' ')}</div>
          </div>
        </Link>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Link href="/tech/timesheet" style={nav}>Timesheet</Link>
        <Link href="/tech/bonus" style={nav}>Bonus</Link>
      </div>
      <button type="button" onClick={signOut} style={{ ...nav, background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' }}>Sign out</button>
    </main>
  )
}

const nav = {
  flex: 1,
  minHeight: 56,
  borderRadius: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontWeight: 800,
  textDecoration: 'none',
  border: 'none',
  fontSize: 16,
} as const
