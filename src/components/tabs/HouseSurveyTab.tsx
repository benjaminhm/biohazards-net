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
  const [openId, setOpenId] = useState<string | null>(saved.areas[0]?.id ?? null)
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
    if (openId && !survey.areas.some(area => area.id === openId)) {
      setOpenId(survey.areas[0]?.id ?? null)
    }
  }, [survey.areas, openId])

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
    <div className="house-survey" style={{ paddingBottom: 48, maxWidth: 880 }}>
      <style>{`
        .house-survey-area-body { display: grid; gap: 16px; align-items: start; }
        .house-survey-plan { order: -1; }
        @media (min-width: 900px) {
          .house-survey-area-body { grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.8fr); }
          .house-survey-plan { order: 0; position: sticky; top: 12px; }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
        Each area is its own clockwise walk. Title it, describe it, then add walls until that area closes. Start another area for the next part of the house.
      </p>
      <span style={{ fontSize: 13, color: saveError ? '#F87171' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {saveError || (saving ? 'Saving…' : savedFlash ? 'Saved' : '')}
      </span>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {survey.areas.map((area, areaIndex) => (
          <section
            key={area.id}
            style={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setOpenId(current => current === area.id ? null : area.id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--text-muted)', width: 12 }}>{openId === area.id ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 800 }}>{area.title.trim() || `Area ${areaIndex + 1}`}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{areaStatus(plans[areaIndex].trace)}</span>
              </button>
              {survey.areas.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setSurvey(prev => ({ ...prev, areas: prev.areas.filter(row => row.id !== area.id) }))
                    touch()
                  }}
                  style={{ background: 'none', border: 'none', color: '#F87171', fontWeight: 700, cursor: 'pointer', paddingRight: 14 }}
                >
                  Remove
                </button>
              )}
            </div>
            {openId === area.id && (
            <div className="house-survey-area-body" style={{ padding: '0 14px 14px' }}>
            <div style={{ display: 'grid', gap: 12 }}>
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
            </div>
            <div
              className="house-survey-plan"
              style={{
                padding: 12,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
              }}
            >
              {(() => {
                const sketch = plans[areaIndex].sketch
                const start = sketch?.d.split(' ')[0]?.split(',')
                return sketch ? (
                  <svg
                    viewBox={`0 0 ${sketch.width} ${sketch.height}`}
                    width="100%"
                    height={200}
                    style={{ display: 'block', background: 'var(--surface)', borderRadius: 8 }}
                  >
                    <polyline points={sketch.d} fill="none" stroke="#93c5fd" strokeWidth="2" />
                    {start && <circle cx={start[0]} cy={start[1]} r="4" fill="#86efac" />}
                  </svg>
                ) : (
                  <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 8, textAlign: 'center', padding: 12 }}>
                    The plan appears here as you add walls.
                  </div>
                )
              })()}
              <div style={{ marginTop: 8, fontSize: 13 }}>{areaStatus(plans[areaIndex].trace)}</div>
            </div>
            </div>
            )}
          </section>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          const area = newHouseSurveyArea()
          setSurvey(prev => ({ ...prev, areas: [...prev.areas, area] }))
          setOpenId(area.id)
          touch()
        }}
        style={{ width: '100%', marginTop: 16, padding: 12, fontWeight: 700 }}
      >
        Start a new area
      </button>
    </div>
  )
}
