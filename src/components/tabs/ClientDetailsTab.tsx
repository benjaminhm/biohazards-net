/*
 * components/tabs/ClientDetailsTab.tsx
 *
 * Client Details — technician-facing contact directory for a job.
 *
 * View-first: renders as a read-only card of who to contact, how to contact
 * them, and where to go. Every row is actionable (tap-to-call, tap-to-SMS,
 * tap-to-email, open-in-Maps, copy, save-vCard). An Edit toggle flips
 * contact fields into inputs that auto-save via PATCH.
 *
 * Out of scope (deliberately): Job Type and Urgency live on Initial Contact,
 * Status is managed from the dashboard job cards, Scheduled / Schedule note
 * live on the Timeline tab, and the notes log lives on Initial Contact.
 */
'use client'

import { useEffect, useState } from 'react'
import type { Job, PhoneEntry } from '@/lib/types'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
  readOnly?: boolean
}

// Helpers (mirrored from DetailsTab/InitialContactTab).
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

// ─────────────────────────────────────────────────────────────────────────────
// Styling primitives
// ─────────────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--surface)',
  padding: 16,
  marginBottom: 16,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 0',
  borderBottom: '1px solid var(--border)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 4,
}

const valueStyle: React.CSSProperties = {
  fontSize: 15,
  color: 'var(--text)',
  lineHeight: 1.4,
  wordBreak: 'break-word',
}

const mutedValueStyle: React.CSSProperties = {
  ...valueStyle,
  color: 'var(--text-muted)',
  fontStyle: 'italic',
}

const actionBtn: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 36,
  flexShrink: 0,
}

const fieldBox: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 15,
  outline: 'none',
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-saving input (same pattern as InitialContactTab)
// ─────────────────────────────────────────────────────────────────────────────

