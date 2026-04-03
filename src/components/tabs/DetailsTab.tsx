/*
 * components/tabs/DetailsTab.tsx
 *
 * The Details tab on the job detail page. Manages all top-level job fields:
 * client info, site address, job type, status, urgency, scheduled datetime,
 * notes, and the phone book (PhoneEntry[]). Also shows the assigned team.
 *
 * Key behaviours:
 *   - SmartFill is embedded at the top so staff can paste a text/email/voicemail
 *     and have Claude pre-fill client_name, client_phone, site_address, etc.
 *   - Phone entries support multiple contacts per job (next of kin, agent, etc.).
 *     Each is stored as { label, phone, note } in assessment_data.phones.
 *   - normalizeAUPhone() and toE164() handle the inconsistent phone formats
 *     that arrive from clients and third parties.
 *   - extractSuburb() parses a structured address string to derive a suburb
 *     token for display badges and SMS templates.
 *   - All changes are saved via PATCH /api/jobs/[id]. The tab calls onJobUpdate
 *     with the server response so the parent can keep its own state in sync
 *     without a full page reload.
 *
 * Team assignments are read-only here — managed via the Team tab instead.
 */
'use client'

import { useState, useEffect } from 'react'
import type { Job, JobStatus, JobType, JobUrgency, PhoneEntry } from '@/lib/types'
import SmartFill from '@/components/SmartFill'

interface Person { id: string; name: string; role: string; phone: string; email: string; status: string }
interface Assignment { id: string; person_id: string; people: Person }

// ── Phone normalisation ──────────────────────────────────────────────────────
// Converts any AU mobile format to 04xxxxxxxx
function normalizeAUPhone(raw: string): string {
  if (!raw) return raw
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, '')
  if (cleaned.startsWith('+614')) return '0' + cleaned.slice(3)   // +614xx → 04xx
  if (cleaned.startsWith('+61')) return '0' + cleaned.slice(3)    // +610x  → 0x
  if (cleaned.startsWith('614')) return '0' + cleaned.slice(2)    // 614xx  → 04xx
  return cleaned
}

// Converts 04xxxxxxxx to +61xxxxxxxx (E.164 international format)
function toE164(phone: string): string {
  if (!phone) return ''
  const cleaned = phone.replace(/\s/g, '')
  if (cleaned.startsWith('0')) return '+61' + cleaned.slice(1)
  if (cleaned.startsWith('+61')) return cleaned
  return cleaned
}

// Extracts suburb from an Australian address string
// "42 Smith St, Newstead QLD 4006" → "Newstead"
function extractSuburb(address: string): string {
  if (!address) return ''
  const parts = address.split(',')
  if (parts.length >= 2) {
    // Second part typically: "Newstead QLD 4006" or " Suburb State Postcode"
    const raw = parts[1].trim()
    return raw.replace(/\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\b.*/i, '').replace(/\d{4,}.*/, '').trim()
  }
  // No comma — try last word group before state/postcode
  const match = address.match(/([A-Za-z\s]+?)(?:\s+(?:QLD|NSW|VIC|WA|SA|TAS|ACT|NT))?(?:\s+\d{4})?$/i)
  return match ? match[1].trim().split(/\s+/).slice(-2).join(' ') : ''
}

// ─────────────────────────────────────────────────────────────────────────────

const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'crime_scene', label: 'Crime Scene' },
  { value: 'hoarding', label: 'Hoarding' },
  { value: 'mold', label: 'Mold' },
  { value: 'sewage', label: 'Sewage' },
  { value: 'trauma', label: 'Trauma' },
  { value: 'unattended_death', label: 'Unattended Death' },
  { value: 'flood', label: 'Flood' },
  { value: 'other', label: 'Other' },
]

const STATUSES: { value: JobStatus; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'assessed', label: 'Assessed' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'accepted', label: 'Accepted ✓' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'underway', label: 'Underway' },
  { value: 'completed', label: 'Completed' },
  { value: 'report_sent', label: 'Report Sent' },
  { value: 'paid', label: 'Paid' },
]

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function EditableField({
  label, value, onChange, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function save() {
    onChange(draft)
    setEditing(false)
  }

  return (
    <div className="field">
      <label>{label}</label>
      {editing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            autoFocus
          />
          <button data-devid="P2-E5" className="btn btn-primary" onClick={save} style={{ padding: '10px 16px', fontSize: 13 }}>Save</button>
          <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ padding: '10px 12px', fontSize: 13 }}>✕</button>
        </div>
      ) : (
        <div
          onClick={() => { setDraft(value); setEditing(true) }}
          style={{
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'text',
            minHeight: 40,
            color: value ? 'var(--text)' : 'var(--text-muted)',
            fontSize: 15,
          }}
        >
          {value || <span style={{ fontStyle: 'italic' }}>Click to edit</span>}
        </div>
      )}
    </div>
  )
}

