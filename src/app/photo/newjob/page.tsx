/*
 * app/photo/newjob/page.tsx — phone new-job form (newjob.biohazards.net).
 *
 * A second screen for intake: read the email or notes on the PC, type the job
 * into the phone. PIN → one column of the Initial Contact fields → Create.
 * The job is an ordinary lead in Job Manager.
 *
 * Nothing is saved to the server until Create is pressed. Until then the form
 * is kept on this phone (localStorage, per PIN person), so a screen lock, a
 * reload or an expired sign-in loses nothing. Create first checks for open jobs
 * that look like the same client or site and asks before making a second one.
 */
'use client'

import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import SmartFill from '@/components/SmartFill'
import {
  PinStep,
  captureColumn,
  captureShell,
  useCaptureSession,
  type CapturePerson,
} from '@/components/photoApp/CaptureSignIn'
import { TRADING_NAME_OPTIONS } from '@/lib/tradingNames'
import type { IntakeDuplicate } from '@/lib/newJobIntake'
import {
  INTAKE_JOB_TYPES,
  INTAKE_MAX_EXTRA_PHONES,
  INTAKE_PHONE_LABELS,
  INTAKE_URGENCIES,
  applySmartFillToDraft,
  emptyIntakeDraft,
  intakeDraftIsEmpty,
  parseIntakeDraft,
  type IntakeDraft,
} from '@/lib/newJobIntakeDraft'

const APP = 'New job'
const draftKey = (personId: string) => `bh_newjob_draft:${personId}`

interface CreatedJob { id: string; job_code: string; client_name: string; site_address: string }

function readDraft(key: string): IntakeDraft {
  try {
    return parseIntakeDraft(window.localStorage.getItem(key))
  } catch {
    return emptyIntakeDraft()
  }
}

function saveDraft(key: string, draft: IntakeDraft) {
  try {
    if (intakeDraftIsEmpty(draft)) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(draft))
  } catch {}
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim()
}

export default function NewJobPage() {
  const session = useCaptureSession()
  const { booting, person, setPerson } = session

  if (booting) {
    return <div style={captureShell}><div style={{ margin: 'auto', fontWeight: 800 }}>Loading…</div></div>
  }
  if (!person) return <PinStep app={APP} onSignedIn={setPerson} />
  return (
    <NewJobForm
      key={person.person_id}
      person={person}
      onSignOut={() => void session.signOut()}
      onSignedOut={() => setPerson(null)}
    />
  )
}

