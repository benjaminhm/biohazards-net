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
  metresToSketch,
  nearestPointOnSurvey,
  sketchToMetres,
  surveyPointDistance,
  type HouseSurveyArea,
  type HouseSurveyCapture,
  type HouseSurveyLeg,
  type SurveyPoint,
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
  const [unlockedAreas, setUnlockedAreas] = useState<Record<string, boolean>>({})
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [renumberLegId, setRenumberLegId] = useState<string | null>(null)
  const [renumberValue, setRenumberValue] = useState('')
  const dragFrom = useRef<{ areaId: string; index: number } | null>(null)
  const skipRenumber = useRef(false)
  const [dragOverIndex, setDragOverIndex] = useState<{ areaId: string; index: number } | null>(null)
  const [measureAreaId, setMeasureAreaId] = useState<string | null>(null)
  const [measurePoints, setMeasurePoints] = useState<SurveyPoint[]>([])
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
    const header = document.querySelector('[data-devid="P2-E1"]')
    if (!header) return
    const apply = () => {
      document.documentElement.style.setProperty('--survey-stick-top', `${header.getBoundingClientRect().height}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const bar = document.querySelector('[data-survey-card-head="open"]')
    if (!bar) return
    const apply = () => {
      document.documentElement.style.setProperty('--survey-card-head', `${bar.getBoundingClientRect().height}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [openId])

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
      return { area, trace, sketch: surveySketchPath(trace) }
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

  function moveLegTo(areaId: string, from: number, to: number) {
    setSurvey(prev => ({
      ...prev,
      areas: prev.areas.map(area => {
        if (area.id !== areaId) return area
        if (from < 0 || from >= area.legs.length) return area
        const target = Math.max(0, Math.min(area.legs.length - 1, to))
        if (target === from) return area
        const legs = [...area.legs]
        const [moved] = legs.splice(from, 1)
        if (!moved) return area
        legs.splice(target, 0, moved)
        return { ...area, legs }
      }),
    }))
    touch()
  }

  function moveLeg(areaId: string, index: number, delta: -1 | 1) {
    moveLegTo(areaId, index, index + delta)
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
        .house-survey-plan {
          order: -1;
          position: sticky;
          top: calc(var(--survey-stick-top, 120px) + var(--survey-card-head, 48px) + 8px);
          z-index: 5;
          align-self: start;
        }
        .house-survey-card-head {
          position: sticky;
          top: var(--survey-stick-top, 120px);
          z-index: 6;
          background: var(--surface);
        }
        @media (min-width: 900px) {
          .house-survey-area-body { grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.8fr); }
          .house-survey-plan { order: 0; }
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
            }}
          >
            <div
              className={openId === area.id ? 'house-survey-card-head' : undefined}
              data-survey-card-head={openId === area.id ? 'open' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: openId === area.id ? '1px solid var(--border)' : undefined }}
            >
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ ...LABEL, marginBottom: 0 }}>Walls</span>
              <button
                type="button"
                onClick={() => setUnlockedAreas(prev => ({ ...prev, [area.id]: !prev[area.id] }))}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: unlockedAreas[area.id] ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '6px 10px',
                }}
              >
                {unlockedAreas[area.id] ? 'Lock walls' : 'Unlock walls'}
              </button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {area.legs.map((leg, index) => (
                <div
                  key={leg.id}
                  onDragOver={event => {
                    event.preventDefault()
                    setDragOverIndex({ areaId: area.id, index })
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    const from = dragFrom.current
                    if (from && from.areaId === area.id) moveLegTo(area.id, from.index, index)
                    dragFrom.current = null
                    setDragOverIndex(null)
                  }}
                  onClick={event => {
                    const target = event.target as HTMLElement
                    if (target.closest('input, select, button, textarea')) return
                    setSelectedLegId(current => current === leg.id ? null : leg.id)
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto auto minmax(72px, auto) 1fr 1fr auto',
                    gap: 8,
                    alignItems: 'end',
                    padding: 12,
                    borderRadius: 12,
                    border: selectedLegId === leg.id ? '1px solid #fbbf24' : '1px solid var(--border)',
                    background: selectedLegId === leg.id ? 'rgba(251, 191, 36, 0.12)' : 'var(--bg)',
                    cursor: 'pointer',
                    boxShadow: dragOverIndex?.areaId === area.id && dragOverIndex.index === index ? 'inset 0 2px 0 var(--accent)' : undefined,
                  }}
                >
                  <div
                    draggable
                    aria-label="Drag wall"
                    title="Drag to move"
                    onDragStart={event => {
                      dragFrom.current = { areaId: area.id, index }
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null
                      setDragOverIndex(null)
                    }}
                    style={{ cursor: 'grab', paddingBottom: 8, color: 'var(--text-muted)', fontWeight: 700, userSelect: 'none' }}
                  >
                    ⋮⋮
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 4 }}>
                    <button
                      type="button"
                      aria-label="Move wall up"
                      disabled={!unlockedAreas[area.id] || index === 0}
                      onClick={() => moveLeg(area.id, index, -1)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        cursor: !unlockedAreas[area.id] || index === 0 ? 'default' : 'pointer',
                        opacity: !unlockedAreas[area.id] || index === 0 ? 0.35 : 1,
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move wall down"
                      disabled={!unlockedAreas[area.id] || index === area.legs.length - 1}
                      onClick={() => moveLeg(area.id, index, 1)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        cursor: !unlockedAreas[area.id] || index === area.legs.length - 1 ? 'default' : 'pointer',
                        opacity: !unlockedAreas[area.id] || index === area.legs.length - 1 ? 0.35 : 1,
                      }}
                    >
                      ↓
                    </button>
                  </div>
                  {renumberLegId === leg.id ? (
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      max={area.legs.length}
                      value={renumberValue}
                      aria-label={`Wall ${index + 1} position`}
                      onChange={event => setRenumberValue(event.target.value)}
                      onBlur={() => {
                        if (skipRenumber.current) {
                          skipRenumber.current = false
                          return
                        }
                        const next = Number(renumberValue)
                        if (Number.isInteger(next)) moveLegTo(area.id, index, next - 1)
                        setRenumberLegId(null)
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') {
                          skipRenumber.current = true
                          setRenumberLegId(null)
                        }
                      }}
                      style={{ ...INPUT, width: 72 }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRenumberLegId(leg.id)
                        setRenumberValue(String(index + 1))
                      }}
                      style={{ fontWeight: 700, background: 'none', border: 'none', color: 'inherit', cursor: 'text', padding: '0 0 8px', textAlign: 'left' }}
                    >
                      Wall {index + 1}
                    </button>
                  )}
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
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              }}
            >
              {(() => {
                const sketch = plans[areaIndex].sketch
                return sketch ? (
                  <svg
                    viewBox={`0 0 ${sketch.width} ${sketch.height}`}
                    width="100%"
                    height={200}
                    onClick={() => {
                      setMeasureAreaId(area.id)
                      setMeasurePoints([])
                    }}
                    style={{ display: 'block', background: 'var(--surface)', borderRadius: 8, cursor: 'pointer' }}
                  >
                    {sketch.lines.map(line => {
                      const selected = line.legId === selectedLegId
                      return (
                        <line
                          key={line.legId}
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          stroke={selected ? '#fbbf24' : '#93c5fd'}
                          strokeWidth={selected ? 6 : 2}
                          strokeLinecap="round"
                          onClick={event => {
                            event.stopPropagation()
                            setSelectedLegId(current => current === line.legId ? null : line.legId)
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      )
                    })}
                    <circle cx={sketch.start.x} cy={sketch.start.y} r="4" fill="#86efac" />
                  </svg>
                ) : (
                  <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 8, textAlign: 'center', padding: 12 }}>
                    The plan appears here as you add walls.
                  </div>
                )
              })()}
              <div style={{ marginTop: 8, fontSize: 13 }}>{areaStatus(plans[areaIndex].trace)}</div>
              {plans[areaIndex].sketch && (
                <button
                  type="button"
                  onClick={() => {
                    setMeasureAreaId(area.id)
                    setMeasurePoints([])
                  }}
                  style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Measure a gap
                </button>
              )}
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
      {measureAreaId && (() => {
        const plan = plans.find(item => item.area.id === measureAreaId)
        const sketch = plan?.sketch
        const trace = plan?.trace
        if (!plan || !sketch || !trace) return null
        const marks = measurePoints.map(point => metresToSketch(sketch, point))
        const distance = measurePoints.length === 2
          ? surveyPointDistance(measurePoints[0], measurePoints[1])
          : null
        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 80,
              background: 'rgba(0,0,0,0.72)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={() => setMeasureAreaId(null)}
          >
            <div
              onClick={event => event.stopPropagation()}
              style={{
                width: 'min(920px, 100%)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 800 }}>{plan.area.title.trim() || 'Area'} — measure</div>
                <button type="button" onClick={() => setMeasureAreaId(null)} style={{ background: 'none', border: 'none', color: 'var(--text)', fontWeight: 700, cursor: 'pointer' }}>Close</button>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 0 }}>
                {measurePoints.length === 0 && 'Click one side of the gap, then the other.'}
                {measurePoints.length === 1 && 'Click the other side.'}
                {measurePoints.length === 2 && 'Click again to start a new measure.'}
              </p>
              <svg
                viewBox={`0 0 ${sketch.width} ${sketch.height}`}
                width="100%"
                style={{ display: 'block', height: 'min(70vh, 640px)', background: 'var(--surface)', borderRadius: 12, cursor: 'crosshair' }}
                onClick={event => {
                  const svg = event.currentTarget
                  const point = svg.createSVGPoint()
                  point.x = event.clientX
                  point.y = event.clientY
                  const matrix = svg.getScreenCTM()
                  if (!matrix) return
                  const local = point.matrixTransform(matrix.inverse())
                  const snapped = nearestPointOnSurvey(trace, sketchToMetres(sketch, local.x, local.y))
                  if (!snapped) return
                  setMeasurePoints(current => current.length >= 2 ? [snapped] : [...current, snapped])
                }}
              >
                {sketch.lines.map(line => (
                  <line
                    key={line.legId}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={line.legId === selectedLegId ? '#fbbf24' : '#93c5fd'}
                    strokeWidth={line.legId === selectedLegId ? 6 : 3}
                    strokeLinecap="round"
                  />
                ))}
                {marks.length === 2 && (
                  <line x1={marks[0].x} y1={marks[0].y} x2={marks[1].x} y2={marks[1].y} stroke="#fbbf24" strokeWidth="2" strokeDasharray="4 3" />
                )}
                {marks.map((mark, index) => (
                  <circle key={index} cx={mark.x} cy={mark.y} r="5" fill="#fbbf24" />
                ))}
                <circle cx={sketch.start.x} cy={sketch.start.y} r="4" fill="#86efac" />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{distance == null ? '—' : `${distance} m`}</div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMeasurePoints([])}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