export default function DetailsTab({ job, onJobUpdate }: Props) {
  const [saving, setSaving] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')

  async function updateNotes(newLines: string[]) {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: newLines.join('\n') }),
    })
    const data = await res.json()
    onJobUpdate(data.job)
  }

  async function deleteNote(idx: number) {
    if (!confirm('Delete this note?')) return
    const lines = job.notes ? job.notes.split('\n').filter(Boolean) : []
    lines.splice(idx, 1)
    await updateNotes(lines)
  }

  async function saveEditedNote(idx: number) {
    const lines = job.notes ? job.notes.split('\n').filter(Boolean) : []
    const match = lines[idx].match(/^\[(.+?)\] .+$/)
    const timestamp = match ? match[1] : new Date().toLocaleString('en-AU')
    lines[idx] = `[${timestamp}] ${editingNoteText}`
    await updateNotes(lines)
    setEditingNoteIdx(null)
    setEditingNoteText('')
  }

  async function updateField(field: string, value: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await res.json()
      onJobUpdate(data.job)
    } finally {
      setSaving(false)
    }
  }

  async function addNote() {
    if (!noteText.trim()) return
    setAddingNote(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteText }),
      })
      const data = await res.json()
      onJobUpdate(data.job)
      setNoteText('')
    } finally {
      setAddingNote(false)
    }
  }

  function downloadVCard() {
    const serviceLabel = JOB_TYPES.find(t => t.value === job.job_type)?.label ?? job.job_type
    const suburb = extractSuburb(job.site_address)
    // Contact name: "John Smith · Unattended Death · Newstead"
    const contactName = [job.client_name, serviceLabel, suburb].filter(Boolean).join(' · ')

    // Primary number — both formats so phone matches +61 incoming texts
    const phone04 = normalizeAUPhone(job.client_phone)
    const phone61 = toE164(phone04)

    // Additional numbers
    const extraPhoneLines = (job.client_phones ?? []).flatMap(p => {
      const n04 = normalizeAUPhone(p.number)
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
      `NOTE:${serviceLabel}${suburb ? ' · ' + suburb : ''} — biohazards.net`,
      'END:VCARD',
    ].filter(Boolean).join('\n')

    const blob = new Blob([vcard], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${contactName.replace(/[^a-zA-Z0-9]+/g, '_')}.vcf`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Auto-normalise phone to 04xx when saving
  async function updatePhone(raw: string) {
    await updateField('client_phone', normalizeAUPhone(raw))
  }

  async function saveExtraPhones(phones: PhoneEntry[]) {
    await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_phones: phones }),
    }).then(r => r.json()).then(d => onJobUpdate(d.job))
  }

  function addExtraPhone() {
    const updated = [...(job.client_phones ?? []), { label: 'Landline', number: '' }]
    saveExtraPhones(updated)
  }

  function updateExtraPhone(idx: number, field: keyof PhoneEntry, value: string) {
    const updated = (job.client_phones ?? []).map((p, i) =>
      i === idx ? { ...p, [field]: field === 'number' ? normalizeAUPhone(value) : value } : p
    )
    saveExtraPhones(updated)
  }

  function removeExtraPhone(idx: number) {
    saveExtraPhones((job.client_phones ?? []).filter((_, i) => i !== idx))
  }

  const urgencies: JobUrgency[] = ['standard', 'urgent', 'emergency']
  const urgencyLabels = { standard: '⚪ Standard', urgent: '🟠 Urgent', emergency: '🔴 Emergency' }
  const noteLines = job.notes ? job.notes.split('\n').filter(Boolean) : []

  return (
    <div style={{ paddingBottom: 40 }}>

      <SmartFill
        onApply={async (fields) => {
          const allowed = ['client_name', 'client_phone', 'client_email', 'site_address', 'job_type', 'urgency']
          const updates: Record<string, string> = {}
          for (const key of allowed) {
            if (fields[key]) updates[key] = fields[key]
          }
          setSaving(true)
          try {
            const res = await fetch(`/api/jobs/${job.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updates),
            })
            const data = await res.json()
            onJobUpdate(data.job)
          } finally {
            setSaving(false)
          }
        }}
        onSourceText={async (text) => {
          await fetch(`/api/jobs/${job.id}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `Smart fill source: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}` }),
          })
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <div className="field">
          <label>Client Name</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <EditableField label="" value={job.client_name} onChange={v => updateField('client_name', v)} />
            </div>
            {job.client_name && (
              <button onClick={downloadVCard} title="Save contact to phone" style={actionBtn}>💾</button>
            )}
          </div>
        </div>

        {/* Phone — primary + additional numbers */}
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Phone Numbers</label>

          {/* Primary mobile */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <div style={{ width: 90, flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 0 0 2px', fontWeight: 600 }}>Mobile</div>
            </div>
            <div style={{ flex: 1 }}>
              <EditableField label="" value={job.client_phone} onChange={v => updatePhone(v)} type="tel" />
            </div>
            {job.client_phone && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <a href={`tel:${toE164(normalizeAUPhone(job.client_phone))}`} title="Call" style={actionBtn}>📞</a>
                <a href={`sms:${toE164(normalizeAUPhone(job.client_phone))}`} title="Text" style={actionBtn}>💬</a>
              </div>
            )}
          </div>

          {/* Extra numbers */}
          {(job.client_phones ?? []).map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <select
                value={p.label}
                onChange={e => updateExtraPhone(i, 'label', e.target.value)}
                style={{ width: 90, flexShrink: 0, fontSize: 12, padding: '10px 6px' }}
              >
                <option>Landline</option>
                <option>Mobile</option>
                <option>Work</option>
                <option>Other</option>
              </select>
              <div style={{ flex: 1 }}>
                <EditableField label="" value={p.number} onChange={v => updateExtraPhone(i, 'number', v)} type="tel" />
              </div>
              {p.number && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <a href={`tel:${toE164(normalizeAUPhone(p.number))}`} title="Call" style={actionBtn}>📞</a>
                  <a href={`sms:${toE164(normalizeAUPhone(p.number))}`} title="Text" style={actionBtn}>💬</a>
                </div>
              )}
              <button onClick={() => removeExtraPhone(i)} title="Remove" style={{ ...actionBtn, color: '#F87171' }}>×</button>
            </div>
          ))}

          <button
            onClick={addExtraPhone}
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: '1px dashed var(--border)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', marginTop: 2 }}
          >
            + Add number
          </button>
        </div>

        {/* Email with action */}
        <div className="field">
          <label>Email</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <EditableField label="" value={job.client_email} onChange={v => updateField('client_email', v)} type="email" />
            </div>
            {job.client_email && (
              <a href={`mailto:${job.client_email}`} title="Send email" style={actionBtn}>✉️</a>
            )}
          </div>
        </div>

        <div className="field">
          <label>Job Type</label>
          <select value={job.job_type} onChange={e => updateField('job_type', e.target.value)}>
            {JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Site Address</label>
        <EditableField label="" value={job.site_address} onChange={v => updateField('site_address', v)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <div className="field">
          <label>Status</label>
          <select value={job.status} onChange={e => updateField('status', e.target.value)}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Urgency</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {urgencies.map(u => (
              <button
                key={u}
                onClick={() => updateField('urgency', u)}
                style={{
                  flex: 1, padding: '9px 4px', borderRadius: 6,
                  border: `2px solid ${job.urgency === u ? 'var(--accent)' : 'var(--border)'}`,
                  background: job.urgency === u ? 'var(--accent-dim)' : 'var(--surface-2)',
                  color: job.urgency === u ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: 600, fontSize: 12, transition: 'all 0.15s',
                }}
              >
                {urgencyLabels[u]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {saving && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Saving...</div>}

      <hr className="divider" />

      {/* Scheduling */}
      <div style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', display: 'block', marginBottom: 12 }}>
          📅 Scheduling
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
          <div className="field">
            <label>Date &amp; Time</label>
            <input
              type="datetime-local"
              value={job.scheduled_at ? job.scheduled_at.slice(0, 16) : ''}
              onChange={e => updateField('scheduled_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
            />
          </div>
          <div className="field">
            <label>Scheduling Note</label>
            <input
              type="text"
              defaultValue={job.schedule_note ?? ''}
              placeholder="Access details, key number, etc."
              onBlur={e => { if (e.target.value !== (job.schedule_note ?? '')) updateField('schedule_note', e.target.value) }}
            />
          </div>
        </div>
      </div>

      <hr className="divider" />

      {/* Team */}
      <TeamSection jobId={job.id} />

      <hr className="divider" />

      {/* Notes log */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ marginBottom: 12 }}>Notes Log</label>
        {noteLines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>No notes yet.</div>
        )}
        {noteLines.map((line, i) => {
          const match = line.match(/^\[(.+?)\] (.+)$/)
          const timestamp = match ? match[1] : ''
          const text = match ? match[2] : line
          return (
            <div key={i} style={{ marginBottom: 10, padding: '10px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
              {editingNoteIdx === i ? (
                <div>
                  <textarea
                    value={editingNoteText}
                    onChange={e => setEditingNoteText(e.target.value)}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical', marginBottom: 8 }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => saveEditedNote(i)}>Save</button>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setEditingNoteIdx(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    {timestamp && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{timestamp}</div>}
                    <div style={{ fontSize: 14 }}>{text}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => { setEditingNoteIdx(i); setEditingNoteText(text) }}
                      title="Edit note"
                      style={{ ...noteActionBtn }}
                    >✏️</button>
                    <button
                      onClick={() => deleteNote(i)}
                      title="Delete note"
                      style={{ ...noteActionBtn }}
                    >🗑️</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          style={{ resize: 'vertical' }}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) addNote() }}
        />
        <button
          onClick={addNote}
          disabled={!noteText.trim() || addingNote}
          className="btn btn-primary"
          style={{ padding: '10px 16px', fontSize: 13, alignSelf: 'flex-end', flexShrink: 0 }}
        >
          {addingNote ? <span className="spinner" /> : 'Add Note'}
        </button>
      </div>
    </div>
  )
}

function TeamSection({ jobId }: { jobId: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [people, setPeople]           = useState<Person[]>([])
  const [loading, setLoading]         = useState(true)
  const [adding, setAdding]           = useState(false)
  const [selectedId, setSelectedId]   = useState('')
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/jobs/${jobId}/team`).then(r => r.json()),
      fetch('/api/people').then(r => r.json()),
    ]).then(([teamRes, peopleRes]) => {
      setAssignments(teamRes.assignments ?? [])
      setPeople((peopleRes.people ?? []).filter((p: Person) => p.status === 'active'))
    }).finally(() => setLoading(false))
  }, [jobId])

  const assignedIds = new Set(assignments.map(a => a.person_id))
  const available   = people.filter(p => !assignedIds.has(p.id))

  async function addPerson() {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/team`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: selectedId }),
      })
      const data = await res.json()
      if (data.assignment) setAssignments(a => [...a, data.assignment])
      setSelectedId(''); setAdding(false)
    } finally { setSaving(false) }
  }

  async function removePerson(personId: string) {
    await fetch(`/api/jobs/${jobId}/team/${personId}`, { method: 'DELETE' })
    setAssignments(a => a.filter(x => x.person_id !== personId))
  }

  const roleColors: Record<string, string> = { employee: '#3B82F6', subcontractor: '#8B5CF6', admin: '#F59E0B' }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', margin: 0 }}>
          👥 Assigned Team
        </label>
        {!adding && available.length > 0 && (
          <button onClick={() => setAdding(true)}
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            + Add
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : assignments.length === 0 && !adding ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No team assigned yet.{available.length > 0 ? ' Tap + Add to dispatch someone.' : ' Add team members in the Team section first.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assignments.map(a => {
            const p = a.people
            const color = roleColors[p.role] ?? '#888'
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: color + '22', border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>
                  {p.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p.role}</div>
                </div>
                {p.phone && (
                  <a href={`tel:${p.phone.replace(/\s/g, '')}`} title="Call" style={{ fontSize: 18, textDecoration: 'none', flexShrink: 0 }}>📞</a>
                )}
                {p.phone && (
                  <a href={`sms:${p.phone.replace(/\s/g, '')}`} title="Text" style={{ fontSize: 18, textDecoration: 'none', flexShrink: 0 }}>💬</a>
                )}
                <button onClick={() => removePerson(a.person_id)} title="Remove"
                  style={{ fontSize: 14, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0, padding: '4px' }}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Select team member…</option>
            {available.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
            ))}
          </select>
          <button onClick={addPerson} disabled={!selectedId || saving}
            style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: !selectedId || saving ? 0.5 : 1 }}>
            {saving ? '…' : 'Assign'}
          </button>
          <button onClick={() => { setAdding(false); setSelectedId('') }}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 36, height: 36, borderRadius: 6, fontSize: 16, flexShrink: 0,
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  textDecoration: 'none', cursor: 'pointer', transition: 'background 0.15s',
}

const noteActionBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 5,
  padding: '3px 7px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)',
  transition: 'all 0.15s',
}
