/*
 * components/tabs/InitialContactTab.tsx
 *
 * Unified Client & Site screen (merges Initial Contact + Client Details into
 * one clean, iPad/tablet-friendly surface).
 *
 * Design principles:
 *   - Core fields only up front (Name, Phone, Site address, Job Type, Urgency)
 *     in a compact responsive grid with 44px+ touch targets and 16px inputs
 *     (prevents iPadOS Safari auto-zoom).
 *   - Inline Brand pills (BCQ | FCQ | HCQ) + quick actions (vCard, Maps, Call,
 *     SMS, Copy) right at the top.
 *   - SmartFill stays open on blank jobs and collapses to a 1-line bar once
 *     the job has a name or address.
 *   - Secondary details (Organisation, Role/relationship, Email, extra phones,
 *     Site contact, Trade Account) tuck neatly under one disclosure toggle and
 *     auto-open whenever any of them already has data.
 *   - Auto-saves every edit on blur via PATCH /api/jobs/[id].
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Job, JobType, JobUrgency, PhoneEntry } from '@/lib/types'
import SmartFill from '@/components/SmartFill'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import TradeAccountPicker from '@/components/TradeAccountPicker'
import { TRADING_NAME_OPTIONS, type TradingNameId } from '@/lib/tradingNames'

const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'crime_scene', label: 'Crime scene' },
  { value: 'hoarding', label: 'Hoarding' },
  { value: 'mold', label: 'Mold' },
  { value: 'sewage', label: 'Sewage' },
  { value: 'trauma', label: 'Trauma' },
  { value: 'unattended_death', label: 'Unattended death' },
  { value: 'flood', label: 'Flood' },
  { value: 'other', label: 'Other' },
]

const URGENCIES: { value: JobUrgency; label: string }[] = [
  { value: 'standard', label: '⚪ Standard' },
  { value: 'urgent', label: '🟠 Urgent' },
  { value: 'emergency', label: '🔴 Emergency' },
]

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
  readOnly?: boolean
  onChangeTradingName?: () => void
}

function normalizeAUPhone(raw: string): string {
  if (!raw) return raw
  const cleaned = raw.replace(/[\s\-()\.]/g, '')
  if (cleaned.startsWith('+614')) return '0' + cleaned.slice(3)
  if (cleaned.startsWith('+61')) return '0' + cleaned.slice(3)
  if (cleaned.startsWith('614')) return '0' + cleaned.slice(2)
  return cleaned
}

function toE164(phone: string): string {
  if (!phone) return ''
  const cleaned = phone.replace(/\s/g, '')
  if (cleaned.startsWith('0')) return '+61' + cleaned.slice(1)
  if (cleaned.startsWith('+61')) return cleaned
  return cleaned
}

function extractSuburb(address: string): string {
  if (!address) return ''
  const parts = address.split(',')
  if (parts.length >= 2) {
    const raw = parts[1].trim()
    return raw.replace(/\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\b.*/i, '').replace(/\d{4,}.*/, '').trim()
  }
  const match = address.match(/([A-Za-z\s]+?)(?:\s+(?:QLD|NSW|VIC|WA|SA|TAS|ACT|NT))?(?:\s+\d{4})?$/i)
  return match ? match[1].trim().split(/\s+/).slice(-2).join(' ') : ''
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--surface)',
  padding: 16,
  marginBottom: 14,
}

const actionBtn: React.CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 15,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

const fieldBox: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 44,
  padding: '10px 12px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 16,
  outline: 'none',
}

const sectionLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}

const hint: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 5,
  lineHeight: 1.45,
}

function FieldInput({
  value,
  onCommit,
  placeholder,
  type = 'text',
  inputMode,
  multiline = false,
  disabled = false,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  multiline?: boolean
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  const [focused, setFocused] = useState(false)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!focused) setDraft(value)
  }

  function commit() {
    setFocused(false)
    const next = draft.trim()
    if (next !== (value ?? '').trim()) onCommit(next)
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        rows={3}
        style={{ ...fieldBox, minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
      />
    )
  }

  return (
    <input
      type={type}
      inputMode={inputMode}
      value={draft}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.currentTarget as HTMLInputElement).blur()
        }
      }}
      placeholder={placeholder}
      style={fieldBox}
    />
  )
}

