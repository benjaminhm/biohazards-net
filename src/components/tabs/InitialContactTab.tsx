/*
 * components/tabs/InitialContactTab.tsx
 *
 * Minimal intake surface shown under Home > Initial Contact.
 *
 * Scope is deliberately narrow — just enough to identify the caller, know how
 * to contact them, capture the organisation they represent (if any), and
 * locate the biohazard. Incident classification, urgency, and status live
 * downstream (Onsite Assessment, header metadata, etc.).
 *
 * Fields, in visual order:
 *   1. Smart Fill (paste intake source)
 *   2. Name
 *   3. Role / relationship (hint only)
 *   4. Organisation (optional)
 *   5. Phone (+ add number)
 *   6. Email
 *   7. Site address
 *   8. Site contact (if different) — collapsed by default
 *   9. Incident — Job Type + Urgency (triaged at intake, refined at assessment)
 *  10. Access notes — parking, keys, pets, discretion (free text blob)
 *  11. Call notes — append-only log (uses /api/jobs/[id]/notes)
 *
 * Everything persists via PATCH /api/jobs/[id] (or the notes append endpoint
 * for call notes). The parent's onJobUpdate is called with the fresh job
 * record so no full page reload is needed.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Job, JobType, JobUrgency, PhoneEntry } from '@/lib/types'
import SmartFill from '@/components/SmartFill'

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
}

// Converts any AU mobile format to 04xxxxxxxx (mirrors DetailsTab helper).
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

/**
 * Auto-saving text input. Commits the value on blur or Enter (single-line
 * variant) if it changed. Keeps the draft local while editing so typing is
 * smooth even with a slow network.
 */
