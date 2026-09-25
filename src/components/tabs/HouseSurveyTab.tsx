'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import {
  newHouseSurveyLeg,
  normalizeHouseSurvey,
  surveySketchPath,
  traceHouseSurvey,
  type HouseSurveyCapture,
  type HouseSurveyLeg,
} from '@/lib/houseSurvey'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
}

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}

function sameSurvey(a: HouseSurveyCapture, b: HouseSurveyCapture): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function HouseSurveyTab({ job, onJobUpdate }: Props) {
  const saved = useMemo(
    () => normalizeHouseSurvey(job.assessment_data?.house_survey),
    [job.assessment_data?.house_survey],
  )
  const [survey, setSurvey] = useState<HouseSurveyCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')
  const jobRef = useRef(job)
  const surveyRef = useRef(survey)
  const saveSeq = useRef(0)
  const dirtyRef = useRef(false)
  jobRef.current = job
  surveyRef.current = survey

  const isDirty = !sameSurvey(survey, saved)
  dirtyRef.current = isDirty
  useRegisterUnsavedChanges('house-survey', isDirty)

  useEffect(() => {
    if (dirtyRef.current) return
    setSurvey(normalizeHouseSurvey(job.assessment_data?.house_survey))
  }, [job.id, job.assessment_data?.house_survey])

  useEffect(() => {
    if (sameSurvey(survey, saved)) return
    const handle = window.setTimeout(() => {
      void save(survey)
    }, 500)
    return () => window.clearTimeout(handle)
  }, [survey, saved])

  const trace = useMemo(() => traceHouseSurvey(survey.legs), [survey.legs])
  const sketch = useMemo(() => surveySketchPath(trace.points), [trace.points])
  const start = sketch?.d.split(' ')[0]?.split(',')

  function patchLeg(id: string, next: Partial<HouseSurveyLeg>) {
    setSurvey(prev => ({
      ...prev,
      legs: prev.legs.map(leg => (leg.id === id ? { ...leg, ...next } : leg)),
    }))
    setSavedFlash(false)
  }

  async function save(next: HouseSurveyCapture): Promise<boolean> {
    const seq = ++saveSeq.current
    setSaving(true)
    setSaveError('')
    try {
      const current = jobRef.current
      const merged = mergeAssessmentData(current.assessment_data)
      const res = await fetch(`/api/jobs/${current.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: { ...merged, house_survey: next } }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      if (seq !== saveSeq.current) return false
      onJobUpdate(data.job)
      if (sameSurvey(surveyRef.current, next)) setSavedFlash(true)
      return true
    } catch (e) {
      if (seq === saveSeq.current) setSaveError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      if (seq === saveSeq.current) setSaving(false)
    }
  }

  const status = trace.points.length < 2
    ? 'Add the first wall.'
    : trace.closed
      ? `Closed. Perimeter ${trace.perimeter} m. Floor ${trace.area} m².`
      : `Open. Short by ${trace.gap} m. Perimeter so far ${trace.perimeter} m.`

  return (
    <div style={{ maxWidth: 720, paddingBottom: 48 }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          marginBottom: 16,
          padding: 12,
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        {sketch ? (
          <svg
            viewBox={`0 0 ${sketch.width} ${sketch.height}`}
            width="100%"
            height={180}
            style={{ display: 'block', background: 'var(--surface)', borderRadius: 8 }}
          >
            <polyline points={sketch.d} fill="none" stroke="#93c5fd" strokeWidth="2" />
            {start && <circle cx={start[0]} cy={start[1]} r="4" fill="#86efac" />}
          </svg>
        ) : (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 8 }}>
            The plan appears here as you add walls.
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 10, fontSize: 13 }}>
          <span>{status}</span>
          <span style={{ color: saveError ? '#F87171' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {saveError || (saving ? 'Saving…' : savedFlash ? 'Saved' : '')}
          </span>
        </div>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        One walk of the whole house. Start at the front door and follow the inside of the walls clockwise.
        Each wall is a left or right turn, then its length, until the line meets the start.
      </p>
      <div style={{ marginBottom: 16 }}>
        <label style={LABEL}>Where you started</label>
        <input
          type="text"
          value={survey.start_note}
          onChange={e => {
            setSurvey(prev => ({ ...prev, start_note: e.target.value }))
            setSavedFlash(false)
          }}
          placeholder="Front door, left side"
          style={INPUT}
        />
      </div>
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        {survey.legs.map((leg, index) => (
          <div
            key={leg.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '72px 1fr 1fr auto',
              gap: 8,
              alignItems: 'end',
              padding: 12,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <div style={{ fontWeight: 700, paddingBottom: 8 }}>Wall {index + 1}</div>
            <div>
              <label style={LABEL}>Turn</label>
              <select
                value={leg.turn}
                onChange={e => patchLeg(leg.id, { turn: e.target.value === 'left' ? 'left' : 'right' })}
                style={INPUT}
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </div>
            <div>
              <label style={LABEL}>Length (m)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={leg.length_m ?? ''}
                onChange={e => {
                  const raw = e.target.value
                  patchLeg(leg.id, { length_m: raw === '' ? null : Number(raw) })
                }}
                placeholder="0.00"
                style={INPUT}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSurvey(prev => ({ ...prev, legs: prev.legs.filter(row => row.id !== leg.id) }))
                setSavedFlash(false)
              }}
              style={{ background: 'none', border: 'none', color: '#F87171', fontWeight: 700, cursor: 'pointer', paddingBottom: 8 }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          setSurvey(prev => ({ ...prev, legs: [...prev.legs, newHouseSurveyLeg()] }))
          setSavedFlash(false)
        }}
        style={{ width: '100%', marginBottom: 18, padding: 12, fontWeight: 700 }}
      >
        + Another wall
      </button>
    </div>
  )
}