export default function InitialContactTab({ job, onJobUpdate, readOnly = false }: Props) {
  const hasSecondaryData = Boolean(
    job.client_organization_name?.trim() ||
    job.client_contact_role?.trim() ||
    job.client_email?.trim() ||
    job.client_account_id ||
    job.site_contact_name?.trim() ||
    job.site_contact_phone?.trim() ||
    (job.client_phones && job.client_phones.length > 0),
  )

  const [showMore, setShowMore] = useState(hasSecondaryData)
  const [noteDraft, setNoteDraft] = useState('')
  const [postingNote, setPostingNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const patchChainRef = useRef<Promise<void>>(Promise.resolve())
  const inFlightPatchesRef = useRef(0)

  useEffect(() => {
    setShowMore(
      Boolean(
        job.client_organization_name?.trim() ||
        job.client_contact_role?.trim() ||
        job.client_email?.trim() ||
        job.client_account_id ||
        job.site_contact_name?.trim() ||
        job.site_contact_phone?.trim() ||
        (job.client_phones && job.client_phones.length > 0),
      ),
    )
  }, [
    job.id,
    job.client_organization_name,
    job.client_contact_role,
    job.client_email,
    job.client_account_id,
    job.site_contact_name,
    job.site_contact_phone,
    job.client_phones,
  ])

  function patchField(updates: Record<string, unknown>): Promise<void> {
    if (readOnly) return Promise.resolve()
    const run = async () => {
      inFlightPatchesRef.current += 1
      setSaving(true)
      setSavedFlash(false)
      try {
        const res = await fetch(`/api/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.job) onJobUpdate(data.job)
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 1800)
        }
      } finally {
        inFlightPatchesRef.current -= 1
        if (inFlightPatchesRef.current === 0) setSaving(false)
      }
    }
    const next = patchChainRef.current.then(run, run)
    patchChainRef.current = next
    return next
  }

  async function copyText(val: string, key: string) {
    if (!val.trim()) return
    try {
      await navigator.clipboard.writeText(val.trim())
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      /* ignore */
    }
  }

  function updatePhones(next: PhoneEntry[]) {
    return patchField({ client_phones: next })
  }

  function addExtraPhone() {
    setShowMore(true)
    const next: PhoneEntry[] = [...(job.client_phones ?? []), { label: 'Mobile', number: '' }]
    return updatePhones(next)
  }

  function updateExtraPhone(idx: number, field: keyof PhoneEntry, value: string) {
    const next = (job.client_phones ?? []).map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    return updatePhones(next)
  }

  function removeExtraPhone(idx: number) {
    const next = (job.client_phones ?? []).filter((_, i) => i !== idx)
    return updatePhones(next)
  }

  async function addNote() {
    const text = noteDraft.trim()
    if (!text || postingNote || readOnly) return
    setPostingNote(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.job) onJobUpdate(data.job)
        setNoteDraft('')
        noteRef.current?.focus()
      }
    } finally {
      setPostingNote(false)
    }
  }

  function downloadVCard() {
    const suburb = extractSuburb(job.site_address)
    const contactName = [job.client_organization_name, job.client_name, suburb]
      .filter(Boolean)
      .join(' · ')
    const phone04 = normalizeAUPhone(job.client_phone || '')
    const phone61 = toE164(phone04)
    const extraPhoneLines = (job.client_phones ?? []).flatMap(p => {
      const n04 = normalizeAUPhone(p.number || '')
      const n61 = toE164(n04)
      const type = p.label.toLowerCase().includes('land') ? 'HOME' : 'CELL'
      return [
        n04 ? `TEL;TYPE=${type}:${n04}` : '',
        n61 && n61 !== n04 ? `TEL;TYPE=${type}:${n61}` : '',
      ].filter(Boolean)
    })
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${contactName}`,
      `N:${job.client_name};;;;`,
      phone04 ? `TEL;TYPE=CELL:${phone04}` : '',
      phone61 && phone61 !== phone04 ? `TEL;TYPE=CELL:${phone61}` : '',
      ...extraPhoneLines,
      job.client_email ? `EMAIL:${job.client_email}` : '',
      job.site_address ? `ADR;TYPE=HOME:;;${job.site_address};;;;` : '',
      `NOTE:biohazards.net${suburb ? ' · ' + suburb : ''}`,
      'END:VCARD',
    ]
      .filter(Boolean)
      .join('\n')
    const blob = new Blob([vcard], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(contactName || 'contact').replace(/[^a-zA-Z0-9]+/g, '_')}.vcf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const primaryPhoneE164 = toE164(normalizeAUPhone(job.client_phone || ''))
  const mapsHref = job.site_address?.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.site_address)}`
    : null
  const noteLines = job.notes ? job.notes.split('\n').filter(Boolean) : []
  const isBlankJob = !job.client_name?.trim() && !job.site_address?.trim()

  const secondarySummary = [
    job.client_organization_name?.trim(),
    job.client_contact_role?.trim(),
    job.client_email?.trim(),
    job.site_contact_name?.trim() ? `Site: ${job.site_contact_name.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div style={{ paddingBottom: 48 }}>
      {/* SmartFill — open by default only on blank jobs, 1-tap toggle once populated */}
      <SmartFill
        defaultOpen={isBlankJob}
        onApply={async (fields) => {
          const allowed = [
            'client_name',
            'client_organization_name',
            'client_contact_role',
            'client_contact_relationship',
            'client_phone',
            'client_email',
            'site_address',
            'access_notes',
          ]
          const updates: Record<string, string> = {}
          for (const key of allowed) {
            if (fields[key]) updates[key] = fields[key]
          }
          if (fields.company_name && !updates.client_organization_name) {
            updates.client_organization_name = fields.company_name
          }
          const patchExtras: Record<string, unknown> = {}
          if (updates.site_address) {
            patchExtras.site_place_id = ''
            patchExtras.site_lat = null
            patchExtras.site_lng = null
          }
          if (fields.job_type) {
            const match = JOB_TYPES.find(
              t => t.value === fields.job_type || t.label.toLowerCase() === fields.job_type.toLowerCase(),
            )
            if (match) updates.job_type = match.value
          }
          if (fields.urgency) {
            const match = URGENCIES.find(
              u => u.value === fields.urgency || u.label.toLowerCase().includes(fields.urgency.toLowerCase()),
            )
            if (match) updates.urgency = match.value
          }
          if (Object.keys(updates).length === 0 && Object.keys(patchExtras).length === 0) return
          await patchField({ ...updates, ...patchExtras })
        }}
        onSourceText={async (text) => {
          await fetch(`/api/jobs/${job.id}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `Smart fill source: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}`,
            }),
          })
        }}
      />

      {/* Brand pills + quick contact actions + live save status */}
      <div
        style={{
          ...cardStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ ...sectionLabel, marginBottom: 0, marginRight: 4 }}>Brand</span>
          {TRADING_NAME_OPTIONS.map(opt => {
            const selected = job.trading_name === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                disabled={readOnly}
                title={opt.label}
                onClick={() => void patchField({ trading_name: opt.id as TradingNameId })}
                style={{
                  minHeight: 40,
                  padding: '0 14px',
                  borderRadius: 999,
                  border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  background: selected ? 'var(--accent-dim)' : 'var(--surface-2)',
                  color: selected ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 13,
                  fontWeight: selected ? 800 : 600,
                  cursor: readOnly ? 'default' : 'pointer',
                }}
              >
                {opt.short}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(saving || savedFlash) && (
            <span style={{ fontSize: 12, fontWeight: 600, color: saving ? 'var(--text-muted)' : '#10B981' }}>
              {saving ? 'Saving…' : 'Saved ✓'}
            </span>
          )}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noopener noreferrer" title="Open site in Google Maps" style={{ ...actionBtn, padding: '0 12px', fontSize: 13, fontWeight: 600, gap: 5 }}>
              🗺️ Maps
            </a>
          )}
          <button
            type="button"
            onClick={downloadVCard}
            title="Save client contact to phone/iPad"
            style={{ ...actionBtn, padding: '0 12px', fontSize: 13, fontWeight: 600, gap: 5 }}
          >
            💾 vCard
          </button>
        </div>
      </div>

      <fieldset
        disabled={readOnly}
        style={{ border: 'none', padding: 0, margin: 0, opacity: readOnly ? 0.75 : 1 }}
      >
        {/* Core client & site details */}
        <div style={cardStyle}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <label style={sectionLabel}>Client name</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <FieldInput
                    value={job.client_name ?? ''}
                    onCommit={v => patchField({ client_name: v })}
                    placeholder="Who called?"
                  />
                </div>
                {job.client_name?.trim() && (
                  <button
                    type="button"
                    onClick={() => void copyText(job.client_name, 'name')}
                    title="Copy name"
                    style={actionBtn}
                  >
                    {copiedKey === 'name' ? '✓' : '📋'}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label style={sectionLabel}>Mobile / phone</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <FieldInput
                    value={job.client_phone ?? ''}
                    onCommit={v => patchField({ client_phone: v })}
                    placeholder="04xx xxx xxx"
                    type="tel"
                    inputMode="tel"
                  />
                </div>
                {job.client_phone?.trim() && (
                  <>
                    <a href={`tel:${primaryPhoneE164}`} title="Call" style={actionBtn}>📞</a>
                    <a href={`sms:${primaryPhoneE164}`} title="Text" style={actionBtn}>💬</a>
                    <button
                      type="button"
                      onClick={() => void copyText(job.client_phone, 'phone')}
                      title="Copy phone"
                      style={actionBtn}
                    >
                      {copiedKey === 'phone' ? '✓' : '📋'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={sectionLabel}>Site address</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <AddressAutocomplete
                  value={job.site_address ?? ''}
                  placeId={job.site_place_id ?? ''}
                  lat={job.site_lat ?? null}
                  lng={job.site_lng ?? null}
                  disabled={readOnly}
                  placeholder="Street, suburb, state, postcode"
                  onChange={next =>
                    patchField({
                      site_address: next.address,
                      site_place_id: next.placeId,
                      site_lat: next.lat,
                      site_lng: next.lng,
                    })
                  }
                />
              </div>
              {job.site_address?.trim() && (
                <button
                  type="button"
                  onClick={() => void copyText(job.site_address, 'address')}
                  title="Copy address"
                  style={actionBtn}
                >
                  {copiedKey === 'address' ? '✓' : '📋'}
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
              alignItems: 'end',
            }}
          >
            <div>
              <label style={sectionLabel}>Job type</label>
              <select
                value={job.job_type}
                disabled={readOnly}
                onChange={e => patchField({ job_type: e.target.value })}
                style={fieldBox}
              >
                {JOB_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={sectionLabel}>Urgency</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {URGENCIES.map(u => {
                  const selected = job.urgency === u.value
                  return (
                    <button
                      key={u.value}
                      type="button"
                      disabled={readOnly}
                      onClick={() => patchField({ urgency: u.value })}
                      style={{
                        flex: '1 1 auto',
                        minHeight: 44,
                        padding: '0 12px',
                        borderRadius: 10,
                        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                        background: selected ? 'var(--accent-dim)' : 'var(--surface-2)',
                        color: selected ? 'var(--accent)' : 'var(--text-muted)',
                        fontSize: 13,
                        fontWeight: selected ? 700 : 500,
                        cursor: readOnly ? 'default' : 'pointer',
                      }}
                    >
                      {u.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible secondary details: email, org, role, extra phones, site contact, trade account */}
        <div style={cardStyle}>
          <button
            type="button"
            onClick={() => setShowMore(s => !s)}
            aria-expanded={showMore}
            style={{
              width: '100%',
              minHeight: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span>{showMore ? '▾ More client details' : '▸ More client details (email, organisation, role, site contact, account)'}</span>
              {!showMore && secondarySummary && (
                <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                  {secondarySummary}
                </span>
              )}
            </span>
          </button>

          {showMore && (
            <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 14,
                }}
              >
                <div>
                  <label style={sectionLabel}>Email</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <FieldInput
                        value={job.client_email ?? ''}
                        onCommit={v => patchField({ client_email: v })}
                        placeholder="name@example.com"
                        type="email"
                        inputMode="email"
                      />
                    </div>
                    {job.client_email?.trim() && (
                      <>
                        <a href={`mailto:${job.client_email}`} title="Email" style={actionBtn}>✉️</a>
                        <button
                          type="button"
                          onClick={() => void copyText(job.client_email, 'email')}
                          title="Copy email"
                          style={actionBtn}
                        >
                          {copiedKey === 'email' ? '✓' : '📋'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <label style={sectionLabel}>Organisation</label>
                  <FieldInput
                    value={job.client_organization_name ?? ''}
                    onCommit={v => patchField({ client_organization_name: v })}
                    placeholder="Company or agency name"
                  />
                </div>
              </div>

              <div>
                <label style={sectionLabel}>Role or relationship</label>
                <FieldInput
                  value={job.client_contact_role ?? ''}
                  onCommit={v => patchField({ client_contact_role: v })}
                  placeholder="e.g. Property manager, tenant, family member, executor, insurer"
                />
              </div>

              {/* Extra phone numbers */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ ...sectionLabel, marginBottom: 0 }}>Additional phone numbers</label>
                  <button
                    type="button"
                    onClick={() => void addExtraPhone()}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      background: 'none',
                      border: '1px dashed var(--border)',
                      borderRadius: 8,
                      color: 'var(--accent)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    + Add number
                  </button>
                </div>
                {(job.client_phones ?? []).map((p, i) => {
                  const extraE164 = toE164(normalizeAUPhone(p.number || ''))
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                      <select
                        value={p.label}
                        onChange={e => updateExtraPhone(i, 'label', e.target.value)}
                        style={{ ...fieldBox, width: 108, flexShrink: 0, fontSize: 14, padding: '8px 6px' }}
                      >
                        <option>Mobile</option>
                        <option>Landline</option>
                        <option>Work</option>
                        <option>Other</option>
                      </select>
                      <div style={{ flex: 1 }}>
                        <FieldInput
                          value={p.number}
                          onCommit={v => updateExtraPhone(i, 'number', v)}
                          placeholder="Additional number"
                          type="tel"
                          inputMode="tel"
                        />
                      </div>
                      {p.number && (
                        <>
                          <a href={`tel:${extraE164}`} title="Call" style={actionBtn}>📞</a>
                          <a href={`sms:${extraE164}`} title="Text" style={actionBtn}>💬</a>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeExtraPhone(i)}
                        title="Remove"
                        style={{ ...actionBtn, color: '#F87171' }}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Site contact if different */}
              <div>
                <label style={sectionLabel}>On-site contact (if different from caller)</label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 8,
                  }}
                >
                  <FieldInput
                    value={job.site_contact_name ?? ''}
                    onCommit={v => patchField({ site_contact_name: v })}
                    placeholder="On-site contact name"
                  />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <FieldInput
                        value={job.site_contact_phone ?? ''}
                        onCommit={v => patchField({ site_contact_phone: v })}
                        placeholder="On-site contact phone"
                        type="tel"
                        inputMode="tel"
                      />
                    </div>
                    {job.site_contact_phone?.trim() && (
                      <>
                        <a
                          href={`tel:${toE164(normalizeAUPhone(job.site_contact_phone))}`}
                          title="Call"
                          style={actionBtn}
                        >
                          📞
                        </a>
                        <a
                          href={`sms:${toE164(normalizeAUPhone(job.site_contact_phone))}`}
                          title="Text"
                          style={actionBtn}
                        >
                          💬
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Trade account link */}
              <TradeAccountPicker job={job} onPatch={patchField} readOnly={readOnly} />
            </div>
          )}
        </div>

        {/* Access notes & call log */}
        <div style={cardStyle}>
          <div style={{ marginBottom: 16 }}>
            <label style={sectionLabel}>Access notes</label>
            <FieldInput
              value={job.access_notes ?? ''}
              onCommit={v => patchField({ access_notes: v })}
              placeholder="Parking, keys, entry instructions, pets, discretion, hazards on arrival…"
              multiline
            />
          </div>

          <div>
            <label style={sectionLabel}>Call notes</label>
            <textarea
              ref={noteRef}
              value={noteDraft}
              disabled={readOnly || postingNote}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void addNote()
                }
              }}
              placeholder="Anything the caller said — context, constraints, scope hints…"
              rows={3}
              style={{ ...fieldBox, minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={hint}>
                {noteDraft.trim()
                  ? 'Tap Add note (or Cmd/Ctrl+Enter) to timestamp.'
                  : 'Timestamped and appended to the job log.'}
              </span>
              <button
                type="button"
                onClick={() => void addNote()}
                disabled={!noteDraft.trim() || postingNote || saving}
                className="btn btn-primary"
                style={{ minHeight: 44, padding: '0 16px', fontSize: 14, fontWeight: 700 }}
              >
                {postingNote ? 'Saving…' : 'Add note'}
              </button>
            </div>

            {noteLines.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg)',
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {noteLines
                  .slice()
                  .reverse()
                  .map((line, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 13,
                        color: 'var(--text)',
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                        borderBottom: i < noteLines.length - 1 ? '1px solid var(--border)' : 'none',
                        paddingBottom: 6,
                      }}
                    >
                      {line}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </fieldset>
    </div>
  )
}
