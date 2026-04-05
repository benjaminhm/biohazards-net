/*
 * components/OnboardingChecklist.tsx
 *
 * Sticky onboarding banner for team members. Sits at the top of the field
 * page until all required fields are complete.
 *
 * Two tiers:
 *   REQUIRED (red → green): phone, address, email
 *     — these must be done but don't block app usage
 *   RECOMMENDED (amber): emergency contact, ABN (subcontractors only)
 *     — shown below required until filled, then disappear
 *
 * Behaviour:
 *   - Any required field missing → red banner
 *   - Required done, recommended pending → amber banner
 *   - Everything done → green "Complete" pill, disappears after 3s
 *   - Tapping any incomplete item → bottom-sheet edit form
 *   - 'Save to phone' → shows iOS/Android instructions, self-marked done (localStorage)
 *   - Hidden entirely if no person_id linked (admin without team profile)
 */
'use client'

import { useEffect, useState } from 'react'

interface Person {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  abn: string | null
  emergency_contact: string | null
  emergency_phone: string | null
  role: string
}

interface EditState {
  phone: string
  email: string
  address: string
  abn: string
  emergency_contact: string
  emergency_phone: string
}

export default function OnboardingChecklist() {
  const [person, setPerson]       = useState<Person | null>(null)
  const [loading, setLoading]     = useState(true)
  const [appSaved, setAppSaved]   = useState(false)
  const [expanded, setExpanded]   = useState(true)
  const [editOpen, setEditOpen]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [gone, setGone]           = useState(false)

  const [edit, setEdit] = useState<EditState>({
    phone: '', email: '', address: '', abn: '',
    emergency_contact: '', emergency_phone: '',
  })

  useEffect(() => {
    setAppSaved(localStorage.getItem('app_saved_to_phone') === '1')
    fetch('/api/me/profile')
      .then(r => r.json())
      .then(d => {
        if (d.person) {
          setPerson(d.person)
          setEdit({
            phone:             d.person.phone             ?? '',
            email:             d.person.email             ?? '',
            address:           d.person.address           ?? '',
            abn:               d.person.abn               ?? '',
            emergency_contact: d.person.emergency_contact ?? '',
            emergency_phone:   d.person.emergency_phone   ?? '',
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading || !person || gone) return null

  const isSubcontractor = person.role === 'subcontractor'

  // Required — must complete, banner is red until done
  const required = [
    { key: 'app',     label: 'Save app to your phone', ok: appSaved },
    { key: 'phone',   label: 'Mobile number',          ok: !!person.phone?.trim() },
    { key: 'address', label: 'Home address',           ok: !!person.address?.trim() },
    { key: 'email',   label: 'Email address',          ok: !!person.email?.trim() },
  ]

  // Recommended — amber nudge after required done
  const recommended = [
    { key: 'emergency', label: 'Emergency contact', ok: !!person.emergency_contact?.trim() && !!person.emergency_phone?.trim() },
    ...(isSubcontractor ? [{ key: 'abn', label: 'ABN', ok: !!person.abn?.trim() }] : []),
  ]

  const requiredDone     = required.every(c => c.ok)
  const recommendedDone  = recommended.every(c => c.ok)
  const allDone          = requiredDone && recommendedDone

  // All done — brief green flash then disappear
  if (allDone) {
    setTimeout(() => setGone(true), 3000)
  }

  const bannerColor = allDone ? '#14532D'
    : requiredDone ? '#78350F'   // amber bg
    : '#1a0a0a'                  // red bg

  const accentColor = allDone ? '#22C55E'
    : requiredDone ? '#F59E0B'
    : '#EF4444'

  const visibleItems = requiredDone
    ? (allDone ? [] : recommended.filter(c => !c.ok))
    : required

  const statusText = allDone
    ? 'Profile complete — you\'re all set!'
    : requiredDone
      ? `Almost done — ${recommended.filter(c => !c.ok).length} recommended field${recommended.filter(c => !c.ok).length > 1 ? 's' : ''} remaining`
      : `${required.filter(c => !c.ok).length} required field${required.filter(c => !c.ok).length > 1 ? 's' : ''} to complete`

  async function saveProfile() {
    setSaving(true)
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      })
      const d = await res.json()
      if (!res.ok) {
        alert(typeof d.error === 'string' ? d.error : 'Could not save')
        return
      }
      if (d.person) {
        setPerson(d.person)
        setEdit({
          phone:             d.person.phone             ?? '',
          email:             d.person.email             ?? '',
          address:           d.person.address           ?? '',
          abn:               d.person.abn               ?? '',
          emergency_contact: d.person.emergency_contact ?? '',
          emergency_phone:   d.person.emergency_phone   ?? '',
        })
        setEditOpen(false)
      }
    } finally { setSaving(false) }
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
        background: bannerColor,
        borderBottom: `2px solid ${accentColor}`,
        transition: 'background 0.4s, border-color 0.4s',
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
              fontSize: 12, fontWeight: 800, color: allDone ? '#fff' : '#000',
              flexShrink: 0, transition: 'background 0.4s',
            }}>
              {allDone ? '✓' : required.filter(c => c.ok).length + '/' + required.length}
            </div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{statusText}</span>
          </div>
          {!allDone && (
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.4)',
              display: 'inline-block',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}>▲</span>
          )}
        </button>

        {/* Checklist items — show all, green when done, red/amber when not */}
        {expanded && !allDone && (
          <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(requiredDone ? recommended : required).map(c => (
              <button
                key={c.key}
                onClick={() => {
                  if (c.ok) return
                  if (c.key === 'app') { setShowInstructions(true); return }
                  setEditOpen(true)
                }}
                disabled={c.ok}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: c.ok
                    ? 'rgba(34,197,94,0.08)'
                    : `rgba(${requiredDone ? '245,158,11' : '239,68,68'},0.08)`,
                  border: `1px solid ${c.ok
                    ? 'rgba(34,197,94,0.25)'
                    : `rgba(${requiredDone ? '245,158,11' : '239,68,68'},0.25)`}`,
                  cursor: c.ok ? 'default' : 'pointer',
                  textAlign: 'left', width: '100%',
                }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: 99, flexShrink: 0,
                  background: c.ok ? '#22C55E' : 'transparent',
                  border: `2px solid ${c.ok ? '#22C55E' : accentColor}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#fff', fontWeight: 800,
                }}>
                  {c.ok ? '✓' : ''}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: c.ok ? 'rgba(255,255,255,0.5)' : '#fff' }}>
                  {c.label}
                </span>
                {!c.ok && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: accentColor, fontWeight: 700 }}>
                    Tap →
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit modal (bottom sheet) ── */}
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
              Kept private — used for team records only.
            </div>

            {[
              { label: 'Mobile number',           key: 'phone',             type: 'tel',  placeholder: '04XX XXX XXX' },
              { label: 'Email address',           key: 'email',             type: 'email', placeholder: 'you@example.com' },
              { label: 'Home address',             key: 'address',           type: 'text', placeholder: '123 Example St, Brisbane QLD 4000' },
              { label: 'Emergency contact name',   key: 'emergency_contact', type: 'text', placeholder: 'Jane Smith' },
              { label: 'Emergency contact phone',  key: 'emergency_phone',   type: 'tel',  placeholder: '04XX XXX XXX' },
              ...(isSubcontractor ? [{ label: 'ABN', key: 'abn', type: 'text', placeholder: '12 345 678 901' }] : []),
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {f.label}
                </label>
                <input
                  type={f.type}
                  value={edit[f.key as keyof EditState]}
                  onChange={e => setEdit(p => ({ ...p, [f.key]: e.target.value }))}
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
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ── Save to phone instructions ── */}
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
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                1. Tap the <strong style={{ color: 'var(--text)' }}>Share</strong> button at the bottom of Safari<br />
                2. Tap <strong style={{ color: 'var(--text)' }}>Add to Home Screen</strong><br />
                3. Tap <strong style={{ color: 'var(--text)' }}>Add</strong>
              </div>
            </div>
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--accent)' }}>Android (Chrome)</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                1. Tap the <strong style={{ color: 'var(--text)' }}>⋮ menu</strong> top right<br />
                2. Tap <strong style={{ color: 'var(--text)' }}>Add to Home screen</strong><br />
                3. Tap <strong style={{ color: 'var(--text)' }}>Add</strong>
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
