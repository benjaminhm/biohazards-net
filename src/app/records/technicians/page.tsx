'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'

interface SignInPerson {
  id: string
  name: string
  email: string | null
  phone_sign_in: boolean
  app_role: string | null
  photo_pin: string | null
  person_code: string
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
  const [pinDrafts, setPinDrafts] = useState<Record<string, string>>({})

  function load() {
    setLoading(true)
    fetch('/api/records/sign-in')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Could not load people.')
        const list: SignInPerson[] = data.people ?? []
        setPeople(list)
        setPinDrafts(Object.fromEntries(list.map(p => [p.id, p.photo_pin ?? ''])))
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

  async function savePin(person: SignInPerson, nextPin: string) {
    setPendingId(person.id)
    setError('')
    try {
      const res = await fetch('/api/records/sign-in', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: person.id, photo_pin: nextPin.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not save PIN.')
      if (data.person) {
        setPeople(prev => prev.map(row => row.id === data.person.id ? data.person : row))
        setPinDrafts(prev => ({ ...prev, [person.id]: data.person.photo_pin ?? '' }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save PIN.')
    } finally {
      setPendingId('')
    }
  }

  function randomPin(): string {
    const used = new Set(people.map(p => p.photo_pin).filter(Boolean))
    for (let i = 0; i < 40; i++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000))
      if (!used.has(candidate)) return candidate
    }
    return String(Math.floor(1000 + Math.random() * 9000))
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
      <ScreenBar title="Technicians" sub="Phone sign-in & Photo PINs" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <form onSubmit={addPerson} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" style={fieldStyle} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" aria-label="Email" type="email" style={fieldStyle} />
          <button type="submit" disabled={saving} style={bigButton}>{saving ? 'Adding…' : 'Add technician'}</button>
        </form>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Each person’s 4-digit Photo PIN identifies them on <strong>photo.forensiccleaningqld.com.au</strong> (or <strong>/photo</strong>) and stamps their User ID onto every photo.
        </p>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {loading && <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading…</p>}
        {people.map(person => {
          const desk = isDeskRole(person.app_role)
          const draftPin = pinDrafts[person.id] ?? person.photo_pin ?? ''
          const pinChanged = draftPin !== (person.photo_pin ?? '')
          return (
            <div key={person.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>
                    {person.name}{' '}
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      ({person.person_code})
                    </span>
                  </div>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Photo PIN
                </span>
                <input
                  value={draftPin}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                    setPinDrafts(prev => ({ ...prev, [person.id]: digits }))
                  }}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="4 digits"
                  aria-label={`Photo PIN for ${person.name}`}
                  style={{
                    width: 96,
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontFamily: 'monospace',
                    fontSize: 16,
                    fontWeight: 800,
                    letterSpacing: '0.15em',
                    textAlign: 'center',
                  }}
                />
                {pinChanged && (
                  <button
                    type="button"
                    disabled={pendingId === person.id}
                    onClick={() => void savePin(person, draftPin)}
                    style={{ minHeight: 38, padding: '0 14px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                  >
                    Save PIN
                  </button>
                )}
                <button
                  type="button"
                  disabled={pendingId === person.id}
                  onClick={() => {
                    const next = randomPin()
                    setPinDrafts(prev => ({ ...prev, [person.id]: next }))
                    void savePin(person, next)
                  }}
                  style={{ minHeight: 38, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  Generate
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
