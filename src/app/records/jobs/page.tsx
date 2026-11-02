'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'
import { JOB_TYPE_LABEL, RECORD_JOB_TYPES, needsQuote, type RecordJobType } from '@/lib/jobRecords'

interface JobRow {
  id: string
  job_number: string
  address: string
  job_type_label: string
  status: string
  technician_name: string
}

interface Person {
  id: string
  name: string
  phone_sign_in: boolean
  app_role: string | null
}

export default function RecordJobsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    address: '',
    client_reference: '',
    job_type: 'biohazard' as RecordJobType,
    quoted_m3: '',
    quoted_m2: '',
    assigned_person_id: '',
    lead: false,
    lead_uplift_percent: '0',
  })

  function load(nextStatus = status) {
    const query = nextStatus ? `?status=${encodeURIComponent(nextStatus)}` : ''
    fetch(`/api/records/jobs${query}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load jobs.')
        setJobs(data.jobs ?? [])
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load jobs.'))
  }

  useEffect(() => {
    load('')
    fetch('/api/records/sign-in')
      .then(res => res.json())
      .then(data => setPeople((data.people ?? []).filter((person: Person) => person.phone_sign_in && person.app_role === 'member')))
      .catch(() => {})
  }, [])

  const quote = needsQuote(form.job_type)

  async function create(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/records/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          quoted_m3: form.quoted_m3 === '' ? null : Number(form.quoted_m3),
          quoted_m2: form.quoted_m2 === '' ? null : Number(form.quoted_m2),
          lead_uplift_percent: Number(form.lead_uplift_percent || 0),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not create the job.')
      setForm({ ...form, address: '', client_reference: '', quoted_m3: '', quoted_m2: '' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the job.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 32 }}>
      <ScreenBar title="Jobs" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
          <div style={{ fontWeight: 800 }}>New job</div>
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" aria-label="Address" style={fieldStyle} />
          <input value={form.client_reference} onChange={e => setForm({ ...form, client_reference: e.target.value })} placeholder="Client reference" aria-label="Client reference" style={fieldStyle} />
          <select value={form.job_type} onChange={e => setForm({ ...form, job_type: e.target.value as RecordJobType })} aria-label="Job type" style={fieldStyle}>
            {RECORD_JOB_TYPES.map(item => <option key={item} value={item}>{JOB_TYPE_LABEL[item]}</option>)}
          </select>
          {quote === 'm3' && <input value={form.quoted_m3} onChange={e => setForm({ ...form, quoted_m3: e.target.value })} placeholder="Quoted m³" aria-label="Quoted cubic metres" inputMode="decimal" style={fieldStyle} />}
          {quote === 'm2' && <input value={form.quoted_m2} onChange={e => setForm({ ...form, quoted_m2: e.target.value })} placeholder="Quoted m²" aria-label="Quoted square metres" inputMode="decimal" style={fieldStyle} />}
          <select value={form.assigned_person_id} onChange={e => setForm({ ...form, assigned_person_id: e.target.value })} aria-label="Technician" style={fieldStyle}>
            <option value="">Technician</option>
            {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <input type="checkbox" checked={form.lead} onChange={e => setForm({ ...form, lead: e.target.checked })} />
            This technician is the lead
          </label>
          {form.lead && <input value={form.lead_uplift_percent} onChange={e => setForm({ ...form, lead_uplift_percent: e.target.value })} placeholder="Lead uplift %" aria-label="Lead uplift percent" inputMode="decimal" style={fieldStyle} />}
          <button type="submit" disabled={creating} style={bigButton}>{creating ? 'Creating…' : 'Create job'}</button>
        </form>
        {error && <p style={{ margin: 0, color: '#F87171', whiteSpace: 'pre-wrap' }}>{error}</p>}
        <select value={status} onChange={e => { setStatus(e.target.value); load(e.target.value) }} aria-label="Status" style={fieldStyle}>
          <option value="">Active</option>
          <option value="assigned">Assigned</option>
          <option value="accepted">Accepted</option>
          <option value="on_site">On site</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </select>
        {jobs.map(job => (
          <Link key={job.id} href={`/records/jobs/${job.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 800 }}>{job.job_number} · {job.job_type_label}</div>
              <div style={{ marginTop: 4 }}>{job.address}</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{job.technician_name} · {job.status.replace('_', ' ')}</div>
            </div>
          </Link>
        ))}
        {jobs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No jobs yet.</p>}
      </div>
    </div>
  )
}