function EditableField({
  value,
  onCommit,
  placeholder,
  type = 'text',
  multiline = false,
  disabled = false,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  type?: string
  multiline?: boolean
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    if (draft !== (value ?? '')) onCommit(draft)
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        rows={3}
        style={{ ...fieldBox, resize: 'vertical', minHeight: 76, fontFamily: 'inherit' }}
      />
    )
  }

  return (
    <input
      type={type}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      placeholder={placeholder}
      style={fieldBox}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ClientDetailsTab({ job, onJobUpdate, readOnly = false }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const canEdit = !readOnly

  async function patchField(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) {
        alert(data.error || `Save failed (${res.status})`)
        return
      }
      onJobUpdate(data.job)
    } finally {
      setSaving(false)
    }
  }

  async function copyToClipboard(text: string, key: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      // noop
    }
  }

  function updatePhones(next: PhoneEntry[]) {
    return patchField({ client_phones: next })
  }

  function addExtraPhone() {
    const next = [...(job.client_phones ?? []), { label: 'Mobile', number: '' }]
    return updatePhones(next)
  }

  function updateExtraPhone(idx: number, key: 'label' | 'number', value: string) {
    const next = [...(job.client_phones ?? [])]
    const raw = key === 'number' ? normalizeAUPhone(value) : value
    next[idx] = { ...next[idx], [key]: raw }
    return updatePhones(next)
  }

  function removeExtraPhone(idx: number) {
    const next = (job.client_phones ?? []).filter((_, i) => i !== idx)
    return updatePhones(next)
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
  const siteContactE164 = toE164(normalizeAUPhone(job.site_contact_phone || ''))
  const mapsHref = job.site_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.site_address)}`
    : null

  // Small helper to render the "copied" chip on a row.
  const copiedChip = (key: string) =>
    copied === key ? (
      <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 6 }}>Copied</span>
    ) : null

  // ────────────────────────── VIEW MODE row renderer ──────────────────────────
  function ContactRow({
    label,
    value,
    actions,
    emptyText = 'Not recorded',
  }: {
    label: string
    value: string
    actions?: React.ReactNode
    emptyText?: string
  }) {
    const isEmpty = !value || !value.trim()
    return (
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={labelStyle}>{label}</div>
          <div style={isEmpty ? mutedValueStyle : valueStyle}>{isEmpty ? emptyText : value}</div>
        </div>
        {!isEmpty && actions && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{actions}</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Header / toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {editing ? 'Editing contact info — changes save on blur.' : 'Read-only contact directory.'}
          {saving && <span style={{ marginLeft: 8 }}>Saving…</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={downloadVCard}
            title="Save contact to phone"
            style={actionBtn}
          >
            💾 vCard
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(e => !e)}
              className={editing ? 'btn btn-primary' : 'btn'}
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {/* ─────────────────────────── Caller card ─────────────────────────── */}
      <div style={cardStyle}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}
        >
          Caller
        </div>

        {!editing ? (
          <>
            <ContactRow
              label="Name"
              value={job.client_name || ''}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(job.client_name, 'name')}
                    title="Copy name"
                    style={actionBtn}
                  >
                    📋
                  </button>
                  {copiedChip('name')}
                </>
              }
            />
            <ContactRow label="Role or relationship" value={job.client_contact_role || ''} />
            <ContactRow
              label="Organisation"
              value={job.client_organization_name || ''}
              actions={
                job.client_organization_name ? (
                  <>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(job.client_organization_name ?? '', 'org')}
                      title="Copy organisation"
                      style={actionBtn}
                    >
                      📋
                    </button>
                    {copiedChip('org')}
                  </>
                ) : undefined
              }
            />
            <ContactRow
              label="Phone"
              value={job.client_phone || ''}
              actions={
                job.client_phone ? (
                  <>
                    <a href={`tel:${primaryPhoneE164}`} title="Call" style={actionBtn}>📞</a>
                    <a href={`sms:${primaryPhoneE164}`} title="Text" style={actionBtn}>💬</a>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(job.client_phone, 'phone')}
                      title="Copy number"
                      style={actionBtn}
                    >
                      📋
                    </button>
                    {copiedChip('phone')}
                  </>
                ) : undefined
              }
            />
            {(job.client_phones ?? []).map((p, i) => {
              const e164 = toE164(normalizeAUPhone(p.number || ''))
              return (
                <ContactRow
                  key={i}
                  label={p.label || 'Additional phone'}
                  value={p.number || ''}
                  actions={
                    p.number ? (
                      <>
                        <a href={`tel:${e164}`} title="Call" style={actionBtn}>📞</a>
                        <a href={`sms:${e164}`} title="Text" style={actionBtn}>💬</a>
                      </>
                    ) : undefined
                  }
                />
              )
            })}
            <ContactRow
              label="Email"
              value={job.client_email || ''}
              actions={
                job.client_email ? (
                  <>
                    <a href={`mailto:${job.client_email}`} title="Email" style={actionBtn}>✉️</a>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(job.client_email, 'email')}
                      title="Copy email"
                      style={actionBtn}
                    >
                      📋
                    </button>
                    {copiedChip('email')}
                  </>
                ) : undefined
              }
            />
          </>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Name</label>
              <EditableField
                value={job.client_name ?? ''}
                onCommit={v => patchField({ client_name: v })}
                placeholder="Who called?"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Role or relationship</label>
              <EditableField
                value={job.client_contact_role ?? ''}
                onCommit={v => patchField({ client_contact_role: v })}
                placeholder="e.g. property manager, tenant, family member"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Organisation</label>
              <EditableField
                value={job.client_organization_name ?? ''}
                onCommit={v => patchField({ client_organization_name: v })}
                placeholder="Company or account name"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Phone</label>
              <EditableField
                value={job.client_phone ?? ''}
                onCommit={v => patchField({ client_phone: normalizeAUPhone(v) })}
                placeholder="04xx xxx xxx"
                type="tel"
              />
            </div>
            {(job.client_phones ?? []).map((p, i) => (
              <div
                key={i}
                style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}
              >
                <select
                  value={p.label}
                  onChange={e => updateExtraPhone(i, 'label', e.target.value)}
                  style={{ width: 110, flexShrink: 0, fontSize: 12, padding: '10px 6px' }}
                >
                  <option>Landline</option>
                  <option>Mobile</option>
                  <option>Work</option>
                  <option>Other</option>
                </select>
                <div style={{ flex: 1 }}>
                  <EditableField
                    value={p.number}
                    onCommit={v => updateExtraPhone(i, 'number', v)}
                    placeholder="Additional number"
                    type="tel"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeExtraPhone(i)}
                  title="Remove"
                  style={{ ...actionBtn, color: '#F87171' }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addExtraPhone}
              style={{
                padding: '8px 12px',
                background: 'none',
                border: '1px dashed var(--border)',
                borderRadius: 6,
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                marginBottom: 14,
              }}
            >
              + Add number
            </button>
            <div style={{ marginBottom: 4 }}>
              <label style={labelStyle}>Email</label>
              <EditableField
                value={job.client_email ?? ''}
                onCommit={v => patchField({ client_email: v })}
                placeholder="name@example.com"
                type="email"
              />
            </div>
          </>
        )}
      </div>

      {/* ─────────────────────────── Site card ─────────────────────────── */}
      <div style={cardStyle}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}
        >
          Site
        </div>

        {!editing ? (
          <>
            <ContactRow
              label="Address"
              value={job.site_address || ''}
              actions={
                job.site_address ? (
                  <>
                    {mapsHref && (
                      <a href={mapsHref} target="_blank" rel="noopener noreferrer" title="Open in Maps" style={actionBtn}>
                        🗺️
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => copyToClipboard(job.site_address, 'addr')}
                      title="Copy address"
                      style={actionBtn}
                    >
                      📋
                    </button>
                    {copiedChip('addr')}
                  </>
                ) : undefined
              }
            />
            {(job.site_contact_name || job.site_contact_phone) && (
              <>
                <ContactRow label="Site contact" value={job.site_contact_name || ''} />
                <ContactRow
                  label="Site contact phone"
                  value={job.site_contact_phone || ''}
                  actions={
                    job.site_contact_phone ? (
                      <>
                        <a href={`tel:${siteContactE164}`} title="Call" style={actionBtn}>📞</a>
                        <a href={`sms:${siteContactE164}`} title="Text" style={actionBtn}>💬</a>
                      </>
                    ) : undefined
                  }
                />
              </>
            )}
            <div style={{ padding: '10px 0' }}>
              <div style={labelStyle}>Access notes</div>
              {job.access_notes && job.access_notes.trim() ? (
                <div
                  style={{
                    ...valueStyle,
                    whiteSpace: 'pre-wrap',
                    background: 'var(--surface-2)',
                    padding: 10,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}
                >
                  {job.access_notes}
                </div>
              ) : (
                <div style={mutedValueStyle}>
                  None — capture parking, keys, pets, discretion notes on Initial Contact.
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Address</label>
              <EditableField
                value={job.site_address ?? ''}
                onCommit={v => patchField({ site_address: v })}
                placeholder="Street, suburb, state, postcode"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Site contact name</label>
              <EditableField
                value={job.site_contact_name ?? ''}
                onCommit={v => patchField({ site_contact_name: v })}
                placeholder="On-site contact (if different from caller)"
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Site contact phone</label>
              <EditableField
                value={job.site_contact_phone ?? ''}
                onCommit={v => patchField({ site_contact_phone: normalizeAUPhone(v) })}
                placeholder="On-site contact phone"
                type="tel"
              />
            </div>
            <div>
              <label style={labelStyle}>Access notes</label>
              <EditableField
                value={job.access_notes ?? ''}
                onCommit={v => patchField({ access_notes: v })}
                placeholder="Parking, keys, pets, discretion — free text."
                multiline
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Also editable from Home → Initial Contact.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
