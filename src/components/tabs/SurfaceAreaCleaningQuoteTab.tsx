'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import DocumentAskPanel from '@/components/DocumentAskPanel'
import SelectedPhotos from '@/components/SelectedPhotos'
import { samePhotoIds } from '@/lib/photoIds'
import { usedPhotoIds } from '@/lib/photoSelection'
import RichTextEditor from '@/components/RichTextEditor'
import { isSurfaceAreaAppendixPhoto } from '@/lib/photoGroups'
import type { Job, Photo } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  SURFACE_AREA_CLIENT_TITLES,
  SURFACE_AREA_ROOM_PRESETS,
  SURFACE_AREA_SCHEMA,
  defaultSurfaceAreaCleaningStandards,
  emptySurfaceAreaCleaningCapture,
  newSurfaceAreaOtherLine,
  newSurfaceAreaRoom,
  normalizeSurfaceAreaCleaningCapture,
  normalizeSurfaceAreaCleaningStandards,
  presetRoomCount,
  pricedRoomSurface,
  quotedSquareMetres,
  setPresetRoomCount,
  roomSurfaceArea,
  roomsCeilingTotal,
  roomsSurfaceTotal,
  surfaceAreaClauseLines,
  surfaceAreaCleaningDocumentTitle,
  surfaceAreaCleaningFigures,
  surfaceAreaCleaningQuoteContent,
  type SurfaceAreaCleaningCapture,
  type SurfaceAreaCleaningStandards,
} from '@/lib/surfaceAreaCleaningQuote'
import { documentPlainText } from '@/lib/documentAsk'
import {
  DEFAULT_ENGAGEMENT_AGREEMENT,
  persistableEngagement,
  sharedEngagementAgreement,
  withSharedEngagement,
} from '@/lib/quoteEngagement'
import {
  normalizeContentsClearanceStandards,
  type ContentsClearanceStandards,
} from '@/lib/contentsClearanceQuote'

interface Props {
  job: Job
  photos: Photo[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
}

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  color: 'var(--text-muted)',
}

const SECTION: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  marginTop: 14,
}

function numberOrNull(raw: string): number | null {
  return raw === '' ? null : Number(raw)
}

function ClickToEditText({
  label,
  value,
  onChange,
  asList,
  hint,
  emptyText = 'Click to edit',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  asList?: boolean
  hint?: string
  emptyText?: string
}) {
  const [editing, setEditing] = useState(false)
  const items = surfaceAreaClauseLines(value)
  return (
    <div>
      <div style={LABEL}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '-2px 0 6px' }}>{hint}</div>}
      {editing ? (
        <textarea
          autoFocus
          value={value}
          rows={asList ? Math.max(4, items.length + 1) : 4}
          onChange={e => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          placeholder={asList ? 'One item per line' : ''}
          style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '8px 10px',
            color: 'var(--text)',
            cursor: 'text',
            font: 'inherit',
          }}
        >
          {asList && items.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: 'grid', gap: 4 }}>
              {items.map(item => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <span style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: value.trim() ? undefined : 'var(--text-muted)' }}>{value.trim() || emptyText}</span>
          )}
        </button>
      )}
    </div>
  )
}

