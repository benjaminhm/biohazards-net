/*
 * components/OnboardingChecklist.tsx
 *
 * Sticky onboarding checklist shown to team members until their profile
 * is fully complete. Sits at the top of the field page and the dashboard.
 *
 * Items:
 *   1. Save app to phone   — self-marked, stored in localStorage (device-specific)
 *   2. Phone number        — from their people record
 *   3. Home address        — from their people record
 *   4. Emergency contact   — emergency_contact + emergency_phone
 *   5. ABN                 — only required if role === 'subcontractor'
 *
 * When all items are green the checklist collapses to a small green
 * "Profile complete" pill and disappears after 3 seconds.
 *
 * Tapping an incomplete item opens an inline edit modal so they can
 * fill the field without navigating away.
 *
 * The checklist is not shown if person_id is null (admin without a
 * linked team profile — they don't need to complete this).
 */
'use client'

import { useEffect, useState } from 'react'

interface Person {
  id: string
  name: string
  phone: string | null
  address: string | null
  abn: string | null
  emergency_contact: string | null
  emergency_phone: string | null
  role: string
}

interface EditState {
  phone: string
  address: string
  abn: string
  emergency_contact: string
  emergency_phone: string
}

export default function OnboardingChecklist() {
  const [person, setPerson]         = useState<Person | null>(null)
  const [loading, setLoading]       = useState(true)
  const [appSaved, setAppSaved]     = useState(false)
  const [expanded, setExpanded]     = useState(true)
  const [editOpen, setEditOpen]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)

  const [edit, setEdit] = useState<EditState>({
    phone: '', address: '', abn: '',
    emergency_contact: '', emergency_phone: '',
  })

  useEffect(() => {
    // Check localStorage for app-saved flag (device-specific)
    setAppSaved(localStorage.getItem('app_saved_to_phone') === '1')

    fetch('/api/me/profile')
      .then(r => r.json())
      .then(d => {
        if (d.person) {
          setPerson(d.person)
          setEdit({
            phone:             d.person.phone             ?? '',
            address:           d.person.address           ?? '',
            abn:               d.person.abn               ?? '',
            emergency_contact: d.person.emergency_contact ?? '',
            emergency_phone:   d.person.emergency_phone   ?? '',
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  // No linked profile — admin without a people record, skip checklist
  if (!person) return null

  const isSubcontractor = person.role === 'subcontractor'

  const checks = [
    { key: 'app',       label: 'Save app to your phone',  ok: appSaved },
    { key: 'phone',     label: 'Mobile number',           ok: !!person.phone?.trim() },
    { key: 'address',   label: 'Home address',            ok: !!person.address?.trim() },
    { key: 'emergency', label: 'Emergency contact',       ok: !!person.emergency_contact?.trim() && !!person.emergency_phone?.trim() },
    ...(isSubcontractor ? [{ key: 'abn', label: 'ABN', ok: !!person.abn?.trim() }] : []),
  ]

  const doneCount = checks.filter(c => c.ok).length
  const allDone   = doneCount === checks.length

  // Once complete, show green pill briefly then hide
  if (allDone && !expanded) return null

  const accentColor = allDone ? '#22C55E' : '#EF4444'

  async function saveProfile() {
    setSaving(true)
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      })
      const d = await res.json()
      if (d.person) {
        setPerson(d.person)
        setEditOpen(false)
      }
    } finally {
      setSaving(false) }
  }

  function markAppSaved() {
    localStorage.setItem('app_saved_to_phone', '1')
    setAppSaved(true)
    setShowInstructions(false)
  }

  return (
    <>
      {/* ── Sticky banner ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: allDone ? '#14532D' : '#1a0a0a',
        borderBottom: `2px solid ${accentColor}`,
        transition: 'background 0.3s, border-color 0.3s',
      }}>
        {/* Header row */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', padding: '12px 20px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#fff', textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 99,
              background: accentColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0,
              transition: 'background 0.3s',
            }}>
              {allDone ? '✓' : `${doneCount}/${checks.length}`}
            </div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {allDone ? 'Profile complete — you\'re all set!' : 'Complete your setup'}
            </span>
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▲
          </span>
        </button>

        {/* Checklist items */}
        {expanded && !allDone && (
          <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checks.map(c => (
              <button
                key={c.key}
                onClick={() => {
                  if (c.key === 'app') { setShowInstructions(true); return }
                  setEditOpen(true)
                }}
                disabled={c.ok}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: c.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${c.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  cursor: c.ok ? 'default' : 'pointer',
                  textAlign: 'left', width: '100%',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 99, flexShrink: 0,
                  background: c.ok ? '#22C55E' : 'transparent',
                  border: `2px solid ${c.ok ? '#22C55E' : '#EF4444'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#fff', fontWeight: 800,
                }}>
                  {c.ok ? '✓' : ''}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: c.ok ? 'rgba(255,255,255,0.5)' : '#fff' }}>
                  {c.label}
                </span>
                {!c.ok && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#EF4444', fontWeight: 700 }}>
                    Tap to complete →
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit profile modal ── */}
      {editOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setEditOpen(false)}
        >
          <div
            style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: 28, width: '100%', maxHeight: '85dvh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Complete Your Profile</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              This information is kept private and used for team records only.
            </div>

            {[
              { label: 'Mobile number', key: 'phone', type: 'tel', placeholder: '04XX XXX XXX' },
              { label: 'Home address', key: 'address', type: 'text', placeholder: '123 Example St, Brisbane QLD 4000' },
              { label: 'Emergency contact name', key: 'emergency_contact', type: 'text', placeholder: 'Jane Smith' },
              { label: 'Emergency contact phone', key: 'emergency_phone', type: 'tel', placeholder: '04XX XXX XXX' },
              ...(isSubcontractor ? [{ label: 'ABN', key: 'abn', type: 'text', placeholder: '12 345 678 901' }] : []),
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {f.label}
                </label>
                <input
                  type={f.type}
                  value={edit[f.key as keyof EditState]}
                  onChange={e => setEdit(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 15, boxSizing: 'border-box' }}
                />
              </div>
            ))}

            <button
              onClick={saveProfile}
              disabled={saving}
              style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer', marginTop: 8, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </div>
      )}

      {/* ── Add to home screen instructions ── */}
      {showInstructions && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setShowInstructions(false)}
        >
          <div
            style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: 28, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 20 }}>Save App to Your Phone</div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--accent)' }}>iPhone (Safari)</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                1. Tap the <strong style={{ color: 'var(--text)' }}>Share</strong> button (box with arrow) at the bottom of Safari<br />
                2. Scroll down and tap <strong style={{ color: 'var(--text)' }}>Add to Home Screen</strong><br />
                3. Tap <strong style={{ color: 'var(--text)' }}>Add</strong> — done
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--accent)' }}>Android (Chrome)</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                1. Tap the <strong style={{ color: 'var(--text)' }}>⋮ menu</strong> (top right)<br />
                2. Tap <strong style={{ color: 'var(--text)' }}>Add to Home screen</strong><br />
                3. Tap <strong style={{ color: 'var(--text)' }}>Add</strong> — done
              </div>
            </div>

            <button
              onClick={markAppSaved}
              style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: '#22C55E', color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}
            >
              ✓ Done — I&apos;ve saved it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
