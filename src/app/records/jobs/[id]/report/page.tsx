'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { brisbaneStamp } from '@/lib/jobRecords'

interface ReportPhoto {
  id: string
  step_id: string
  url: string
  device_time: string
}

interface ReportData {
  job: {
    job_number: string
    address: string
    client_reference: string
    job_type_label: string
    closed_at: string | null
  }
  steps: {
    id: string
    position: number
    title: string
    instruction: string
    step_type: string
    chemical_name: string | null
    dwell_minutes: number | null
    note_text: string
    test_text: string
  }[]
  photos: ReportPhoto[]
}

export default function CompletionReportPage() {
  const params = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/records/jobs/${params.id}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Could not load the report.')
        setData(body)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load the report.'))
  }, [params.id])

  if (!data) return <p style={{ padding: 24 }}>{error || 'Loading…'}</p>
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24, color: '#111', background: '#fff', minHeight: '100dvh' }}>
      <button type="button" onClick={() => window.print()} style={{ minHeight: 48, fontWeight: 800, marginBottom: 16 }}>Print</button>
      <h1 style={{ marginBottom: 4 }}>{data.job.job_number}</h1>
      <p style={{ marginTop: 0 }}>{data.job.job_type_label}</p>
      <p>{data.job.address}</p>
      {data.job.client_reference && <p>Reference {data.job.client_reference}</p>}
      {data.job.closed_at && <p>Closed {brisbaneStamp(new Date(data.job.closed_at))}</p>}
      {data.steps.map(step => (
        <section key={step.id} style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>{step.position}. {step.title}</h2>
          <p>{step.instruction}</p>
          {step.chemical_name && <p>Chemical: {step.chemical_name}{step.dwell_minutes != null ? `, ${step.dwell_minutes} minutes` : ''}</p>}
          {step.note_text && <p>{step.note_text}</p>}
          {step.test_text && <p>{step.test_text}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {data.photos.filter(photo => photo.step_id === step.id).map(photo => (
              <figure key={photo.id} style={{ margin: 0 }}>
                {photo.url && <img src={photo.url} alt="" style={{ width: '100%' }} />}
                <figcaption style={{ fontSize: 12 }}>{brisbaneStamp(new Date(photo.device_time))}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
