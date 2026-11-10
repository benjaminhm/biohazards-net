/*
 * components/photoApp/CaptureSignIn.tsx
 *
 * PIN and job-code steps shared by the PIN capture apps on photo.biohazards.net
 * (bulk loader) and notes.biohazards.net (job notepad). Both use the same
 * session at /api/photo/bulk/session and job lookup at /api/photo/bulk/job.
 */
'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export interface CapturePerson { person_id: string; name: string; person_code: string }
export interface CaptureJob { id: string; job_code: string; client_name: string; site_address: string }

/** Who is signed in, checked once on load. */
export function useCaptureSession() {
  const [booting, setBooting] = useState(true)
  const [person, setPerson] = useState<CapturePerson | null>(null)

  useEffect(() => {
    fetch('/api/photo/bulk/session', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setPerson(d?.person ?? null))
      .catch(() => {})
      .finally(() => setBooting(false))
  }, [])

  async function signOut() {
    await fetch('/api/photo/bulk/session', { method: 'DELETE' }).catch(() => {})
    setPerson(null)
  }

  return { booting, person, setPerson, signOut }
}

export function Brand({ app, title, subtitle }: { app: string; title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF6B35' }}>
        {app}
      </div>
      <h1 style={{ margin: '4px 0 6px', fontSize: 26, fontWeight: 900 }}>{title}</h1>
      {subtitle && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{subtitle}</p>}
    </div>
  )
}

export function PinStep({ app, onSignedIn }: { app: string; onSignedIn: (p: CapturePerson) => void }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!/^\d{4}$/.test(pin) || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/photo/bulk/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = (await res.json().catch(() => ({}))) as { person?: CapturePerson; error?: string }
      if (!res.ok || !data.person) throw new Error(data.error ?? 'Could not sign in.')
      onSignedIn(data.person)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={captureShell}>
      <form
        onSubmit={e => { e.preventDefault(); void submit() }}
        style={{ ...captureColumn, maxWidth: 380 }}
      >
        <Brand app={app} title="Enter your PIN" subtitle="Your photo PIN, the same one used on the camera." />
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          aria-label="Photo PIN"
          style={{ ...bigInput, letterSpacing: '0.6em', textAlign: 'center' }}
        />
        {error && <div style={errorBox}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={pin.length !== 4 || busy} style={bigButton}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}

export function JobStep({ app, person, actionLabel, onJob, onSignOut }: {
  app: string
  person: CapturePerson
  actionLabel: string
  onJob: (j: CaptureJob) => void
  onSignOut: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<CaptureJob | null>(null)

  async function find() {
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    setFound(null)
    try {
      const res = await fetch(`/api/photo/bulk/job?code=${encodeURIComponent(code.trim())}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { job?: CaptureJob; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error ?? 'Job not found.')
      setFound(data.job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Job not found.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={captureShell}>
      <div style={{ ...captureColumn, maxWidth: 420 }}>
        <SignedInBar person={person} onSignOut={onSignOut} />
        <Brand app={app} title="Which job?" subtitle="Type the job code, e.g. 3456." />
        <form onSubmit={e => { e.preventDefault(); void find() }} style={{ display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase().slice(0, 32)); setFound(null) }}
            placeholder="Job code"
            aria-label="Job code"
            inputMode="numeric"
            style={{ ...bigInput, flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
          <button type="submit" className="btn btn-secondary" disabled={!code.trim() || busy} style={{ padding: '0 18px', fontWeight: 800 }}>
            {busy ? '…' : 'Find'}
          </button>
        </form>
        {error && <div style={errorBox}>{error}</div>}
        {found && (
          <div style={{ border: '2px solid #FF6B35', borderRadius: 14, padding: 14, background: 'var(--surface)', display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, color: '#FF6B35' }}>#{found.job_code}</div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{found.client_name || 'Unnamed client'}</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{found.site_address}</div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => onJob(found)} style={bigButton}>
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function SignedInBar({ person, onSignOut, children }: { person: CapturePerson; onSignOut: () => void; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, color: 'var(--text-muted)' }}>
      <span>Signed in as <strong style={{ color: 'var(--text)' }}>{person.name}</strong> ({person.person_code})</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {children}
        <button type="button" onClick={onSignOut} className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>Sign out</button>
      </span>
    </div>
  )
}

export const captureShell: CSSProperties = { minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }
export const captureColumn: CSSProperties = { width: '100%', margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }
const bigInput: CSSProperties = {
  width: '100%', height: 56, padding: '0 16px', borderRadius: 12, fontSize: 22, fontWeight: 800,
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
}
const bigButton: CSSProperties = { height: 52, fontSize: 16, fontWeight: 800, borderRadius: 12 }
const errorBox: CSSProperties = { padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 14 }