function NewJobForm({ person, onSignOut, onSignedOut }: {
  person: CapturePerson
  onSignOut: () => void
  onSignedOut: () => void
}) {
  const storageKey = draftKey(person.person_id)
  // Mounted only after the session check, so reading the phone's storage here cannot mismatch server markup.
  const [draft, setDraft] = useState<IntakeDraft>(() => readDraft(storageKey))
  const draftRef = useRef(draft)
  const [formKey, setFormKey] = useState(0)
  const [showSiteContact, setShowSiteContact] = useState(() => Boolean(draft.site_contact_name || draft.site_contact_phone))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicates, setDuplicates] = useState<IntakeDuplicate[] | null>(null)
  const [created, setCreated] = useState<CreatedJob | null>(null)
  const addressRef = useRef<HTMLDivElement>(null)
  const signedOutRef = useRef(false)
  const ids = useId()

  /** The ref is updated at once so Create reads what a blur committed a moment earlier. */
  function replace(next: IntakeDraft) {
    draftRef.current = next
    setDraft(next)
    saveDraft(storageKey, next)
    setError('')
  }

  function update(patch: Partial<IntakeDraft>) {
    replace({ ...draftRef.current, ...patch })
  }

  function reset() {
    replace(emptyIntakeDraft())
    setShowSiteContact(false)
    setDuplicates(null)
    // Remounts the address box and Smart Fill, which keep typed text of their own.
    setFormKey(k => k + 1)
  }

  function clearForm() {
    if (window.confirm('Clear everything typed on this form?')) reset()
  }

  function signOut() {
    if (!intakeDraftIsEmpty(draftRef.current) && !window.confirm('Sign out and clear this form?')) return
    try { window.localStorage.removeItem(storageKey) } catch {}
    onSignOut()
  }

  function handleSignedOut() {
    if (signedOutRef.current) return
    signedOutRef.current = true
    window.alert('Your sign-in expired. Enter your PIN again. What you typed is kept on this phone.')
    onSignedOut()
  }

  /**
   * The address box only reports what was typed when it loses focus, and a tap
   * on Create does not always take focus away on a phone. Read it directly, on
   * the same terms as its own blur: typed text that differs is a free-text address.
   */
  function commitTypedAddress() {
    const box = addressRef.current?.querySelector('[id^="addr-ac-"], input') as { value?: unknown } | null
    const typed = typeof box?.value === 'string' ? box.value.trim() : ''
    if (typed && typed !== draftRef.current.site_address.trim()) {
      update({ site_address: typed, site_place_id: '', site_lat: null, site_lng: null })
    }
  }

  async function create(allowDuplicates: boolean) {
    if (saving) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    commitTypedAddress()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/photo/newjob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draftRef.current, allow_duplicates: allowDuplicates }),
      })
      if (res.status === 401) { handleSignedOut(); return }
      const data = (await res.json().catch(() => ({}))) as { job?: CreatedJob; duplicates?: IntakeDuplicate[]; error?: string }
      if (res.status === 409 && data.duplicates?.length) { setDuplicates(data.duplicates); return }
      if (!res.ok || !data.job) throw new Error(data.error ?? `Could not create the job (${res.status}).`)
      reset()
      setCreated(data.job)
    } catch (e) {
      setDuplicates(null)
      // fetch rejects with a TypeError when the request never got an answer.
      setError(e instanceof TypeError
        ? 'No connection. The form is kept on this phone. Try again when you have signal.'
        : e instanceof Error ? e.message : 'Could not create the job.')
    } finally {
      setSaving(false)
    }
  }

  if (created) {
    return (
      <div style={captureShell}>
        <div style={{ ...captureColumn, maxWidth: 420, margin: 'auto', textAlign: 'center', gap: 10 }}>
          <div style={eyebrow}>Job created</div>
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 64, fontWeight: 900, lineHeight: 1.1 }}>
            #{created.job_code}
          </div>
          {created.client_name && <div style={{ fontSize: 19, fontWeight: 800 }}>{created.client_name}</div>}
          {created.site_address && <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>{created.site_address}</div>}
          <p style={{ margin: '8px 0 12px', fontSize: 14, color: 'var(--text-muted)' }}>
            It is in Job Manager now as a new lead.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setCreated(null)} style={bigButton}>
            New job
          </button>
        </div>
      </div>
    )
  }

  const empty = intakeDraftIsEmpty(draft)
  const id = (name: string) => `${ids}-${name}`

  return (
    <div style={captureShell}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ ...pageColumn, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={eyebrow}>{APP}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {firstName(person.name)}{empty ? '' : ' · draft kept on this phone'}
            </div>
          </div>
          {!empty && (
            <button type="button" className="btn btn-ghost" onClick={clearForm} style={headerButton}>Clear</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={signOut} style={headerButton} title={`Signed in as ${person.name}`}>
            Sign out
          </button>
        </div>
      </header>

      <main style={{ ...pageColumn, flex: 1, padding: '16px 16px 150px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SmartFill
          key={`smart-${formKey}`}
          endpoint="/api/photo/newjob/extract"
          onSignedOut={handleSignedOut}
          onApply={fields => replace(applySmartFillToDraft(draftRef.current, fields))}
        />

        <Field label="Trading name" hint="Leave it for the desk to choose if you are not sure.">
          <div style={{ display: 'flex', gap: 8 }}>
            {TRADING_NAME_OPTIONS.map(o => {
              const selected = draft.trading_name === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ trading_name: selected ? '' : o.id })}
                  style={{ ...choice(selected), flex: 1, minWidth: 0, padding: '10px 6px', display: 'grid', gap: 2 }}
                >
                  <span style={{ fontSize: 17, fontWeight: 900 }}>{o.short}</span>
                  <span style={{ fontSize: 10, lineHeight: 1.25, whiteSpace: 'normal' }}>{o.label}</span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Name" htmlFor={id('name')}>
          <input
            id={id('name')}
            type="text"
            value={draft.client_name}
            onChange={e => update({ client_name: e.target.value })}
            placeholder="Who called?"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            style={input}
          />
        </Field>

        <Field label="Role or relationship" htmlFor={id('role')}>
          <input
            id={id('role')}
            type="text"
            value={draft.client_contact_role}
            onChange={e => update({ client_contact_role: e.target.value })}
            placeholder="e.g. property manager, tenant, family"
            autoComplete="off"
            enterKeyHint="next"
            style={input}
          />
        </Field>

        <Field label="Organisation (optional)" htmlFor={id('org')}>
          <input
            id={id('org')}
            type="text"
            value={draft.client_organization_name}
            onChange={e => update({ client_organization_name: e.target.value })}
            placeholder="Company or account name"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            style={input}
          />
        </Field>

        <Field label="Phone" htmlFor={id('phone')}>
          <input
            id={id('phone')}
            type="tel"
            inputMode="tel"
            value={draft.client_phone}
            onChange={e => update({ client_phone: e.target.value })}
            placeholder="04xx xxx xxx"
            autoComplete="off"
            enterKeyHint="next"
            style={input}
          />
          {draft.client_phones.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <select
                value={p.label}
                aria-label="Number type"
                onChange={e => update({ client_phones: draft.client_phones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                style={{ ...input, width: 112, flexShrink: 0, padding: '13px 8px' }}
              >
                {INTAKE_PHONE_LABELS.map(l => <option key={l}>{l}</option>)}
              </select>
              <input
                type="tel"
                inputMode="tel"
                value={p.number}
                aria-label="Additional number"
                onChange={e => update({ client_phones: draft.client_phones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })}
                placeholder="Additional number"
                autoComplete="off"
                style={{ ...input, flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                aria-label="Remove number"
                onClick={() => update({ client_phones: draft.client_phones.filter((_, j) => j !== i) })}
                style={{ ...choice(false), width: 48, flexShrink: 0, fontSize: 20, color: '#F87171' }}
              >
                ×
              </button>
            </div>
          ))}
          {draft.client_phones.length < INTAKE_MAX_EXTRA_PHONES && (
            <button
              type="button"
              onClick={() => update({ client_phones: [...draft.client_phones, { label: 'Mobile', number: '' }] })}
              style={disclosure}
            >
              + Add number
            </button>
          )}
        </Field>

        <Field label="Email" htmlFor={id('email')}>
          <input
            id={id('email')}
            type="email"
            inputMode="email"
            value={draft.client_email}
            onChange={e => update({ client_email: e.target.value })}
            placeholder="name@example.com"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            style={input}
          />
        </Field>

        <Field label="Site address" hint="Pick a suggestion, or type the full address for rural or unusual sites.">
          <div ref={addressRef}>
            <AddressAutocomplete
              key={`address-${formKey}`}
              value={draft.site_address}
              placeId={draft.site_place_id}
              lat={draft.site_lat}
              lng={draft.site_lng}
              placeholder="Street, suburb, state, postcode"
              onChange={next => update({
                site_address: next.address,
                site_place_id: next.placeId,
                site_lat: next.lat,
                site_lng: next.lng,
              })}
            />
          </div>
        </Field>

        {!showSiteContact ? (
          <button type="button" onClick={() => setShowSiteContact(true)} style={{ ...disclosure, marginTop: 0 }}>
            + Site contact (if different)
          </button>
        ) : (
          <Field label="Site contact (if different)" htmlFor={id('site-name')} hint="The person who opens the door, when that is not the caller.">
            <input
              id={id('site-name')}
              type="text"
              value={draft.site_contact_name}
              onChange={e => update({ site_contact_name: e.target.value })}
              placeholder="On-site contact name"
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="next"
              style={input}
            />
            <input
              type="tel"
              inputMode="tel"
              value={draft.site_contact_phone}
              aria-label="Site contact phone"
              onChange={e => update({ site_contact_phone: e.target.value })}
              placeholder="On-site contact phone"
              autoComplete="off"
              enterKeyHint="next"
              style={{ ...input, marginTop: 8 }}
            />
          </Field>
        )}

        <Field label="Job type" htmlFor={id('type')}>
          <select id={id('type')} value={draft.job_type} onChange={e => update({ job_type: e.target.value })} style={input}>
            {INTAKE_JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="Urgency">
          <div style={{ display: 'flex', gap: 8 }}>
            {INTAKE_URGENCIES.map(u => {
              const selected = draft.urgency === u.value
              return (
                <button
                  key={u.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ urgency: u.value })}
                  style={{ ...choice(selected), flex: 1, minWidth: 0, padding: '13px 4px', fontSize: 13, fontWeight: 700 }}
                >
                  {u.label}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Access notes" htmlFor={id('access')}>
          <textarea
            id={id('access')}
            value={draft.access_notes}
            onChange={e => update({ access_notes: e.target.value })}
            placeholder="Parking, keys, pets, hazards, discretion — anything the tech should know before arriving."
            rows={3}
            style={{ ...input, resize: 'vertical', minHeight: 90 }}
          />
        </Field>

        <Field label="Call notes" htmlFor={id('notes')} hint="Saved to the job's notes log with the time.">
          <textarea
            id={id('notes')}
            value={draft.call_notes}
            onChange={e => update({ call_notes: e.target.value })}
            placeholder="Anything else that was said and does not fit a field."
            rows={4}
            style={{ ...input, resize: 'vertical', minHeight: 110 }}
          />
        </Field>
      </main>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 5, background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ ...pageColumn, display: 'grid', gap: 8, padding: '10px 16px' }}>
          {error && <div role="alert" style={errorBox}>{error}</div>}
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void create(false)} style={bigButton}>
            {saving && !duplicates ? <><span className="spinner" /> Creating…</> : 'Create job'}
          </button>
        </div>
      </div>

      {duplicates && (
        <div role="dialog" aria-modal="true" aria-label="Possible duplicate job" style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ ...pageColumn, maxHeight: '85dvh', overflowY: 'auto', background: 'var(--surface)', borderTop: '2px solid #FF6B35', borderRadius: '16px 16px 0 0', padding: '18px 16px calc(16px + env(safe-area-inset-bottom))', display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 900 }}>This may already be a job</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
                {duplicates.length === 1 ? 'An open job looks' : 'These open jobs look'} like the same client or site.
              </div>
            </div>
            {duplicates.map((d, i) => (
              <div key={`${d.job_code}-${i}`} style={{ border: '1px solid var(--border-2)', borderRadius: 12, padding: 12, background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, fontSize: 18, color: '#FF6B35' }}>
                    {d.job_code ? `#${d.job_code}` : 'No code'}
                  </span>
                  {d.status && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.status.replace(/_/g, ' ')}</span>}
                </div>
                <div style={{ fontSize: 15, marginTop: 2 }}>{d.site_address || 'No site address yet'}</div>
                <div style={{ fontSize: 13, color: '#FBBF24', fontWeight: 700, marginTop: 4 }}>{d.reasons.join(' · ')}</div>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setDuplicates(null)} style={bigButton}>
              Go back
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void create(true)} style={bigButton}>
              {saving ? <><span className="spinner" /> Creating…</> : 'It is a different job. Create it'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

function choice(selected: boolean): CSSProperties {
  return {
    borderRadius: 10,
    border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-2)'}`,
    background: selected ? 'var(--accent-dim)' : 'var(--surface-2)',
    color: selected ? 'var(--accent)' : 'var(--text-muted)',
  }
}

const pageColumn: CSSProperties = { width: '100%', maxWidth: 560, margin: '0 auto' }
// 17px: iOS zooms the page when a focused field's text is under 16px.
const input: CSSProperties = { fontSize: 17, padding: '13px 14px', borderRadius: 10 }
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF6B35' }
const headerButton: CSSProperties = { fontSize: 12, padding: '6px 10px' }
const bigButton: CSSProperties = { height: 54, fontSize: 17, fontWeight: 800, borderRadius: 12, width: '100%' }
const disclosure: CSSProperties = {
  marginTop: 8, padding: '12px 14px', width: '100%', textAlign: 'left', borderRadius: 10,
  border: '1px dashed var(--border-2)', color: 'var(--text-muted)', fontSize: 14,
}
const errorBox: CSSProperties = { padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 14 }
