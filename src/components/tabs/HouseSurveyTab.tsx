'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import {
  emptyHouseSurvey,
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

  useEffect(() => {
    setSurvey(normalizeHouseSurvey(job.assessment_data?.house_survey))
  }, [job.id, job.updated_at])

  const isDirty = !sameSurvey(survey, saved)
  useRegisterUnsavedChanges('house-survey', isDirty)

  const trace = useMemo(() => traceHouseSurvey(survey.legs), [survey.legs])
  const sketch = useMemo(() => surveySketchPath(trace.points), [trace.points])

  function patchLeg(id: string, next: Partial<HouseSurveyLeg>) {
    setSurvey(prev => ({
      ...prev,
      legs: prev.legs.map(leg => (leg.id === id ? { ...leg, ...next } : leg)),
    }))
    setSavedFlash(false)
  }

  async function save(next = survey): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: { ...merged, house_survey: next } }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      onJobUpdate(data.job)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, paddingBottom: 120 }}>
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
      {sketch && (
        <svg
          viewBox={`0 0 ${sketch.width} ${sketch.height}`}
          width="100%"
          height={220}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16 }}
        >
          <polyline points={sketch.d} fill="none" stroke="#93c5fd" strokeWidth="2" />
          <circle cx={sketch.d.split(' ')[0]?.split(',')[0]} cy={sketch.d.split(' ')[0]?.split(',')[1]} r="4" fill="#86efac" />
        </svg>
      )}
      <p style={{ fontSize: 14, marginBottom: 16 }}>
        {trace.points.length < 2
          ? 'Add the first wall.'
          : trace.closed
            ? `Closed. Perimeter ${trace.perimeter} m. Floor ${trace.area} m².`
            : `Open. Short by ${trace.gap} m. Perimeter so far ${trace.perimeter} m.`}
      </p>
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
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 25,
          background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
          padding: '10px 16px max(12px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {saveError && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }}>{saveError}</div>}
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !isDirty}
            onClick={() => void save()}
            style={{ width: '100%', padding: 12, fontWeight: 700 }}
          >
            {saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save survey'}
          </button>
        </div>
      </div>
    </div>
  )
}
