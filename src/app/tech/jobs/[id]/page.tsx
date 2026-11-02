'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useParams } from 'next/navigation'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'
import { awayFromSite, brisbaneStamp, dwellEndsAt, missingForClose, stepIsComplete, type StepState } from '@/lib/jobRecords'
import { readPosition, watermarkJpeg } from '@/lib/photoCapture'
import { flushPhotoQueue, pendingCount, queuePhoto } from '@/lib/photoQueue'

interface Step extends StepState {
  id: string
  position: number
  instruction: string
  chemical_name: string | null
}

interface JobPayload {
  id: string
  job_number: string
  address: string
  job_type_label: string
  status: string
  clock_on_at: string | null
  clock_off_at: string | null
  closed_at: string | null
  site_lat: number | null
  site_lng: number | null
  steps: Step[]
  notes: { id: string; body: string; created_at: string }[]
  chemicals: { id: string; name: string; dwell_minutes: number }[]
}

export default function TechJobPage() {
  const params = useParams<{ id: string }>()
  const [job, setJob] = useState<JobPayload | null>(null)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [busy, setBusy] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [chemicalId, setChemicalId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function load() {
    fetch(`/api/tech/jobs/${params.id}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load this job.')
        setJob(data)
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load this job.'))
    pendingCount(params.id).then(setPending).catch(() => {})
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const onFlush = () => load()
    window.addEventListener('fcq-photos-flushed', onFlush)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('fcq-photos-flushed', onFlush)
    }
  }, [params.id])

  async function act(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/tech/jobs/${params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'That did not work.')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  async function locateAnd(action: 'clock_on' | 'clock_off') {
    setWarning('')
    const point = await readPosition()
    if (job && point && awayFromSite(point.lat, point.lng, job.site_lat, job.site_lng)) {
      setWarning('You are more than 200 m from the job address.')
    }
    if (!point) setWarning('Location is unavailable. The time will still be recorded.')
    await act({ action, lat: point?.lat ?? null, lng: point?.lng ?? null })
  }

  async function onPhoto(file: File, step: Step) {
    if (!job) return
    setBusy(true)
    setError('')
    try {
      const point = await readPosition()
      const blob = await watermarkJpeg(file, [job.job_number, brisbaneStamp(new Date()), step.title])
      const deviceTime = new Date().toISOString()
      const form = new FormData()
      form.set('file', blob, 'photo.jpg')
      form.set('job_id', job.id)
      form.set('step_id', step.id)
      form.set('device_time', deviceTime)
      if (point) {
        form.set('lat', String(point.lat))
        form.set('lng', String(point.lng))
      }
      const res = await fetch('/api/tech/photos', { method: 'POST', body: form })
      if (!res.ok) {
        await queuePhoto({
          id: crypto.randomUUID(),
          jobId: job.id,
          stepId: step.id,
          blob,
          deviceTime,
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
        })
        setError('No signal. The photo is saved on this phone and will upload when the signal returns.')
      }
      await flushPhotoQueue()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take that photo.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!job) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
        <ScreenBar title="Job" back="/tech" />
        <p style={{ padding: 16 }}>{error || 'Loading…'}</p>
      </div>
    )
  }

  const states = job.steps
  const current = states.findIndex(step => !stepIsComplete(step, now))
  const active = current === -1 ? states.length - 1 : current
  const step = states[active]
  const doneCount = states.filter(item => stepIsComplete(item, now)).length
  const missing = missingForClose(states, pending, now)

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <ScreenBar title={job.job_number} sub={job.address} back="/tech" />
      <div style={{ height: 8, background: 'var(--surface)' }}>
        <div style={{ height: '100%', width: `${states.length ? (doneCount / states.length) * 100 : 0}%`, background: 'var(--accent)' }} />
      </div>
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 680, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {pending > 0 && <p style={{ margin: 0, fontWeight: 800 }}>{pending} upload{pending === 1 ? '' : 's'} pending</p>}
        {warning && <p style={{ margin: 0, fontWeight: 800 }}>{warning}</p>}
        {error && <p style={{ margin: 0, color: '#F87171', whiteSpace: 'pre-wrap' }}>{error}</p>}

        {notesOpen ? (
          <>
            <h1 style={{ margin: 0, fontSize: 28 }}>Note</h1>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Issue, hazard, or scope change" aria-label="Note" style={{ ...fieldStyle, minHeight: 160 }} />
            <button type="button" disabled={busy} style={bigButton} onClick={async () => { await act({ action: 'note', body: note }); setNote(''); setNotesOpen(false) }}>Save note</button>
            <button type="button" onClick={() => setNotesOpen(false)} style={ghost}>Back</button>
          </>
        ) : job.status === 'assigned' ? (
          <>
            <h1 style={{ margin: 0, fontSize: 32 }}>{job.job_type_label}</h1>
            <p style={{ margin: 0, fontSize: 18 }}>{job.address}</p>
            <button type="button" disabled={busy} style={bigButton} onClick={() => act({ action: 'accept' })}>Accept job</button>
          </>
        ) : job.status === 'accepted' ? (
          <>
            <h1 style={{ margin: 0, fontSize: 32 }}>Clock on</h1>
            <p style={{ margin: 0 }}>This records the time and your location.</p>
            <button type="button" disabled={busy} style={bigButton} onClick={() => locateAnd('clock_on')}>Clock on</button>
          </>
        ) : job.closed_at && !job.clock_off_at ? (
          <>
            <h1 style={{ margin: 0, fontSize: 32 }}>Clock off</h1>
            <p style={{ margin: 0 }}>The record is complete. Clock off before you leave.</p>
            <button type="button" disabled={busy} style={bigButton} onClick={() => locateAnd('clock_off')}>Clock off</button>
          </>
        ) : job.clock_off_at ? (
          <>
            <h1 style={{ margin: 0, fontSize: 32 }}>Done</h1>
            <p style={{ margin: 0 }}>Clocked off {brisbaneStamp(new Date(job.clock_off_at))}.</p>
          </>
        ) : step && !stepIsComplete(step, now) ? (
          <StepScreen
            step={step}
            now={now}
            busy={busy}
            chemicals={job.chemicals}
            chemicalId={chemicalId}
            setChemicalId={setChemicalId}
            fileRef={fileRef}
            onPhoto={file => onPhoto(file, step)}
            onAct={act}
          />
        ) : (
          <>
            <h1 style={{ margin: 0, fontSize: 32 }}>Close out</h1>
            {missing.length > 0 ? (
              <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul>
            ) : (
              <p style={{ margin: 0 }}>Every required step is done.</p>
            )}
            <button type="button" disabled={busy || missing.length > 0} style={bigButton} onClick={() => act({ action: 'close', pending_uploads: pending })}>Close out</button>
          </>
        )}

        {!notesOpen && job.status === 'on_site' && !job.closed_at && (
          <button type="button" onClick={() => setNotesOpen(true)} style={ghost}>Add a note</button>
        )}
        {job.notes.length > 0 && !notesOpen && job.notes.map(item => (
          <p key={item.id} style={{ margin: 0, color: 'var(--text-muted)' }}>{item.body}</p>
        ))}
      </div>
    </div>
  )
}

function StepScreen({
  step, now, busy, chemicals, chemicalId, setChemicalId, fileRef, onPhoto, onAct,
}: {
  step: Step
  now: number
  busy: boolean
  chemicals: { id: string; name: string; dwell_minutes: number }[]
  chemicalId: string
  setChemicalId: (id: string) => void
  fileRef: RefObject<HTMLInputElement | null>
  onPhoto: (file: File) => void
  onAct: (body: Record<string, unknown>) => Promise<void>
}) {
  const [text, setText] = useState(step.step_type === 'note' ? step.note_text : step.test_text)
  const [ticks, setTicks] = useState(step.ticks)
  const ends = dwellEndsAt(step)
  const remaining = ends == null ? null : Math.max(0, Math.ceil((ends - now) / 1000))

  return (
    <>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontWeight: 800 }}>Step {step.position}</p>
      <h1 style={{ margin: 0, fontSize: 30 }}>{step.title}</h1>
      <p style={{ margin: 0, fontSize: 18 }}>{step.instruction}</p>
      {(step.step_type === 'photo' || step.step_type === 'chemical') && (
        <>
          <p style={{ margin: 0 }}>{step.photo_count} photo{step.photo_count === 1 ? '' : 's'}{step.step_type === 'photo' ? ` · need ${step.min_photos}` : ''}</p>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={event => { const file = event.target.files?.[0]; if (file) onPhoto(file) }} />
          <button type="button" disabled={busy} style={bigButton} onClick={() => fileRef.current?.click()}>Take photo</button>
        </>
      )}
      {step.step_type === 'chemical' && !step.dwell_started_at && (
        <>
          <select value={chemicalId} onChange={e => setChemicalId(e.target.value)} aria-label="Chemical" style={fieldStyle}>
            <option value="">Choose chemical</option>
            {chemicals.map(item => <option key={item.id} value={item.id}>{item.name} · {item.dwell_minutes} min</option>)}
          </select>
          <button type="button" disabled={busy || !chemicalId} style={bigButton} onClick={() => onAct({ action: 'dwell', step_id: step.id, chemical_id: chemicalId })}>Start timer</button>
        </>
      )}
      {step.step_type === 'chemical' && remaining != null && (
        <p style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Dwell finished'}</p>
      )}
      {step.step_type === 'checklist' && step.checklist_items.map((item, index) => (
        <button key={item} type="button" onClick={() => setTicks(prev => prev.map((ticked, i) => i === index ? !ticked : ticked))} style={{ ...ghost, textAlign: 'left' }}>
          {ticks[index] ? '✓' : '○'} {item}
        </button>
      ))}
      {(step.step_type === 'note' || step.step_type === 'test_record') && (
        <textarea value={text} onChange={e => setText(e.target.value)} aria-label={step.title} style={{ ...fieldStyle, minHeight: 140 }} />
      )}
      {step.step_type !== 'chemical' && step.step_type !== 'photo' && (
        <button
          type="button"
          disabled={busy}
          style={bigButton}
          onClick={() => onAct({
            action: 'step',
            step_id: step.id,
            note_text: step.step_type === 'note' ? text : undefined,
            test_text: step.step_type === 'test_record' ? text : undefined,
            ticks: step.step_type === 'checklist' ? ticks : undefined,
          })}
        >
          Done
        </button>
      )}
      {!step.required && (
        <button type="button" disabled={busy} style={ghost} onClick={() => onAct({ action: 'step', step_id: step.id, skip: true })}>Skip</button>
      )}
    </>
  )
}

const ghost = {
  width: '100%',
  minHeight: 56,
  borderRadius: 14,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontWeight: 800,
  fontSize: 16,
} as const
