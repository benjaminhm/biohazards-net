/*
 * components/tabs/TimelineTab.tsx
 *
 * Job Timeline (primary tab).
 *
 * v1 renders only the Scheduled card (datetime + schedule note) so no live
 * field is orphaned when Client Details drops scheduling. The rest of the
 * page is an empty-room placeholder reserved for:
 *   - Arrival / departure timestamps
 *   - Appointment history and reschedule audit
 *   - Lifecycle events: intake → authorisation → dispatch → completion
 *
 * Saves via PATCH /api/jobs/[id]; parent onJobUpdate refreshes in place.
 */
'use client'

import { useState } from 'react'
import type { Job } from '@/lib/types'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
  readOnly?: boolean
}

export default function TimelineTab({ job, onJobUpdate, readOnly = false }: Props) {
  const [saving, setSaving] = useState(false)

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

  const sectionLabel: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 6,
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
  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--surface)',
    padding: 16,
    marginBottom: 20,
  }
  const emptyRoomStyle: React.CSSProperties = {
    minHeight: 220,
    border: '1px dashed var(--border)',
    borderRadius: 12,
    background: 'var(--surface)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: 'var(--text-muted)',
    fontSize: 13,
    textAlign: 'center',
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <fieldset
        disabled={readOnly}
        style={{ border: 'none', padding: 0, margin: 0, opacity: readOnly ? 0.7 : 1 }}
      >
        <div style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 16 }} aria-hidden>📅</span>
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--text)',
                margin: 0,
              }}
            >
              Scheduled
            </h2>
            {saving && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saving…</span>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px 16px',
            }}
          >
            <div>
              <label style={sectionLabel}>Date &amp; time</label>
              <input
                type="datetime-local"
                value={job.scheduled_at ? job.scheduled_at.slice(0, 16) : ''}
                onChange={e =>
                  patchField({
                    scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
                style={fieldBox}
              />
            </div>
            <div>
              <label style={sectionLabel}>Scheduling note</label>
              <input
                type="text"
                defaultValue={job.schedule_note ?? ''}
                placeholder="Access details, key number, etc."
                onBlur={e => {
                  if (e.target.value !== (job.schedule_note ?? '')) {
                    patchField({ schedule_note: e.target.value })
                  }
                }}
                style={fieldBox}
              />
            </div>
          </div>
        </div>
      </fieldset>

      <div style={emptyRoomStyle}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>Timeline (coming soon)</div>
        <div>
          Arrival &amp; departure timestamps, reschedule history, and lifecycle events
          (intake → authorisation → dispatch → completion) will render here.
        </div>
      </div>
    </div>
  )
}
