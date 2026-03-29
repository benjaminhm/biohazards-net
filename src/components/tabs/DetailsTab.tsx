'use client'

import { useState } from 'react'
import type { Job, JobStatus, JobType, JobUrgency } from '@/lib/types'
import SmartFill from '@/components/SmartFill'

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
          <button className="btn btn-primary" onClick={save} style={{ padding: '10px 16px', fontSize: 13 }}>Save</button>
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
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${job.client_name}`,
      job.client_phone ? `TEL;TYPE=CELL:${job.client_phone}` : '',
      job.client_email ? `EMAIL:${job.client_email}` : '',
      job.site_address ? `ADR;TYPE=HOME:;;${job.site_address};;;;` : '',
      `NOTE:${job.job_type.replace(/_/g, ' ')} — biohazards.net`,
      'END:VCARD',
    ].filter(Boolean).join('\n')

    const blob = new Blob([vcard], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${job.client_name.replace(/\s+/g, '_')}.vcf`
    a.click()
    URL.revokeObjectURL(url)
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

        {/* Phone with actions */}
        <div className="field">
          <label>Phone</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <EditableField label="" value={job.client_phone} onChange={v => updateField('client_phone', v)} type="tel" />
            </div>
            {job.client_phone && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <a href={`tel:${job.client_phone.replace(/\s/g, '')}`} title="Call" style={actionBtn}>📞</a>
                <a href={`sms:${job.client_phone.replace(/\s/g, '')}`} title="Text" style={actionBtn}>💬</a>
              </div>
            )}
          </div>
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
