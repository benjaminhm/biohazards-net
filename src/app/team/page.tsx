'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface PersonDoc { id: string; doc_type: string; label: string; expiry_date?: string }
interface Person {
  id: string; name: string; email?: string; phone?: string
  role: string; status: string; people_documents?: PersonDoc[]
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function certStatus(docs: PersonDoc[]) {
  if (!docs || docs.length === 0) return 'none'
  const now = new Date(); const soon = new Date(); soon.setDate(now.getDate() + 30)
  let expired = false, expiring = false
  for (const d of docs) {
    if (!d.expiry_date) continue
    const exp = new Date(d.expiry_date)
    if (exp < now) expired = true
    else if (exp < soon) expiring = true
  }
  if (expired) return 'expired'
  if (expiring) return 'expiring'
  return 'ok'
}

const AVATAR_COLORS = ['#FF6B35','#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#06B6D4']

export default function TeamPage() {
  const router = useRouter()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', role: 'employee' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/people').then(r => r.json()).then(d => { setPeople(d.people ?? []); setLoading(false) })
  }, [])

  async function createProfile() {
    if (!form.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.person) {
      setPeople(p => [...p, { ...data.person, people_documents: [] }])
      setShowCreate(false)
      setForm({ name: '', phone: '', email: '', role: 'employee' })
      router.push(`/team/${data.person.id}`)
    }
    setSaving(false)
  }

  const active   = people.filter(p => p.status === 'active')
  const inactive = people.filter(p => p.status !== 'active')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>

      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={() => router.push('/')} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Team</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{active.length} active</div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          + Create Profile
        </button>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px' }}>

        {loading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 60 }}>Loading…</div>}

        {!loading && people.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>No team members yet</div>
            <div style={{ fontSize: 13, marginBottom: 24 }}>Create a profile for each employee or subcontractor. Once created, open the profile to invite them into the app.</div>
            <button onClick={() => setShowCreate(true)} style={{ padding: '12px 24px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              + Create First Profile
            </button>
          </div>
        )}

        {/* Active */}
        {active.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {active.map((p, i) => {
              const cs = certStatus(p.people_documents ?? [])
              const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length]
              return (
                <div key={p.id} onClick={() => router.push(`/team/${p.id}`)}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                    {initials(p.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.phone || p.email || 'No contact info'}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    {cs === 'expired'  && <span title="Certificate expired"  style={{ fontSize: 18 }}>🔴</span>}
                    {cs === 'expiring' && <span title="Certificate expiring" style={{ fontSize: 18 }}>🟡</span>}
                    {cs === 'ok'       && <span title="All certs valid"      style={{ fontSize: 18 }}>🟢</span>}
                    {cs === 'none'     && <span title="No documents"         style={{ fontSize: 18 }}>⚪</span>}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>›</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Inactive */}
        {inactive.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Inactive</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inactive.map((p, i) => (
                <div key={p.id} onClick={() => router.push(`/team/${p.id}`)}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', opacity: 0.6 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {initials(p.name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.phone || p.email || 'No contact info'}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Inactive ›</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create profile modal */}
      {showCreate && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px 44px', width: '100%', maxWidth: 500 }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Create Profile</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Add their name and contact details. You can invite them into the app from their profile once created.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name *"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') createProfile() }}
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 15, width: '100%', boxSizing: 'border-box' }}
              />
              <input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Phone"
                type="tel"
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 15, width: '100%', boxSizing: 'border-box' }}
              />
              <input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Email"
                type="email"
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 15, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowCreate(false)}
                style={{ flex: 1, padding: '13px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={createProfile} disabled={saving || !form.name.trim()}
                style={{ flex: 2, padding: '13px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: saving || !form.name.trim() ? 0.5 : 1 }}>
                {saving ? 'Creating…' : 'Create & Open Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
