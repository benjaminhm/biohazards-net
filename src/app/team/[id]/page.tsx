'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface PersonDoc {
  id: string
  doc_type: string
  label: string
  expiry_date?: string
  file_url?: string
}
interface Person {
  id: string
  name: string
  email?: string
  phone?: string
  role: string
  status: string
  notes?: string
  emergency_contact?: string
  emergency_phone?: string
  people_documents?: PersonDoc[]
}

const DOC_TYPES = [
  { value: 'whs_cert',   label: '🦺 WHS Certificate' },
  { value: 'induction',  label: '📋 Induction' },
  { value: 'nda',        label: '🔒 NDA' },
  { value: 'licence',    label: '🪪 Licence' },
  { value: 'first_aid',  label: '🩺 First Aid' },
  { value: 'other',      label: '📄 Other' },
]

function expiryColor(date?: string) {
  if (!date) return 'var(--text-muted)'
  const now = new Date(); const exp = new Date(date)
  const soon = new Date(); soon.setDate(now.getDate() + 30)
  if (exp < now) return '#EF4444'
  if (exp < soon) return '#F59E0B'
  return '#10B981'
}
function expiryLabel(date?: string) {
  if (!date) return 'No expiry'
  const exp = new Date(date)
  const now = new Date()
  if (exp < now) return `Expired ${exp.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const days = Math.ceil((exp.getTime() - now.getTime()) / 86400000)
  if (days <= 30) return `Expires in ${days} days`
  return exp.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = ['#FF6B35','#3B82F6','#8B5CF6','#10B981','#F59E0B']

export default function PersonPage() {
  const router = useRouter()
  const { id } = useParams() as { id: string }
  const [person, setPerson] = useState<Person | null>(null)
  const [tab, setTab] = useState<'profile' | 'docs' | 'jobs'>('profile')
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [docForm, setDocForm] = useState({ doc_type: 'whs_cert', label: '', expiry_date: '' })
  const [addingDoc, setAddingDoc] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/people/${id}`)
    const data = await res.json()
    if (data.person) setPerson(data.person)
  }, [id])

  useEffect(() => { load() }, [load])

  function updateField(key: keyof Person, val: string) {
    setPerson(p => p ? { ...p, [key]: val } : p)
  }

  async function save() {
    if (!person) return
    setSaving(true)
    const { id: _id, people_documents: _docs, ...fields } = person
    await fetch(`/api/people/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) })
    setSaving(false); setSaveOk(true); setTimeout(() => setSaveOk(false), 2000)
  }

  async function addDoc() {
    if (!docForm.label.trim()) return
    setAddingDoc(true)
    const res = await fetch(`/api/people/${id}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(docForm) })
    const data = await res.json()
    if (data.document) {
      setPerson(p => p ? { ...p, people_documents: [...(p.people_documents ?? []), data.document] } : p)
      setShowAddDoc(false); setDocForm({ doc_type: 'whs_cert', label: '', expiry_date: '' })
    }
    setAddingDoc(false)
  }

  async function deleteDoc(docId: string) {
    setPerson(p => p ? { ...p, people_documents: p.people_documents?.filter(d => d.id !== docId) } : p)
    await fetch(`/api/people/${id}/documents`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId }) })
  }

  async function deletePerson() {
    if (!confirm(`Delete ${person?.name}? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/people/${id}`, { method: 'DELETE' })
    router.push('/team')
  }

  if (!person) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Loading…
    </div>
  )

  const avatarColor = AVATAR_COLORS[person.name.charCodeAt(0) % AVATAR_COLORS.length]
  const docs = person.people_documents ?? []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>

      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={() => router.push('/team')} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{person.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{person.role}</div>
        </div>
        {saveOk && <span style={{ fontSize: 12, color: '#4ADE80' }}>✓ Saved</span>}
        <button onClick={save} disabled={saving} style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
          {saving ? '…' : '💾 Save'}
        </button>
      </div>

      {/* Avatar hero */}
      <div style={{ background: 'var(--surface)', padding: '24px 20px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 22, flexShrink: 0 }}>
          {initials(person.name)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{person.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{person.phone} {person.phone && person.email ? '·' : ''} {person.email}</div>
        </div>
        {/* Active toggle */}
        <button onClick={() => updateField('status', person.status === 'active' ? 'inactive' : 'active')}
          style={{ padding: '7px 14px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer',
            background: person.status === 'active' ? '#10B98120' : '#EF444420',
            color: person.status === 'active' ? '#10B981' : '#EF4444' }}>
          {person.status === 'active' ? '● Active' : '○ Inactive'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {(['profile','docs','jobs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '13px 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent' }}>
            {t === 'profile' ? '👤 Profile' : t === 'docs' ? `📋 Documents${docs.length ? ` (${docs.length})` : ''}` : '🔧 Jobs'}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px' }}>

        {/* ── Profile tab ── */}
        {tab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Full Name">
              <input value={person.name} onChange={e => updateField('name', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Role">
              <div style={{ display: 'flex', gap: 8 }}>
                {['employee','subcontractor'].map(r => (
                  <button key={r} onClick={() => updateField('role', r)}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${person.role === r ? 'var(--accent)' : 'var(--border)'}`, background: person.role === r ? 'var(--accent)' : 'var(--bg)', color: person.role === r ? '#fff' : 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    {r === 'employee' ? '👷 Employee' : '🔧 Subcontractor'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Phone">
              <input value={person.phone ?? ''} onChange={e => updateField('phone', e.target.value)} type="tel" style={inputStyle} />
            </Field>
            <Field label="Email">
              <input value={person.email ?? ''} onChange={e => updateField('email', e.target.value)} type="email" style={inputStyle} />
            </Field>
            <Field label="Emergency Contact">
              <input value={person.emergency_contact ?? ''} onChange={e => updateField('emergency_contact', e.target.value)} placeholder="Contact name" style={inputStyle} />
            </Field>
            <Field label="Emergency Phone">
              <input value={person.emergency_phone ?? ''} onChange={e => updateField('emergency_phone', e.target.value)} type="tel" style={inputStyle} />
            </Field>
            <Field label="Notes">
              <textarea value={person.notes ?? ''} onChange={e => updateField('notes', e.target.value)} rows={3}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>

            {/* Danger zone */}
            <div style={{ marginTop: 20, padding: '16px', borderRadius: 12, border: '1px solid #EF444440', background: '#EF444408' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#EF4444', marginBottom: 8 }}>Danger Zone</div>
              <button onClick={deletePerson} disabled={deleting}
                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #EF4444', background: 'none', color: '#EF4444', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : '🗑 Delete Profile'}
              </button>
            </div>
          </div>
        )}

        {/* ── Documents tab ── */}
        {tab === 'docs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button onClick={() => setShowAddDoc(true)}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                + Add Document
              </button>
            </div>

            {docs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>No documents yet</div>
                <div style={{ fontSize: 13 }}>Add WHS certificates, inductions, licences and more.</div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {docs.map(doc => {
                const color = expiryColor(doc.expiry_date)
                const typeLabel = DOC_TYPES.find(t => t.value === doc.doc_type)?.label ?? doc.doc_type
                return (
                  <div key={doc.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.label || typeLabel}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{typeLabel}</div>
                      <div style={{ fontSize: 12, color, marginTop: 4, fontWeight: 600 }}>{expiryLabel(doc.expiry_date)}</div>
                    </div>
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noreferrer"
                        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                        View
                      </a>
                    )}
                    <button onClick={() => deleteDoc(doc.id)}
                      style={{ padding: '6px 10px', borderRadius: 6, border: 'none', background: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 16 }}>
                      🗑
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Jobs tab ── */}
        {tab === 'jobs' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔧</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Job assignments</div>
            <div style={{ fontSize: 13 }}>Assign this person to jobs from the job detail page.</div>
          </div>
        )}
      </div>

      {/* Add document modal */}
      {showAddDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 500 }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>Add Document</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={docForm.doc_type} onChange={e => setDocForm(f => ({ ...f, doc_type: e.target.value }))}
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input value={docForm.label} onChange={e => setDocForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Label (e.g. Asbestos Awareness 2025) *"
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }} />
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Expiry date</label>
                <input type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))}
                  style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAddDoc(false)} style={{ flex: 1, padding: '13px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={addDoc} disabled={addingDoc || !docForm.label.trim()} style={{ flex: 2, padding: '13px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: addingDoc || !docForm.label.trim() ? 0.5 : 1 }}>
                {addingDoc ? 'Adding…' : 'Add Document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}