export default function SurfaceAreaCleaningQuoteTab({ job, photos, onJobUpdate, onPhotosUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeSurfaceAreaCleaningCapture(job.assessment_data?.surface_area_cleaning_quote ?? emptySurfaceAreaCleaningCapture()),
    [job.assessment_data?.surface_area_cleaning_quote],
  )
  const [capture, setCapture] = useState<SurfaceAreaCleaningCapture>(saved)
  const usedIds = useMemo(() => usedPhotoIds(job.assessment_data, photos), [job.assessment_data, photos])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [standards, setStandards] = useState<SurfaceAreaCleaningStandards>(defaultSurfaceAreaCleaningStandards)
  const [standardsReady, setStandardsReady] = useState(false)
  const skipStandardsSave = useRef(true)
  const companyLoadedRef = useRef(false)
  const loadedEngagementRef = useRef('')
  const clearanceStandardsRef = useRef<ContentsClearanceStandards | null>(null)

  useEffect(() => {
    setCapture(normalizeSurfaceAreaCleaningCapture(job.assessment_data?.surface_area_cleaning_quote))
  }, [job.id, job.updated_at])

  const isDirty = capture.cleaning_kind !== saved.cleaning_kind
    || capture.custom_title !== saved.custom_title
    || capture.title_addition !== saved.title_addition
    || capture.estimated_m2 !== saved.estimated_m2
    || capture.labour_days !== saved.labour_days
    || capture.rate_per_m2 !== saved.rate_per_m2
    || capture.rate_per_labour_day !== saved.rate_per_labour_day
    || capture.job_address !== saved.job_address
    || capture.mobilisation_fee !== saved.mobilisation_fee
    || capture.mobilisation_waived !== saved.mobilisation_waived
    || capture.mobilisation_reason !== saved.mobilisation_reason
    || capture.presentation !== saved.presentation
    || capture.objective !== saved.objective
    || capture.scope_of_work !== saved.scope_of_work
    || capture.coh_rap !== saved.coh_rap
    || capture.coh_rap_fee !== saved.coh_rap_fee
    || capture.atp_testing !== saved.atp_testing
    || capture.atp_tests !== saved.atp_tests
    || capture.atp_rate !== saved.atp_rate
    || capture.lab_testing !== saved.lab_testing
    || capture.lab_tests !== saved.lab_tests
    || capture.lab_rate !== saved.lab_rate
    || capture.exclude_ceiling !== saved.exclude_ceiling
    || capture.job_inclusions !== saved.job_inclusions
    || capture.job_exclusions !== saved.job_exclusions
    || capture.job_assumptions !== saved.job_assumptions
    || JSON.stringify(capture.rooms) !== JSON.stringify(saved.rooms)
    || JSON.stringify(capture.other_lines) !== JSON.stringify(saved.other_lines)
    || !samePhotoIds(capture.photo_ids, saved.photo_ids)
  useRegisterUnsavedChanges('surface-area-cleaning-quote', isDirty)

  const figures = useMemo(
    () => surfaceAreaCleaningFigures(quotedSquareMetres(capture), {
      ratePerM2: capture.rate_per_m2 ?? SURFACE_AREA_SCHEMA.ratePerM2,
      ratePerLabourDay: capture.rate_per_labour_day ?? SURFACE_AREA_SCHEMA.ratePerLabourDay,
    }, {
      labourDays: capture.labour_days,
      mobilisationFee: capture.mobilisation_fee,
      mobilisationWaived: capture.mobilisation_waived,
      hygienist: capture,
      otherLines: capture.other_lines,
    }),
    [capture],
  )
  const askText = useMemo(() => documentPlainText(surfaceAreaCleaningQuoteContent({
    reference: 'Draft',
    clientName: job.client_name || '',
    siteAddress: job.site_address || '',
    capture,
    standards,
  })), [capture, job.client_name, job.site_address, standards])

  useEffect(() => {
    let cancelled = false
    fetch('/api/company')
      .then(r => r.json())
      .then((data: { company?: { contents_clearance_standards?: unknown; surface_area_cleaning_standards?: unknown } }) => {
        if (cancelled) return
        skipStandardsSave.current = true
        const clearance = normalizeContentsClearanceStandards(data.company?.contents_clearance_standards)
        const surface = normalizeSurfaceAreaCleaningStandards(data.company?.surface_area_cleaning_standards)
        const engagement = sharedEngagementAgreement(clearance.engagement_agreement, surface.engagement_agreement)
        clearanceStandardsRef.current = data.company?.contents_clearance_standards == null ? null : clearance
        loadedEngagementRef.current = engagement
        companyLoadedRef.current = true
        setStandards(withSharedEngagement(surface, engagement))
        setStandardsReady(true)
      })
      .catch(() => {
        if (!cancelled) setStandardsReady(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!standardsReady || !companyLoadedRef.current) return
    if (skipStandardsSave.current) {
      skipStandardsSave.current = false
      return
    }
    const timer = window.setTimeout(() => { void persistStandards(standards) }, 500)
    return () => window.clearTimeout(timer)
  }, [standards, standardsReady])

  async function persistStandards(next: SurfaceAreaCleaningStandards) {
    if (!companyLoadedRef.current) return
    const engagement = persistableEngagement(
      next.engagement_agreement,
      loadedEngagementRef.current,
      DEFAULT_ENGAGEMENT_AGREEMENT,
    )
    const toSave = { ...next, engagement_agreement: engagement }
    const clearance = clearanceStandardsRef.current
    let coreOk = true
    if (clearance) {
      const syncedClearance = { ...clearance, engagement_agreement: engagement }
      const core = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents_clearance_standards: syncedClearance }),
      })
      coreOk = core.ok
      if (core.ok) clearanceStandardsRef.current = syncedClearance
    }
    const res = await fetch('/api/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface_area_cleaning_standards: toSave }),
    })
    if (res.ok) loadedEngagementRef.current = engagement
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setSaveError(data.error || 'The clauses could not be saved for future jobs.')
    } else if (!coreOk) {
      setSaveError('The engagement agreement could not be saved for future jobs.')
    }
  }

  function editStandards(next: Partial<SurfaceAreaCleaningStandards>) {
    setStandards(prev => ({ ...prev, ...next }))
  }

  function patch(next: Partial<SurfaceAreaCleaningCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
  }

  function setRooms(rooms: SurfaceAreaCleaningCapture['rooms'], excludeCeiling = capture.exclude_ceiling) {
    const total = roomsSurfaceTotal(rooms, excludeCeiling)
    patch({ rooms, exclude_ceiling: excludeCeiling, estimated_m2: total ?? capture.estimated_m2 })
  }

  async function save(next = capture): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_data: { ...merged, surface_area_cleaning_quote: next },
        }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      onJobUpdate(data.job)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveAndCompose() {
    if (!(capture.labour_days != null && capture.labour_days > 0)) {
      setSaveError('Enter the labour days before generating the quote.')
      return
    }
    await persistStandards(standards)
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/surface_area_cleaning_quote?compose=1`)
  }

  const labourLine = figures.lines.find(line => line.label === 'Labour')

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
        Surface Area Cleaning Quote
      </div>
      <DocumentAskPanel jobId={job.id} label="this surface area cleaning quote" text={askText} />
      <div style={{ marginBottom: 12, maxWidth: 480 }}>
        <label style={LABEL}>For the client, this is</label>
        <select
          value={capture.cleaning_kind}
          onChange={e => patch({ cleaning_kind: e.target.value as SurfaceAreaCleaningCapture['cleaning_kind'] })}
          style={INPUT}
        >
          {SURFACE_AREA_CLIENT_TITLES.map(option => (
            <option key={option.id} value={option.id}>{option.title}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
        {capture.cleaning_kind === 'custom' && (
          <input
            value={capture.custom_title}
            onChange={e => patch({ custom_title: e.target.value })}
            placeholder="Title on the quote"
            style={{ ...INPUT, marginTop: 8 }}
          />
        )}
        <label style={{ ...LABEL, marginTop: 10 }}>Add to the title</label>
        <input
          value={capture.title_addition}
          onChange={e => patch({ title_addition: e.target.value })}
          placeholder="Optional"
          style={INPUT}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          {surfaceAreaCleaningDocumentTitle(capture.cleaning_kind, capture.custom_title, capture.title_addition)}
        </div>
      </div>
      <div style={{ fontSize: 14, marginBottom: 12 }}>
        <div style={LABEL}>Client</div>
        <div>{job.client_name || '—'}</div>
      </div>
      <div style={{ marginBottom: 12, maxWidth: 480 }}>
        <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={capture.mobilisation_waived}
            onChange={e => patch({ mobilisation_waived: e.target.checked })}
          />
          No call-out charge
        </label>
        {capture.mobilisation_waived ? (
          <textarea
            value={capture.mobilisation_reason}
            onChange={e => patch({ mobilisation_reason: e.target.value })}
            rows={2}
            placeholder="No call-out charge, as already onsite for the hoarding removal."
            style={{ ...INPUT, marginTop: 8, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        ) : (
          <>
            <label style={{ ...LABEL, marginTop: 8 }}>Mobilisation fee ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.mobilisation_fee ?? ''}
              onChange={e => {
                const raw = e.target.value
                patch({ mobilisation_fee: raw === '' ? null : Number(raw) })
              }}
              placeholder="0.00"
              style={INPUT}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Attendance and setup, ex GST. It is added to the quote when the amount is more than zero.
            </div>
          </>
        )}
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL}>Job address</label>
        <input
          value={capture.job_address ?? job.site_address ?? ''}
          onChange={e => patch({ job_address: e.target.value })}
          style={INPUT}
        />
      </div>
      <div style={{ marginBottom: 12, display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          A blank field stays off the quote.
        </div>
        <div>
          <label style={LABEL}>Presentation</label>
          <textarea
            value={capture.presentation}
            onChange={e => patch({ presentation: e.target.value })}
            rows={3}
            placeholder="How the property presents, and what was found."
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label style={LABEL}>Objective</label>
          <textarea
            value={capture.objective}
            onChange={e => patch({ objective: e.target.value })}
            rows={2}
            placeholder="The outcome this cleaning is meant to achieve."
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label style={LABEL}>Scope of work</label>
          <textarea
            value={capture.scope_of_work}
            onChange={e => patch({ scope_of_work: e.target.value })}
            rows={5}
            placeholder="The work this quote covers."
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ ...LABEL, marginBottom: 0 }}>Rooms</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, cursor: roomsCeilingTotal(capture.rooms) == null && !capture.exclude_ceiling ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={capture.exclude_ceiling}
              disabled={roomsCeilingTotal(capture.rooms) == null && !capture.exclude_ceiling}
              onChange={e => setRooms(capture.rooms, e.target.checked)}
            />
            Remove ceiling surface area
            <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>
              {roomsCeilingTotal(capture.rooms) != null
                ? `${roomsCeilingTotal(capture.rooms)?.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²`
                : 'Add a room to work out the ceiling'}
            </span>
          </label>
        </div>
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 12px',
          marginBottom: 10,
        }}>
          <div style={LABEL}>Average rooms</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            A guide when the room has not been seen. Tick a room, or give the number of rooms, to add it below at the average size. You can change the sizes below. The total is the floor, the ceiling, and the walls. The ceiling is length × width.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px', fontSize: 13 }}>
            {SURFACE_AREA_ROOM_PRESETS.map(preset => {
              const count = presetRoomCount(capture.rooms, preset.id)
              return (
                <label key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  {preset.multiple ? (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={count || ''}
                      placeholder="0"
                      onChange={e => setRooms(setPresetRoomCount(capture.rooms, preset, Math.min(20, Number(e.target.value) || 0)))}
                      style={{ ...INPUT, width: 52, padding: '4px 6px', fontSize: 13 }}
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={count > 0}
                      onChange={e => setRooms(setPresetRoomCount(capture.rooms, preset, e.target.checked ? 1 : 0))}
                    />
                  )}
                  <span style={{ flex: 1 }}>{preset.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{preset.length_m} × {preset.width_m} × {preset.height_m} m</span>
                </label>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {capture.rooms.map(room => {
            const measure = roomSurfaceArea(room)
            const priced = pricedRoomSurface(room, capture.exclude_ceiling)
            const metres = (key: 'length_m' | 'width_m' | 'height_m', raw: string) => {
              const next = capture.rooms.map(item => item.id === room.id
                ? { ...item, [key]: raw === '' ? null : Number(raw) }
                : item)
              setRooms(next)
            }
            return (
              <div key={room.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.7fr auto auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={LABEL}>Room</label>
                  <input
                    value={room.name}
                    onChange={e => setRooms(capture.rooms.map(item => item.id === room.id ? { ...item, name: e.target.value } : item))}
                    placeholder="Bedroom"
                    style={INPUT}
                  />
                </div>
                <div>
                  <label style={LABEL}>L (m)</label>
                  <input type="number" min={0} step="0.01" value={room.length_m ?? ''} onChange={e => metres('length_m', e.target.value)} style={INPUT} />
                </div>
                <div>
                  <label style={LABEL}>W (m)</label>
                  <input type="number" min={0} step="0.01" value={room.width_m ?? ''} onChange={e => metres('width_m', e.target.value)} style={INPUT} />
                </div>
                <div>
                  <label style={LABEL}>H (m)</label>
                  <input type="number" min={0} step="0.01" value={room.height_m ?? ''} onChange={e => metres('height_m', e.target.value)} style={INPUT} />
                </div>
                <div style={{ fontSize: 13, paddingBottom: 8, whiteSpace: 'nowrap' }}>
                  {priced ? `${priced.total.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²` : '—'}
                  {measure ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      ceiling {measure.ceiling.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²
                    </div>
                  ) : null}
                </div>
                <button type="button" className="btn" onClick={() => setRooms(capture.rooms.filter(item => item.id !== room.id))}>
                  Remove
                </button>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => setRooms([...capture.rooms, newSurfaceAreaRoom()])}>
            Add a room
          </button>
          {roomsSurfaceTotal(capture.rooms, capture.exclude_ceiling) != null && (
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {roomsSurfaceTotal(capture.rooms, capture.exclude_ceiling)?.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Estimated square metres</label>
          {capture.rooms.length > 0 ? (
            <div style={{ ...INPUT, background: 'transparent' }}>
              {(quotedSquareMetres(capture) ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 2 })}
            </div>
          ) : (
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.estimated_m2 ?? ''}
              onChange={e => {
                const raw = e.target.value
                patch({ estimated_m2: raw === '' ? null : Number(raw) })
              }}
              placeholder="0"
              style={INPUT}
            />
          )}
        </div>
        <div>
          <label style={LABEL}>Labour days</label>
          <input
            type="number"
            min={1}
            step={1}
            value={capture.labour_days ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ labour_days: raw === '' ? null : Number(raw) })
            }}
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {figures.labour_days > 0
              ? `${figures.labour_days.toLocaleString('en-AU', { maximumFractionDigits: 0 })} labour ${figures.labour_days === 1 ? 'day' : 'days'} × ${formatAud(figures.rate_per_labour_day)} = ${formatAud(labourLine?.amount ?? 0)}`
              : 'Required before the quote can be generated.'}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={LABEL}>Rate per m² ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_m2 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_m2: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Rate per person per day ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_labour_day ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_labour_day: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
      </div>
      <div style={SECTION}>
        <div style={LABEL}>Hygienist and verification</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Each one ticked adds a line to the scope of work and a line to the quote. Leave them unticked and they stay off the quote.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={capture.coh_rap} onChange={e => patch({ coh_rap: e.target.checked })} />
          Certified Occupational Hygienist: site inspection and written method
        </label>
        {capture.coh_rap && (
          <div style={{ margin: '8px 0 0 24px', maxWidth: 260 }}>
            <label style={LABEL}>Fee ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.coh_rap_fee ?? ''}
              onChange={e => patch({ coh_rap_fee: numberOrNull(e.target.value) })}
              placeholder="0.00"
              style={INPUT}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Added first in the scope: the COH inspects the site and issues written instructions. That is not a Remediation Action Plan.
            </div>
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 12 }}>
          <input
            type="checkbox"
            checked={capture.atp_testing && capture.lab_testing}
            onChange={e => patch({ atp_testing: e.target.checked, lab_testing: e.target.checked })}
          />
          COH verification at the end of the works
        </label>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, marginLeft: 24 }}>
          Verification is both ATP testing and laboratory testing.
        </div>
        {capture.atp_testing && capture.lab_testing && (
          <div style={{ margin: '8px 0 0 24px', display: 'grid', gap: 12, maxWidth: 480 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>ATP testing</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL}>Number of tests</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={capture.atp_tests ?? ''}
                    onChange={e => patch({ atp_tests: numberOrNull(e.target.value) })}
                    placeholder="0"
                    style={INPUT}
                  />
                </div>
                <div>
                  <label style={LABEL}>Rate per test ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={capture.atp_rate ?? ''}
                    onChange={e => patch({ atp_rate: numberOrNull(e.target.value) })}
                    placeholder="0.00"
                    style={INPUT}
                  />
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Laboratory testing</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL}>Number of tests</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={capture.lab_tests ?? ''}
                    onChange={e => patch({ lab_tests: numberOrNull(e.target.value) })}
                    placeholder="0"
                    style={INPUT}
                  />
                </div>
                <div>
                  <label style={LABEL}>Rate per test ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={capture.lab_rate ?? ''}
                    onChange={e => patch({ lab_rate: numberOrNull(e.target.value) })}
                    placeholder="0.00"
                    style={INPUT}
                  />
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Added last in the scope: the COH verifies the decontamination by ATP testing and by laboratory testing. Each is its own line on the quote.
            </div>
          </div>
        )}
      </div>
      <div style={SECTION}>
        <div style={LABEL}>Other costs</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Each line is a title, a description, and a price ex GST. A line with no title stays off the quote.
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          {capture.other_lines.map(line => {
            const update = (next: Partial<typeof line>) =>
              patch({ other_lines: capture.other_lines.map(item => item.id === line.id ? { ...item, ...next } : item) })
            return (
              <div key={line.id} style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px auto', gap: 8, alignItems: 'end' }}>
                  <div>
                    <label style={LABEL}>Title</label>
                    <input value={line.title} onChange={e => update({ title: e.target.value })} style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Price ex GST ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.price ?? ''}
                      onChange={e => update({ price: numberOrNull(e.target.value) })}
                      placeholder="0.00"
                      style={INPUT}
                    />
                  </div>
                  <button type="button" className="btn" onClick={() => patch({ other_lines: capture.other_lines.filter(item => item.id !== line.id) })}>
                    Remove
                  </button>
                </div>
                <div>
                  <label style={LABEL}>Description</label>
                  <textarea
                    value={line.description}
                    onChange={e => update({ description: e.target.value })}
                    rows={2}
                    style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => patch({ other_lines: [...capture.other_lines, newSurfaceAreaOtherLine()] })}>
          Add a line
        </button>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 6, fontSize: 14 }}>
        {figures.lines.filter(line => line.section !== 'other').map((line, i) => (
          <div key={`${line.label}:${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>
              {line.label}
              {line.unit ? ` · ${line.quantity.toLocaleString('en-AU', { maximumFractionDigits: 2 })} ${line.unit}` : ''}
            </span>
            <span>{formatAud(line.amount)}</span>
          </div>
        ))}
        {figures.lines.some(line => line.section === 'other') && (
          <div style={{ ...LABEL, marginTop: 8 }}>Other costs</div>
        )}
        {figures.lines.filter(line => line.section === 'other').map((line, i) => (
          <div key={`other:${line.label}:${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>
              {line.label}
              {line.description ? <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{line.description}</span> : null}
            </span>
            <span>{formatAud(line.amount)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>Subtotal (ex GST)</span>
          <span>{formatAud(figures.subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>GST (10%)</span>
          <span>{formatAud(figures.gst)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800, marginTop: 4 }}>
          <span>Total (inc GST)</span>
          <span>{formatAud(figures.total)}</span>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
        {([
          ['inclusions', 'job_inclusions', 'Inclusions'],
          ['exclusions', 'job_exclusions', 'Exclusions'],
          ['assumptions', 'job_assumptions', 'Assumptions'],
        ] as const).map(([key, jobKey, label]) => (
          <div key={key} style={{ display: 'grid', gap: 8 }}>
            <ClickToEditText
              label={label}
              hint="Standard. Saved for this company and used on every new job."
              asList
              value={standards[key]}
              onChange={value => editStandards({ [key]: value })}
            />
            <ClickToEditText
              label={`${label} for this job only`}
              hint="Unusual or one-off items. Printed after the standard ones, not carried to new jobs."
              asList
              emptyText="None. Click to add."
              value={capture[jobKey]}
              onChange={value => patch({ [jobKey]: value })}
            />
          </div>
        ))}
        <ClickToEditText label="Payment terms" value={standards.payment_terms} onChange={payment_terms => editStandards({ payment_terms })} />
        <div>
          <div style={LABEL}>Engagement agreement</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Saved for this company. The next contents clearance quote and surface cleaning quote start from this text. Brackets such as [name], [surface], [rate per m2], [labour amount], [deposit], and [total] are filled when the document is printed. A contents-clearance line is left out. The signature lines stay blank for signing.
          </div>
          {standardsReady && (
            <RichTextEditor
              value={standards.engagement_agreement}
              onChange={engagement_agreement => editStandards({ engagement_agreement })}
              minHeight={240}
            />
          )}
        </div>
      </div>
      <div style={{ marginTop: 18, marginBottom: 4 }}>
        <div style={LABEL}>Photos</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 12px' }}>
          Choose this quote&rsquo;s photos from the job&rsquo;s folder. They print after the totals. The engagement agreement stays last, for signing.
        </p>
        <SelectedPhotos
          jobId={job.id}
          title="Surface area cleaning quote"
          heading={false}
          photos={photos}
          ids={capture.photo_ids}
          fallback={photos.filter(isSurfaceAreaAppendixPhoto)}
          onChange={ids => setCapture(prev => ({ ...prev, photo_ids: ids }))}
          onPhotosUpdate={onPhotosUpdate}
          usedIds={usedIds}
          emptyText="No photos on this quote."
        />
      </div>
      {saveError && <div style={{ color: 'var(--danger, #f87171)', fontSize: 13, marginTop: 10 }}>{saveError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void saveAndCompose()} disabled={saving}>
          Generate quote
        </button>
      </div>
    </div>
  )
}
