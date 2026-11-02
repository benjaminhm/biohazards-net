'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'
import { brisbaneStamp, dollars } from '@/lib/jobRecords'

interface Photo {
  id: string
  step_id: string
  url: string
  device_time: string
  server_time: string
  lat: number | null
  lng: number | null
  flagged: boolean
  flag_reasons: string
}

interface Detail {
  job: {
    id: string
    job_number: string
    address: string
    client_reference: string
    job_type_label: string
    status: string
    technician_name: string
    quoted_m3: number | null
    quoted_m2: number | null
    clock_on_at: string | null
    clock_off_at: string | null
    closed_at: string | null
    callback_required: boolean
    callback_reason: string | null
    callback_open: boolean
    technician_comment: string | null
    bonus_status: string
    bonus_reason: string
    bonus_display_cents: number
  }
  steps: { id: string; position: number; title: string; step_type: string; chemical_name: string | null; dwell_minutes: number | null; dwell_started_at: string | null; note_text: string; test_text: string; checklist_items: string[]; ticks: boolean[] }[]
  notes: { id: string; body: string; created_at: string }[]
  photos: Photo[]
  audit: { id: string; action: string; created_at: string; detail: unknown }[]
}

export default function RecordJobPage() {
  const params = useParams<{ id: string }>()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  function load() {
    fetch(`/api/records/jobs/${params.id}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load this job.')
        setDetail(data)
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load this job.'))
  }

  useEffect(() => { load() }, [params.id])

  async function callback() {
    setError('')
    const res = await fetch(`/api/records/jobs/${params.id}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Could not mark the callback.')
      return
    }
    setReason('')
    load()
  }

  async function archive() {
    const res = await fetch(`/api/records/jobs/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive: true }),
    })
    if (res.ok) load()
  }

  if (!detail) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
        <ScreenBar title="Job" back="/records/jobs" />
        <p style={{ padding: 16, color: error ? '#F87171' : 'var(--text-muted)' }}>{error || 'Loading…'}</p>
      </div>
    )
  }

  const { job } = detail
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 40 }}>
      <ScreenBar title={job.job_number} sub={job.job_type_label} back="/records/jobs" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>{job.address}</div>
        <div style={{ color: 'var(--text-muted)' }}>{job.client_reference || 'No client reference'} · {job.technician_name} · {job.status.replace('_', ' ')}</div>
        {(job.quoted_m3 || job.quoted_m2) && <div>Quoted {job.quoted_m3 ? `${job.quoted_m3} m³` : `${job.quoted_m2} m²`}</div>}
        <div>Bonus {job.bonus_status.replace('_', ' ')} {job.bonus_status !== 'pending' || job.closed_at ? `· ${dollars(job.bonus_display_cents)}` : ''} {job.bonus_reason ? `· ${job.bonus_reason}` : ''}</div>
        {job.technician_comment && <div>Technician comment: {job.technician_comment}</div>}
        {job.clock_on_at && <div>Clock on {brisbaneStamp(new Date(job.clock_on_at))}</div>}
        {job.clock_off_at && <div>Clock off {brisbaneStamp(new Date(job.clock_off_at))}</div>}
        <Link href={`/records/jobs/${job.id}/report`} style={{ fontWeight: 800 }}>Completion report</Link>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {detail.steps.map(step => {
          const photos = detail.photos.filter(photo => photo.step_id === step.id)
          return (
            <section key={step.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 800 }}>{step.position}. {step.title}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{step.step_type}</div>
              {step.chemical_name && <div>{step.chemical_name}{step.dwell_minutes != null ? ` · ${step.dwell_minutes} min` : ''}{step.dwell_started_at ? ` from ${brisbaneStamp(new Date(step.dwell_started_at))}` : ''}</div>}
              {step.note_text && <div>{step.note_text}</div>}
              {step.test_text && <div>{step.test_text}</div>}
              {step.checklist_items?.map((item, index) => (
                <div key={item}>{step.ticks?.[index] ? '✓' : '○'} {item}</div>
              ))}
              {photos.map(photo => (
                <figure key={photo.id} style={{ margin: '10px 0' }}>
                  {photo.url && <img src={photo.url} alt="" style={{ width: '100%', borderRadius: 10 }} />}
                  <figcaption style={{ fontSize: 12, color: photo.flagged ? '#F87171' : 'var(--text-muted)' }}>
                    {brisbaneStamp(new Date(photo.device_time))}
                    {photo.lat != null ? ` · ${photo.lat.toFixed(5)}, ${photo.lng?.toFixed(5)}` : ''}
                    {photo.flagged ? ` · ${photo.flag_reasons}` : ''}
                  </figcaption>
                </figure>
              ))}
            </section>
          )
        })}
        {detail.notes.map(note => (
          <div key={note.id} style={{ borderLeft: '3px solid var(--border)', paddingLeft: 10 }}>
            <div>{note.body}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{brisbaneStamp(new Date(note.created_at))}</div>
          </div>
        ))}
        {job.callback_open && !job.callback_required && (
          <>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Callback reason" aria-label="Callback reason" style={{ ...fieldStyle, minHeight: 80 }} />
            <button type="button" onClick={callback} style={bigButton}>Mark callback required</button>
          </>
        )}
        {job.callback_required && <div>Callback: {job.callback_reason}</div>}
        {job.status !== 'archived' && <button type="button" onClick={archive} style={{ ...bigButton, background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' }}>Archive job</button>}
        {detail.audit.length > 0 && (
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Changes</div>
            {detail.audit.map(row => (
              <div key={row.id} style={{ fontSize: 13, color: 'var(--text-muted)' }}>{brisbaneStamp(new Date(row.created_at))} · {row.action}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
