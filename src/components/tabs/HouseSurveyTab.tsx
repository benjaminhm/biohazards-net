'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import {
  newHouseSurveyArea,
  newHouseSurveyLeg,
  normalizeHouseSurvey,
  surveySketchPath,
  traceHouseSurvey,
  type HouseSurveyArea,
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

  const plans = useMemo(
    () => survey.areas.map(area => {
      const trace = traceHouseSurvey(area.legs)
      return { area, trace, sketch: surveySketchPath(trace.points) }
    }),
    [survey.areas],
  )

  function touch() {
    setSavedFlash(false)
  }

  function patchArea(id: string, next: Partial<HouseSurveyArea>) {
    setSurvey(prev => ({
      ...prev,
      areas: prev.areas.map(area => (area.id === id ? { ...area, ...next } : area)),
    }))
    touch()
  }

  function patchLeg(areaId: string, legId: string, next: Partial<HouseSurveyLeg>) {
    setSurvey(prev => ({
      ...prev,
      areas: prev.areas.map(area => area.id === areaId
        ? { ...area, legs: area.legs.map(leg => (leg.id === legId ? { ...leg, ...next } : leg)) }
        : area),
    }))
    touch()
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

  function areaStatus(trace: ReturnType<typeof traceHouseSurvey>): string {
    if (trace.points.length < 2) return 'Add the first wall.'
    if (trace.closed) return `Closed. Perimeter ${trace.perimeter} m. Floor ${trace.area} m².`
    return `Open. Short by ${trace.gap} m. Perimeter so far ${trace.perimeter} m.`
  }

  return (
    <div className="house-survey" style={{ paddingBottom: 48 }}>
      <style>{`
        .house-survey-grid { display: grid; gap: 16px; align-items: start; }
        .house-survey-plan { order: -1; position: sticky; top: 0; z-index: 20; }
        @media (min-width: 900px) {
          .house-survey-grid { grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.9fr); }
          .house-survey-plan { order: 0; top: 12px; }
        }
      `}</style>
      <div className="house-survey-grid">
      <div>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        Each area is its own clockwise walk. Title it, describe it, then add walls until that area closes. Start another area for the next part of the house.
      </p>
      <div style={{ display: 'grid', gap: 16 }}>
        {survey.areas.map((area, areaIndex) => (
          <section
            key={area.id}
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 800 }}>Area {areaIndex + 1}</div>
              {survey.areas.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setSurvey(prev => ({ ...prev, areas: prev.areas.filter(row => row.id !== area.id) }))
                    touch()
                  }}
                  style={{ background: 'none', border: 'none', color: '#F87171', fontWeight: 700, cursor: 'pointer' }}
                >
                  Remove area
                </button>
              )}
            </div>
            <div>
              <label style={LABEL}>Title</label>
              <input
                type="text"
                value={area.title}
                onChange={e => patchArea(area.id, { title: e.target.value })}
                placeholder="Kitchen"
                style={INPUT}
              />
            </div>
            <div>
              <label style={LABEL}>Description</label>
              <textarea
                value={area.description}
                onChange={e => patchArea(area.id, { description: e.target.value })}
                placeholder="Open plan, island in the middle"
                rows={2}
                style={{ ...INPUT, resize: 'vertical' }}
              />
            </div>
            <div>
              <label style={LABEL}>Where you started</label>
              <input
                type="text"
                value={area.start_note}
                onChange={e => patchArea(area.id, { start_note: e.target.value })}
                placeholder="Front door, left side"
                style={INPUT}
              />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {area.legs.map((leg, index) => (
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
                    background: 'var(--bg)',
                  }}
                >
                  <div style={{ fontWeight: 700, paddingBottom: 8 }}>Wall {index + 1}</div>
                  <div>
                    <label style={LABEL}>Turn</label>
                    <select
                      value={leg.turn}
                      onChange={e => patchLeg(area.id, leg.id, { turn: e.target.value === 'left' ? 'left' : 'right' })}
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
                        patchLeg(area.id, leg.id, { length_m: raw === '' ? null : Number(raw) })
                      }}
                      placeholder="0.00"
                      style={INPUT}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSurvey(prev => ({
                        ...prev,
                        areas: prev.areas.map(row => row.id === area.id
                          ? { ...row, legs: row.legs.filter(legRow => legRow.id !== leg.id) }
                          : row),
                      }))
                      touch()
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
                setSurvey(prev => ({
                  ...prev,
                  areas: prev.areas.map(row => row.id === area.id
                    ? { ...row, legs: [...row.legs, newHouseSurveyLeg()] }
                    : row),
                }))
                touch()
              }}
              style={{ width: '100%', padding: 12, fontWeight: 700 }}
            >
              + Another wall
            </button>
          </section>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          setSurvey(prev => ({ ...prev, areas: [...prev.areas, newHouseSurveyArea()] }))
          touch()
        }}
        style={{ width: '100%', marginTop: 16, padding: 12, fontWeight: 700 }}
      >
        Start a new area
      </button>
      </div>
      <div
        className="house-survey-plan"
        style={{
          padding: 12,
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, fontSize: 13, color: saveError ? '#F87171' : 'var(--text-muted)' }}>
          {saveError || (saving ? 'Saving…' : savedFlash ? 'Saved' : '')}
        </div>
        <div style={{ display: 'grid', gap: 12, maxHeight: '70vh', overflow: 'auto' }}>
          {plans.map(({ area, trace, sketch }, index) => {
            const start = sketch?.d.split(' ')[0]?.split(',')
            return (
              <div key={area.id}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{area.title.trim() || `Area ${index + 1}`}</div>
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
                  <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 8, textAlign: 'center', padding: 12 }}>
                    The plan appears here as you add walls.
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 13 }}>{areaStatus(trace)}</div>
              </div>
            )
          })}
        </div>
      </div>
      </div>
    </div>
  )
}
