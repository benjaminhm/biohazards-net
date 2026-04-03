/*
 * app/jobs/new/page.tsx
 *
 * New job creation form. Sends a POST to /api/jobs on submit and redirects
 * to the new job's detail page so the user can immediately start adding
 * assessment data, photos, and documents.
 *
 * SmartFill is embedded at the top — staff can paste a client email/SMS/voicemail
 * and have Claude pre-fill client_name, client_phone, client_email, site_address,
 * job_type, and urgency from the unstructured text before manually reviewing.
 *
 * The form deliberately keeps only the essential fields for creation. All other
 * details (assessment, team, photos, documents) are added on the detail page.
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { JobType, JobUrgency } from '@/lib/types'
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

export default function NewJobPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    client_name: '',
    client_phone: '',
    client_email: '',
    site_address: '',
    job_type: 'trauma' as JobType,
    urgency: 'standard' as JobUrgency,
  })

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.client_name || !form.site_address) {
      setError('Client name and site address are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create job')
      router.push(`/jobs/${data.job.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create job')
      setSaving(false)
    }
  }

  const urgencies: JobUrgency[] = ['standard', 'urgent', 'emergency']
  const urgencyLabels = { standard: '⚪ Standard', urgent: '🟠 Urgent', emergency: '🔴 Emergency' }

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/">
            <button className="btn btn-ghost" style={{ padding: '8px 0' }}>← Back</button>
          </Link>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>New Job</h1>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 540 }}>
        <SmartFill
          defaultOpen
          onApply={fields => {
            const allowed = ['client_name', 'client_phone', 'client_email', 'site_address', 'job_type', 'urgency']
            const updates: Partial<typeof form> = {}
            for (const key of allowed) {
              if (fields[key]) updates[key as keyof typeof form] = fields[key] as JobType & JobUrgency & string
            }
            setForm(f => ({ ...f, ...updates }))
          }}
        />
        <form data-devid="P5-E1" onSubmit={submit}>
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: 12, color: '#F87171', marginBottom: 24, fontSize: 14 }}>
              {error}
            </div>
          )}

          <div className="field">
            <label>Client Name *</label>
            <input
              data-devid="P5-E2"
              type="text"
              value={form.client_name}
              onChange={e => set('client_name', e.target.value)}
              placeholder="Full name or organisation"
              autoFocus
            />
          </div>

          <div className="field">
            <label>Phone</label>
            <input
              type="tel"
              value={form.client_phone}
              onChange={e => set('client_phone', e.target.value)}
              placeholder="04xx xxx xxx"
            />
          </div>

          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={form.client_email}
              onChange={e => set('client_email', e.target.value)}
              placeholder="email@example.com"
            />
          </div>

          <div className="field">
            <label>Site Address *</label>
            <input
              data-devid="P5-E3"
              type="text"
              value={form.site_address}
              onChange={e => set('site_address', e.target.value)}
              placeholder="Full street address"
            />
          </div>

          <div className="field">
            <label>Job Type</label>
            <select data-devid="P5-E4" value={form.job_type} onChange={e => set('job_type', e.target.value)}>
              {JOB_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Urgency</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {urgencies.map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => set('urgency', u)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    borderRadius: 8,
                    border: `2px solid ${form.urgency === u ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.urgency === u ? 'var(--accent-dim)' : 'var(--surface-2)',
                    color: form.urgency === u ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: 13,
                    transition: 'all 0.15s',
                  }}
                >
                  {urgencyLabels[u]}
                </button>
              ))}
            </div>
          </div>

          <button
            data-devid="P5-E6"
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ width: '100%', padding: '14px', fontSize: 16, marginTop: 8 }}
          >
            {saving ? <><span className="spinner" /> Creating...</> : 'Create Job'}
          </button>
        </form>
      </div>
    </div>
  )
}