function FieldInput({
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
    const next = draft.trim()
    if (next !== (value ?? '').trim()) onCommit(next)
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

export default function InitialContactTab({ job, onJobUpdate, readOnly = false }: Props) {
  const [saving, setSaving] = useState(false)
  const [showExtraPhones, setShowExtraPhones] = useState((job.client_phones ?? []).length > 0)
  const [showSiteContact, setShowSiteContact] = useState(
    !!(job.site_contact_name || job.site_contact_phone),
  )
  const [noteDraft, setNoteDraft] = useState('')
  const [postingNote, setPostingNote] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)

  function commitJobPatchResult(res: Response, data: { job?: Job; error?: string }): boolean {
    if (!res.ok || !data.job) {
      alert(data.error || `Save failed (${res.status})`)
      return false
    }
    onJobUpdate(data.job)
    return true
  }

  async function patchField(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      commitJobPatchResult(res, data)
    } finally {
      setSaving(false)
    }
  }

  function updatePhones(next: PhoneEntry[]) {
    return patchField({ client_phones: next })
  }

  async function addExtraPhone() {
    const next = [...(job.client_phones ?? []), { label: 'Mobile', number: '' }]
    setShowExtraPhones(true)
    await updatePhones(next)
  }

  async function updateExtraPhone(idx: number, key: 'label' | 'number', value: string) {
    const next = [...(job.client_phones ?? [])]
    next[idx] = { ...next[idx], [key]: value }
    await updatePhones(next)
  }

  async function removeExtraPhone(idx: number) {
    const next = (job.client_phones ?? []).filter((_, i) => i !== idx)
    await updatePhones(next)
  }

  async function addNote() {
    const text = noteDraft.trim()
    if (!text) return
    setPostingNote(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (commitJobPatchResult(res, data)) {
        setNoteDraft('')
        noteRef.current?.focus()
      }
    } finally {
      setPostingNote(false)
    }
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
  const hint: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }
  const fieldBlock: React.CSSProperties = { marginBottom: 18 }
  const disclosureBtn: React.CSSProperties = {
    padding: '8px 12px',
    background: 'none',
    border: '1px dashed var(--border)',
    borderRadius: 6,
    color: 'var(--text-muted)',
    fontSize: 12,
    cursor: 'pointer',
  }

  const primaryPhoneE164 = toE164(normalizeAUPhone(job.client_phone || ''))
  const noteLines = job.notes ? job.notes.split('\n').filter(Boolean) : []

  return (
    <div style={{ paddingBottom: 40 }}>
      <SmartFill
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
          if (Object.keys(updates).length === 0) return
          await patchField(updates)
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

      <fieldset
        disabled={readOnly}
        style={{ border: 'none', padding: 0, margin: 0, opacity: readOnly ? 0.7 : 1 }}
      >
        <div style={fieldBlock}>
          <label style={sectionLabel}>Name</label>
          <FieldInput
            value={job.client_name ?? ''}
            onCommit={v => patchField({ client_name: v })}
            placeholder="Who called?"
          />
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Role or relationship</label>
          <FieldInput
            value={job.client_contact_role ?? ''}
            onCommit={v => patchField({ client_contact_role: v })}
            placeholder="e.g. property manager, tenant, family member, executor, funeral director, insurer"
          />
          <div style={hint}>Free text — one line about how the caller relates to the site.</div>
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Organisation (optional)</label>
          <FieldInput
            value={job.client_organization_name ?? ''}
            onCommit={v => patchField({ client_organization_name: v })}
            placeholder="Company or account name if the caller is a representative"
          />
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Phone</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <FieldInput
                value={job.client_phone ?? ''}
                onCommit={v => patchField({ client_phone: v })}
                placeholder="04xx xxx xxx"
                type="tel"
              />
            </div>
            {job.client_phone && (
              <>
                <a href={`tel:${primaryPhoneE164}`} title="Call" style={actionBtn}>📞</a>
                <a href={`sms:${primaryPhoneE164}`} title="Text" style={actionBtn}>💬</a>
              </>
            )}
          </div>

          {showExtraPhones && (job.client_phones ?? []).map((p, i) => {
            const extraE164 = toE164(normalizeAUPhone(p.number || ''))
            return (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                <select
                  value={p.label}
                  onChange={e => updateExtraPhone(i, 'label', e.target.value)}
                  style={{ width: 100, flexShrink: 0, fontSize: 12, padding: '10px 6px' }}
                >
                  <option>Landline</option>
                  <option>Mobile</option>
                  <option>Work</option>
                  <option>Other</option>
                </select>
                <div style={{ flex: 1 }}>
                  <FieldInput
                    value={p.number}
                    onCommit={v => updateExtraPhone(i, 'number', v)}
                    placeholder="Additional number"
                    type="tel"
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

          <button
            type="button"
            onClick={() => {
              if (!showExtraPhones && (job.client_phones ?? []).length === 0) {
                addExtraPhone()
              } else if (showExtraPhones) {
                addExtraPhone()
              } else {
                setShowExtraPhones(true)
              }
            }}
            style={{ ...disclosureBtn, marginTop: 8 }}
          >
            + Add number
          </button>
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Email</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <FieldInput
                value={job.client_email ?? ''}
                onCommit={v => patchField({ client_email: v })}
                placeholder="name@example.com"
                type="email"
              />
            </div>
            {job.client_email && (
              <a href={`mailto:${job.client_email}`} title="Email" style={actionBtn}>✉️</a>
            )}
          </div>
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Site address</label>
          <FieldInput
            value={job.site_address ?? ''}
            onCommit={v => patchField({ site_address: v })}
            placeholder="Street, suburb, state, postcode"
          />
        </div>

        <div style={fieldBlock}>
          {!showSiteContact ? (
            <button
              type="button"
              onClick={() => setShowSiteContact(true)}
              style={disclosureBtn}
            >
              + Site contact (if different)
            </button>
          ) : (
            <>
              <label style={sectionLabel}>Site contact (if different)</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <FieldInput
                    value={job.site_contact_name ?? ''}
                    onCommit={v => patchField({ site_contact_name: v })}
                    placeholder="On-site contact name"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <FieldInput
                    value={job.site_contact_phone ?? ''}
                    onCommit={v => patchField({ site_contact_phone: v })}
                    placeholder="On-site contact phone"
                    type="tel"
                  />
                </div>
                {job.site_contact_phone && (
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
              <div style={hint}>
                Use when the person who opens the door isn&rsquo;t the caller (tenant,
                concierge, family member on site).
              </div>
            </>
          )}
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Incident</label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <select
              value={job.job_type}
              disabled={readOnly}
              onChange={e => patchField({ job_type: e.target.value })}
              style={{ ...fieldBox, padding: '10px 12px' }}
            >
              {JOB_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {URGENCIES.map(u => {
              const selected = job.urgency === u.value
              return (
                <button
                  key={u.value}
                  type="button"
                  disabled={readOnly}
                  onClick={() => patchField({ urgency: u.value })}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 20,
                    border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
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
          <div style={hint}>Initial triage — refine on Onsite Assessment once eyes are on site.</div>
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Access notes</label>
          <FieldInput
            value={job.access_notes ?? ''}
            onCommit={v => patchField({ access_notes: v })}
            placeholder="Parking, key handling, entry preferences, pets, hazards on site, discretion (neighbours, signage, unmarked vehicle), anything the tech should know before arriving."
            multiline
          />
          <div style={hint}>One free-text blob — no need to pre-categorise.</div>
        </div>

        <div style={fieldBlock}>
          <label style={sectionLabel}>Call notes</label>
          <textarea
            ref={noteRef}
            value={noteDraft}
            disabled={readOnly || postingNote}
            onChange={e => setNoteDraft(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                addNote()
              }
            }}
            placeholder="Anything the caller said that doesn&rsquo;t fit a field — context, constraints, emotional cues, scope hints."
            rows={3}
            style={{ ...fieldBox, resize: 'vertical', minHeight: 76, fontFamily: 'inherit' }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 6,
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={hint}>
              {noteDraft.trim()
                ? 'Cmd/Ctrl+Enter to save as a timestamped entry.'
                : 'Each entry is stamped and appended to the job log.'}
            </span>
            <button
              type="button"
              onClick={addNote}
              disabled={!noteDraft.trim() || postingNote || saving}
              className="btn btn-primary"
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              {postingNote ? 'Saving…' : 'Add note'}
            </button>
          </div>

          {noteLines.length > 0 && (
            <div
              style={{
                marginTop: 12,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--surface)',
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
                      fontSize: 12,
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
      </fieldset>
    </div>
  )
}
