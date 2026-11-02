'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'

interface SignInPerson {
  id: string
  name: string
  email: string | null
  phone_sign_in: boolean
  app_role: string | null
}

function isDeskRole(role: string | null) {
  return role === 'admin' || role === 'owner' || role === 'manager' || role === 'team_lead'
}

export default function TechniciansPage() {
  const [people, setPeople] = useState<SignInPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingId, setPendingId] = useState('')

  function load() {
    setLoading(true)
    fetch('/api/records/sign-in')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Could not load people.')
        setPeople(data.people ?? [])
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load people.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function addPerson(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/records/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not add that person.')
      setName('')
      setEmail('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that person.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(person: SignInPerson) {
    setPendingId(person.id)
    setError('')
    try {
      const res = await fetch('/api/records/sign-in', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: person.id, enabled: !person.phone_sign_in }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not update phone sign-in.')
      if (data.person) setPeople(prev => prev.map(row => row.id === data.person.id ? data.person : row))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update phone sign-in.')
    } finally {
      setPendingId('')
    }
  }

  async function archive(person: SignInPerson) {
    if (!window.confirm(`Archive ${person.name}? They will not be deleted.`)) return
    setPendingId(person.id)
    setError('')
    try {
      const res = await fetch('/api/records/sign-in', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: person.id, archive: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not archive that person.')
      setPeople(prev => prev.filter(row => row.id !== person.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive that person.')
    } finally {
      setPendingId('')
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 32 }}>
      <ScreenBar title="Technicians" sub="Phone sign-in" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <form onSubmit={addPerson} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" style={fieldStyle} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" aria-label="Email" type="email" style={fieldStyle} />
          <button type="submit" disabled={saving} style={bigButton}>{saving ? 'Adding…' : 'Add technician'}</button>
        </form>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {loading && <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading…</p>}
        {people.map(person => {
          const desk = isDeskRole(person.app_role)
          return (
            <div key={person.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{person.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{person.email || 'No email'}</div>
              </div>
              {desk ? <div style={{ fontWeight: 700, color: 'var(--text-muted)' }}>Desk</div> : (
                <>
                  <button type="button" disabled={pendingId === person.id || !person.email} onClick={() => toggle(person)} style={{ minHeight: 48, minWidth: 72, borderRadius: 12, border: 'none', background: person.phone_sign_in ? '#10B981' : 'var(--surface-2)', color: person.phone_sign_in ? '#fff' : 'var(--text)', fontWeight: 800 }}>
                    {person.phone_sign_in ? 'On' : 'Off'}
                  </button>
                  <button type="button" disabled={pendingId === person.id} onClick={() => archive(person)} style={{ minHeight: 48, borderRadius: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 700 }}>
                    Archive
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
