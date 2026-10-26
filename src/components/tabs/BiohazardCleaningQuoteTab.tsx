'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import RichTextEditor from '@/components/RichTextEditor'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import { roundTripKm } from '@/lib/roundTripDistance'
import { sharedEngagementAgreement } from '@/lib/quoteEngagement'
import { normalizeContentsClearanceStandards } from '@/lib/contentsClearanceQuote'
import {
  SURFACE_AREA_ROOM_PRESETS,
  newSurfaceAreaRoom,
  normalizeSurfaceAreaCleaningStandards,
  presetRoomCount,
  roomSurfaceArea,
  roomsSurfaceTotal,
  setPresetRoomCount,
  type SurfaceAreaRoom,
} from '@/lib/surfaceAreaCleaningQuote'
import {
  BIOHAZARD_CLEANING_CLIENT_TITLES,
  BIOHAZARD_EXTRA_LINE_PRESETS,
  BIOHAZARD_REMEMBERED_KEYS,
  applyRememberedBiohazardClauses,
  biohazardCleaningDocumentTitle,
  rememberedBiohazardClauses,
  withRememberedBiohazardClauses,
  type BiohazardCleaningKind,
  biohazardClauseLines,
  biohazardCleaningFigures,
  biohazardJobDefaults,
  biohazardSecondarySquareMetres,
  biohazardSquareMetres,
  emptyBiohazardCleaningCapture,
  newBiohazardLineId,
  normalizeBiohazardCleaningCapture,
  normalizeBiohazardCleaningClauses,
  BIOHAZARD_AREA_SUGGESTIONS,
  BIOHAZARD_TYPE_SUGGESTIONS,
  SECONDARY_CONTAMINATION_SUGGESTIONS,
  resolvedAreaAffected,
  resolvedAreasAffected,
  resolvedBiohazardKind,
  resolvedBiohazardType,
  resolvedBiohazardTypes,
  resolvedObjective,
  resolvedOtherZone,
  resolvedSecondaryContamination,
  type BiohazardCleaningCapture,
  type BiohazardCleaningClauses,
  type BiohazardClauseKey,
} from '@/lib/biohazardCleaningQuote'
import {
  BIOHAZARD_CHECK_CLAUSE_LABEL,
  BIOHAZARD_GAP_CODES,
  biohazardCheckContext,
  biohazardClearedLabel,
  biohazardFlagText,
  biohazardRuleFlags,
  knownBiohazardCheck,
  type BiohazardCheckFlag,
  type BiohazardCheckResult,
} from '@/lib/biohazardCleaningCheck'
import type { BiohazardDraftWeakStep } from '@/lib/biohazardScopeDraft'

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

const HINT: CSSProperties = { fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }

const SECTION: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 12,
}

const AUTOSAVE_MS = 800

function numberOrNull(raw: string): number | null {
  return raw === '' ? null : Number(raw)
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
}

function ClauseHeader({
  label,
  differs,
  onSaveDefault,
  onUseDefault,
  savingDefault,
  action,
}: {
  label: string
  differs: boolean
  onSaveDefault: () => void
  onUseDefault: () => void
  savingDefault: boolean
  action?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...LABEL, marginBottom: 0 }}>{label}</div>
        {action}
      </div>
      {differs && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" style={{ fontSize: 12, padding: '2px 8px' }} onClick={onUseDefault}>
            Use the default
          </button>
          <button type="button" className="btn" style={{ fontSize: 12, padding: '2px 8px' }} onClick={onSaveDefault} disabled={savingDefault}>
            {savingDefault ? 'Saving…' : 'Save as default for future jobs'}
          </button>
        </div>
      )}
    </div>
  )
}

function ClickToEditText({
  value,
  onChange,
  asList,
  numbered,
}: {
  value: string
  onChange: (value: string) => void
  asList?: boolean
  numbered?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const items = biohazardClauseLines(value)
  const List = numbered ? 'ol' : 'ul'
  return editing ? (
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
        <List style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: 'grid', gap: 4 }}>
          {items.map((item, i) => <li key={`${i}:${item}`}>{item}</li>)}
        </List>
      ) : (
        <span style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{value.trim() || 'Click to edit'}</span>
      )}
    </button>
  )
}

function NameList({
  names,
  onChange,
  suggestions,
  placeholder,
}: {
  names: string[]
  onChange: (names: string[]) => void
  suggestions: readonly string[]
  placeholder: string
}) {
  const [draft, setDraft] = useState('')
  const has = (name: string) => names.some(item => item.trim().toLowerCase() === name.trim().toLowerCase())
  const add = (name: string) => {
    const clean = name.trim()
    if (!clean || has(clean)) return
    onChange([...names, clean])
  }
  const unused = [...new Set(suggestions.map(s => s.trim()).filter(Boolean))].filter(s => !has(s))
  return (
    <div>
      {names.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {names.map(name => (
            <span
              key={name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 4px 3px 10px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--surface-2, var(--bg))',
                fontSize: 13,
              }}
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(names.filter(item => item !== name))}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 4px' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
              setDraft('')
            }
          }}
          placeholder={placeholder}
          style={{ ...INPUT, flex: 1 }}
        />
        <button
          type="button"
          className="btn"
          disabled={!draft.trim()}
          onClick={() => {
            add(draft)
            setDraft('')
          }}
        >
          Add
        </button>
      </div>
      {unused.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {unused.map(name => (
            <button
              key={name}
              type="button"
              className="btn"
              onClick={() => add(name)}
              style={{ fontSize: 12, padding: '2px 8px' }}
            >
              + {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ZoneRooms({
  rooms,
  onRoomsChange,
  squareMetres,
  typedSquareMetres,
  onTypedSquareMetres,
  rate,
  onRate,
}: {
  rooms: SurfaceAreaRoom[]
  onRoomsChange: (rooms: SurfaceAreaRoom[]) => void
  squareMetres: number | null
  typedSquareMetres: number | null
  onTypedSquareMetres: (value: number | null) => void
  rate: number | null
  onRate: (value: number | null) => void
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Tick a room, or give the number of rooms, to add it at the average size. You can change the sizes below. The total is the floor, the ceiling, and the walls.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px', fontSize: 13, marginBottom: 10 }}>
        {SURFACE_AREA_ROOM_PRESETS.map(preset => {
          const count = presetRoomCount(rooms, preset.id)
          return (
            <label key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              {preset.multiple ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={count || ''}
                  placeholder="0"
                  onChange={e => onRoomsChange(setPresetRoomCount(rooms, preset, Math.min(20, Number(e.target.value) || 0)))}
                  style={{ ...INPUT, width: 52, padding: '4px 6px', fontSize: 13 }}
                />
              ) : (
                <input
                  type="checkbox"
                  checked={count > 0}
                  onChange={e => onRoomsChange(setPresetRoomCount(rooms, preset, e.target.checked ? 1 : 0))}
                />
              )}
              <span style={{ flex: 1 }}>{preset.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{preset.length_m} × {preset.width_m} × {preset.height_m} m</span>
            </label>
          )
        })}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rooms.map(room => {
          const measure = roomSurfaceArea(room)
          const metres = (key: 'length_m' | 'width_m' | 'height_m', raw: string) =>
            onRoomsChange(rooms.map(item => item.id === room.id ? { ...item, [key]: numberOrNull(raw) } : item))
          return (
            <div key={room.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.7fr auto auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={LABEL}>Room</label>
                <input
                  value={room.name}
                  onChange={e => onRoomsChange(rooms.map(item => item.id === room.id ? { ...item, name: e.target.value } : item))}
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
                {measure ? `${measure.total.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²` : '—'}
              </div>
              <button type="button" className="btn" onClick={() => onRoomsChange(rooms.filter(item => item.id !== room.id))}>
                Remove
              </button>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <button type="button" className="btn" onClick={() => onRoomsChange([...rooms, newSurfaceAreaRoom()])}>
          Add a room
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={LABEL}>Estimated square metres</label>
          {rooms.length > 0 ? (
            <div style={{ ...INPUT, background: 'transparent' }}>
              {(squareMetres ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 2 })}
            </div>
          ) : (
            <input
              type="number"
              min={0}
              step="0.01"
              value={typedSquareMetres ?? ''}
              onChange={e => onTypedSquareMetres(numberOrNull(e.target.value))}
              placeholder="0"
              style={INPUT}
            />
          )}
        </div>
        <div>
          <label style={LABEL}>Rate per m² ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={rate ?? ''}
            onChange={e => onRate(numberOrNull(e.target.value))}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
      </div>
    </>
  )
}

function FlagList({ title, flags }: { title: string; flags: BiohazardCheckFlag[] }): ReactNode {
  if (flags.length === 0) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }}>
        {flags.map(flag => (
          <li key={`${flag.code}:${flag.clause}:${flag.subject}:${flag.evidence ?? ''}`}>
            <strong>{BIOHAZARD_CHECK_CLAUSE_LABEL[flag.clause]}.</strong> {biohazardFlagText(flag)}
            {flag.evidence && <span style={{ color: 'var(--text-muted)' }}> “{flag.evidence}”</span>}
            {flag.source === 'ai' && <span style={{ color: 'var(--text-muted)' }}> (AI check)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function BiohazardCleaningQuoteTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const initial = useMemo(
    () => normalizeBiohazardCleaningCapture(job.assessment_data?.biohazard_cleaning_quote ?? emptyBiohazardCleaningCapture()),
    // The job copy is read once per job. Later job updates come from this tab's own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job.id],
  )
  const [capture, setCapture] = useState<BiohazardCleaningCapture>(initial)
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [template, setTemplate] = useState<BiohazardCleaningClauses | null>(null)
  const [standardsRaw, setStandardsRaw] = useState<unknown>(null)
  const [companyAddress, setCompanyAddress] = useState('')
  const [savingDefault, setSavingDefault] = useState<BiohazardClauseKey | null>(null)
  const [distanceBusy, setDistanceBusy] = useState(false)
  const [distanceNote, setDistanceNote] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<BiohazardCheckResult | null>(null)
  const [checkedKey, setCheckedKey] = useState('')
  const [generating, setGenerating] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [scopeDraft, setScopeDraft] = useState<string | null>(null)
  const [scopeDraftWeak, setScopeDraftWeak] = useState<BiohazardDraftWeakStep[]>([])
  const [draftError, setDraftError] = useState('')

  const captureRef = useRef(capture)
  const jobRef = useRef(job)
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true))
  const distanceSeq = useRef(0)
  const autoDistanceTried = useRef(false)
  captureRef.current = capture
  jobRef.current = job

  useEffect(() => {
    setCapture(initial)
    setSavedJson(JSON.stringify(initial))
    setCheck(null)
    setCheckedKey('')
    autoDistanceTried.current = false
  }, [initial])

  const captureJson = useMemo(() => JSON.stringify(capture), [capture])
  const isDirty = captureJson !== savedJson
  useRegisterUnsavedChanges('biohazard-cleaning-quote', isDirty)

  const defaults = useMemo(() => biohazardJobDefaults(job, companyAddress), [job, companyAddress])
  const figures = useMemo(() => biohazardCleaningFigures(capture), [capture])
  const kind = resolvedBiohazardKind(capture, job.job_type)
  const biohazardTypes = resolvedBiohazardTypes(capture, defaults)
  const biohazardType = resolvedBiohazardType(capture, defaults)
  const areasAffected = resolvedAreasAffected(capture, defaults)
  const areaAffected = resolvedAreaAffected(capture, defaults)
  const objective = resolvedObjective(capture, defaults)
  const clauses = capture.clauses ?? template
  const checkKey = useMemo(() => JSON.stringify({ ...capture, check_override: null, defaults }), [capture, defaults])
  const shownCheck = checkedKey === checkKey ? check : null

  useEffect(() => {
    let cancelled = false
    fetch('/api/company')
      .then(r => r.json())
      .then((data: { company?: { address?: string | null; contents_clearance_standards?: unknown; surface_area_cleaning_standards?: unknown; biohazard_cleaning_standards?: unknown } }) => {
        if (cancelled) return
        const co = data.company
        const engagement = sharedEngagementAgreement(
          normalizeContentsClearanceStandards(co?.contents_clearance_standards).engagement_agreement,
          normalizeSurfaceAreaCleaningStandards(co?.surface_area_cleaning_standards).engagement_agreement,
        )
        setStandardsRaw(co?.biohazard_cleaning_standards ?? null)
        setTemplate(normalizeBiohazardCleaningClauses(co?.biohazard_cleaning_standards ?? null, engagement))
        setCompanyAddress((co?.address ?? '').trim())
      })
      .catch(() => {
        if (!cancelled) setTemplate(normalizeBiohazardCleaningClauses(null))
      })
    return () => { cancelled = true }
  }, [])

  const remembered = useMemo(() => rememberedBiohazardClauses(standardsRaw, kind), [standardsRaw, kind])

  useEffect(() => {
    if (template && capture.clauses == null) {
      setCapture(prev => {
        if (prev.clauses != null) return prev
        return remembered
          ? { ...prev, clauses: applyRememberedBiohazardClauses(template, remembered), clauses_from_kind: kind }
          : { ...prev, clauses: template, clauses_from_kind: null }
      })
    }
  }, [template, capture.clauses, remembered, kind])

  /** True when the four remembered clauses have not been edited on this job. */
  function rememberedClausesUntouched(current: BiohazardCleaningCapture): boolean {
    if (!current.clauses || !template) return true
    const source = current.clauses_from_kind
      ? rememberedBiohazardClauses(standardsRaw, current.clauses_from_kind)
      : null
    return BIOHAZARD_REMEMBERED_KEYS.every(key =>
      sameText(current.clauses![key], (source ?? template)[key]),
    )
  }

  function changeKind(next: BiohazardCleaningKind) {
    setCapture(prev => {
      const updated = { ...prev, cleaning_kind: next }
      if (!prev.clauses || !template || !rememberedClausesUntouched(prev)) return updated
      const memory = rememberedBiohazardClauses(standardsRaw, next)
      return memory
        ? { ...updated, clauses: applyRememberedBiohazardClauses(prev.clauses, memory), clauses_from_kind: next }
        : { ...updated, clauses: applyRememberedBiohazardClauses(prev.clauses, { ...template, job_id: null, saved_at: null }), clauses_from_kind: null }
    })
  }

  function applyLastKindClauses() {
    if (!remembered) return
    setCapture(prev => {
      const base = prev.clauses ?? template
      if (!base) return prev
      return { ...prev, clauses: applyRememberedBiohazardClauses(base, remembered), clauses_from_kind: kind }
    })
  }

  async function saveCompanyStandards(next: Record<string, unknown>): Promise<void> {
    const res = await fetch('/api/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ biohazard_cleaning_standards: next }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error || 'The company clauses could not be saved.')
    }
    setStandardsRaw(next)
  }

  const persist = useCallback((next: BiohazardCleaningCapture): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      setSaveState('saving')
      try {
        const current = jobRef.current
        const merged = mergeAssessmentData(current.assessment_data)
        const res = await fetch(`/api/jobs/${current.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assessment_data: { ...merged, biohazard_cleaning_quote: next } }),
        })
        const data = (await res.json()) as { job?: Job; error?: string }
        if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
        jobRef.current = data.job
        onJobUpdate(data.job)
        setSavedJson(JSON.stringify(next))
        setSaveState('idle')
        setSaveError('')
        return true
      } catch (e) {
        setSaveState('error')
        setSaveError(e instanceof Error ? e.message : 'Save failed')
        return false
      }
    }
    saveChain.current = saveChain.current.then(run, run)
    return saveChain.current
  }, [onJobUpdate])

  useEffect(() => {
    if (!isDirty) return
    const timer = window.setTimeout(() => { void persist(captureRef.current) }, AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [captureJson, isDirty, persist])

  function patch(next: Partial<BiohazardCleaningCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
  }

  function setRooms(rooms: BiohazardCleaningCapture['rooms']) {
    const total = roomsSurfaceTotal(rooms)
    setCapture(prev => ({ ...prev, rooms, estimated_m2: total ?? prev.estimated_m2 }))
  }

  function setSecondaryRooms(secondary_rooms: BiohazardCleaningCapture['secondary_rooms']) {
    const total = roomsSurfaceTotal(secondary_rooms)
    setCapture(prev => ({ ...prev, secondary_rooms, secondary_m2: total ?? prev.secondary_m2 }))
  }

  function editClause(key: BiohazardClauseKey, value: string) {
    setCapture(prev => {
      const base = prev.clauses ?? template
      if (!base) return prev
      return { ...prev, clauses: { ...base, [key]: value } }
    })
  }

  async function saveClauseAsDefault(key: BiohazardClauseKey) {
    if (!clauses || !template) return
    const next = { ...template, [key]: clauses[key] }
    setSavingDefault(key)
    try {
      const base = standardsRaw && typeof standardsRaw === 'object' ? standardsRaw as Record<string, unknown> : {}
      await saveCompanyStandards({ ...base, ...next })
      setTemplate(next)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The default could not be saved.')
    } finally {
      setSavingDefault(null)
    }
  }

  const baseAddress = (capture.base_address ?? companyAddress).trim()
  const jobAddress = (capture.job_address ?? job.site_address ?? '').trim()

  const lookUpDistance = useCallback(async (override?: Partial<BiohazardCleaningCapture>, manual = false) => {
    const seq = ++distanceSeq.current
    const current = { ...captureRef.current, ...override }
    const site = jobRef.current
    const from = (current.base_address ?? companyAddress).trim()
    const to = (current.job_address ?? site.site_address ?? '').trim()
    if (!from || !to) {
      if (manual) setDistanceNote('Add the base address and the job address first.')
      return
    }
    const pin = (lat: number | null | undefined, lng: number | null | undefined) =>
      typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null
    setDistanceBusy(true)
    setDistanceNote('')
    try {
      const jobPin = current.job_address == null
        ? pin(current.job_lat ?? site.site_lat, current.job_lng ?? site.site_lng)
        : pin(current.job_lat, current.job_lng)
      const result = await roundTripKm(
        { address: from, pin: pin(current.base_lat, current.base_lng) },
        { address: to, pin: jobPin },
      )
      if (seq !== distanceSeq.current) return
      if (result.km == null) {
        setDistanceNote('Driving distance is unavailable. You can type the kilometres.')
        return
      }
      const km = Math.round(result.km * 10) / 10
      setCapture(prev => ({
        ...prev,
        ...override,
        base_lat: result.origin?.lat ?? prev.base_lat,
        base_lng: result.origin?.lng ?? prev.base_lng,
        job_lat: result.dest?.lat ?? prev.job_lat,
        job_lng: result.dest?.lng ?? prev.job_lng,
        travel_km: km,
        travel_from_maps: true,
      }))
      setDistanceNote('Added from Google Maps: the drive from the base to the job and back.')
    } catch {
      if (seq === distanceSeq.current) setDistanceNote('Driving distance is unavailable. You can type the kilometres.')
    } finally {
      if (seq === distanceSeq.current) setDistanceBusy(false)
    }
  }, [companyAddress])

  useEffect(() => {
    if (autoDistanceTried.current) return
    if (capture.travel_km != null || !baseAddress || !jobAddress) return
    autoDistanceTried.current = true
    void lookUpDistance()
  }, [baseAddress, jobAddress, capture.travel_km, lookUpDistance])

  async function runCheck(): Promise<BiohazardCheckResult> {
    const context = biohazardCheckContext(job, companyAddress)
    const fallback = (): BiohazardCheckResult => ({
      flags: biohazardRuleFlags(capture, context, template),
      cleared: [],
      model: false,
    })
    let result: BiohazardCheckResult
    try {
      const res = await fetch(`/api/jobs/${job.id}/biohazard-cleaning-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capture: { ...capture, clauses } }),
      })
      const data: unknown = await res.json()
      result = (res.ok ? knownBiohazardCheck(data) : null) ?? fallback()
    } catch {
      result = fallback()
    }
    setCheck(result)
    setCheckedKey(checkKey)
    return result
  }

  async function draftScope() {
    if (drafting) return
    setDrafting(true)
    setDraftError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/biohazard-scope-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capture: { ...capture, clauses } }),
      })
      const data = (await res.json().catch(() => ({}))) as { scope?: string; weak?: BiohazardDraftWeakStep[]; error?: string }
      if (!res.ok || !data.scope) throw new Error(data.error || 'The scope could not be drafted.')
      setScopeDraft(data.scope)
      setScopeDraftWeak(Array.isArray(data.weak) ? data.weak : [])
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'The scope could not be drafted.')
    } finally {
      setDrafting(false)
    }
  }

  function applyScopeDraft() {
    if (scopeDraft == null) return
    editClause('scope_of_work', scopeDraft)
    setScopeDraft(null)
    setScopeDraftWeak([])
  }

  const draftMissingStages = useMemo(() => {
    if (scopeDraft == null || !clauses) return []
    return biohazardRuleFlags(
      { ...capture, clauses: { ...clauses, scope_of_work: scopeDraft } },
      biohazardCheckContext(job, companyAddress),
      template,
    )
      .filter(flag => flag.code === 'stage_missing')
      .map(flag => biohazardFlagText(flag))
  }, [scopeDraft, capture, clauses, job, companyAddress, template])

  async function checkOnly() {
    if (checking) return
    setChecking(true)
    try {
      await runCheck()
    } finally {
      setChecking(false)
    }
  }

  async function generate() {
    if (!(capture.labour_days != null && capture.labour_days > 0)) {
      setSaveError('Enter the labour days before generating the quote.')
      return
    }
    if (checking || generating) return
    let result = shownCheck
    if (!result) {
      setChecking(true)
      try {
        result = await runCheck()
      } finally {
        setChecking(false)
      }
      if (result.flags.length > 0) return
    }
    setGenerating(true)
    try {
      const next: BiohazardCleaningCapture = {
        ...captureRef.current,
        clauses: captureRef.current.clauses ?? template,
        check_override: result.flags.length > 0
          ? { at: new Date().toISOString(), codes: [...new Set(result.flags.map(flag => flag.code))] }
          : null,
      }
      setCapture(next)
      const ok = await persist(next)
      if (!ok) return
      if (next.clauses) {
        try {
          await saveCompanyStandards(
            withRememberedBiohazardClauses(standardsRaw, kind, next.clauses, job.id, new Date().toISOString()),
          )
        } catch {
          // The quote is saved on the job. Remembering the clauses for the next job is best effort.
        }
      }
      router.push(`/jobs/${job.id}/docs/biohazard_cleaning_quote?compose=1`)
    } finally {
      setGenerating(false)
    }
  }

  const labourLine = figures.lines.find(line => line.kind === 'labour')
  const gapFlags = shownCheck?.flags.filter(flag => BIOHAZARD_GAP_CODES.has(flag.code)) ?? []
  const consistencyFlags = shownCheck?.flags.filter(flag => !BIOHAZARD_GAP_CODES.has(flag.code)) ?? []
  const saveStatus = saveState === 'saving'
    ? 'Saving…'
    : saveState === 'error'
      ? 'Not saved'
      : isDirty ? 'Unsaved changes' : 'Saved'

  function clauseBlock(key: BiohazardClauseKey, label: string, kindOf: 'list' | 'numbered' | 'text') {
    if (!clauses) return null
    const differs = template != null && !sameText(clauses[key], template[key])
    return (
      <div>
        <ClauseHeader
          label={label}
          differs={differs}
          savingDefault={savingDefault === key}
          onSaveDefault={() => void saveClauseAsDefault(key)}
          onUseDefault={() => template && editClause(key, template[key])}
          action={key === 'scope_of_work' ? (
            <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => void draftScope()} disabled={drafting}>
              {drafting ? 'Generating…' : 'Generate scope of work'}
            </button>
          ) : undefined}
        />
        {key === 'scope_of_work' && (
          <div style={{ ...HINT, marginTop: 0, marginBottom: 6 }}>
            Written from the biohazard types, zones, rooms, objectives, and assessment. You review it before it replaces the scope below.
            {draftError && <span style={{ color: 'var(--danger, #f87171)' }}> {draftError}</span>}
          </div>
        )}
        {key === 'scope_of_work' && scopeDraft != null && (
          <div style={{ ...SECTION, marginBottom: 8, borderStyle: 'dashed' }}>
            <div style={LABEL}>Generated scope of work</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: 'grid', gap: 4 }}>
              {scopeDraft.split('\n').map((line, i) => <li key={`${i}:${line}`}>{line}</li>)}
            </ol>
            {draftMissingStages.length > 0 && (
              <div style={{ ...HINT, color: 'var(--danger, #f87171)' }}>{draftMissingStages.join(' ')}</div>
            )}
            {scopeDraftWeak.map(step => (
              <div key={`${step.gap}:${step.line}`} style={{ ...HINT, color: 'var(--danger, #f87171)' }}>
                {biohazardFlagText({ code: 'scope_not_auditable', subject: step.gap })} “{step.line}”
              </div>
            ))}
            <div style={HINT}>The hygienist and testing lines are added on the quote when they are ticked.</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={applyScopeDraft}>
                Use this scope
              </button>
              <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setScopeDraft(null); setScopeDraftWeak([]) }}>
                Discard
              </button>
            </div>
          </div>
        )}
        <ClickToEditText
          value={clauses[key]}
          onChange={value => editClause(key, value)}
          asList={kindOf !== 'text'}
          numbered={kindOf === 'numbered'}
        />
      </div>
    )
  }

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Biohazard Cleaning Quote
        </div>
        <div style={{ fontSize: 12, color: saveState === 'error' ? 'var(--danger, #f87171)' : 'var(--text-muted)' }}>{saveStatus}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>For the client, this is</label>
          <select
            value={kind}
            onChange={e => changeKind(e.target.value as BiohazardCleaningKind)}
            style={INPUT}
          >
            {BIOHAZARD_CLEANING_CLIENT_TITLES.map(option => (
              <option key={option.id} value={option.id}>{option.title}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={LABEL}>Client</div>
          <div style={{ fontSize: 14, paddingTop: 8 }}>{job.client_name || '—'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={LABEL}>Biohazard types</div>
          <NameList
            names={biohazardTypes}
            onChange={names => patch({ biohazard_types: names })}
            suggestions={BIOHAZARD_TYPE_SUGGESTIONS}
            placeholder="Add a biohazard type"
          />
          <div style={HINT}>
            Fills [biohazard type]{biohazardType ? `: “${biohazardType}”` : ''}.
          </div>
        </div>
        <div>
          <div style={LABEL}>Primary decontamination zone</div>
          <NameList
            names={areasAffected}
            onChange={names => patch({ areas_affected: names })}
            suggestions={[...(defaults.assessmentAreaNames ?? []), ...BIOHAZARD_AREA_SUGGESTIONS]}
            placeholder="Add an area"
          />
          <div style={HINT}>
            Areas affected by bodily fluids. Fills [area affected]{areaAffected ? `: “${areaAffected}”` : ''}.
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={LABEL}>Description</label>
        <textarea
          value={capture.description}
          onChange={e => patch({ description: e.target.value })}
          rows={3}
          placeholder="What happened, and what was found onsite."
          style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL}>Objective</label>
        <textarea
          value={capture.objective ?? objective}
          onChange={e => patch({ objective: e.target.value })}
          rows={2}
          placeholder="The outcome this cleaning is meant to achieve."
          style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
        {capture.objective == null && objective && <div style={HINT}>From the Scope of Work objective.</div>}
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
            placeholder="No call-out charge, as already onsite for another job."
            style={{ ...INPUT, marginTop: 8, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        ) : (
          <>
            <label style={{ ...LABEL, marginTop: 8 }}>Call-out fee ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.mobilisation_fee ?? ''}
              onChange={e => patch({ mobilisation_fee: numberOrNull(e.target.value) })}
              placeholder="0.00"
              style={INPUT}
            />
            <div style={HINT}>Attendance and setup, ex GST. It is added to the quote when the amount is more than zero.</div>
          </>
        )}
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Travel</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={LABEL}>Base address</label>
            <AddressAutocomplete
              value={capture.base_address ?? companyAddress}
              lat={capture.base_lat}
              lng={capture.base_lng}
              placeholder="Start typing the base address…"
              style={INPUT}
              onChange={next => {
                const sameAsCompany = next.address.trim() === companyAddress
                const update = { base_address: sameAsCompany ? null : next.address, base_lat: next.lat, base_lng: next.lng }
                patch(update)
                if (next.lat != null && next.lng != null) void lookUpDistance(update)
              }}
            />
            <div style={HINT}>The company address unless changed here.</div>
          </div>
          <div>
            <label style={LABEL}>Job address</label>
            <AddressAutocomplete
              value={capture.job_address ?? job.site_address ?? ''}
              lat={capture.job_address == null ? (capture.job_lat ?? job.site_lat) : capture.job_lat}
              lng={capture.job_address == null ? (capture.job_lng ?? job.site_lng) : capture.job_lng}
              placeholder="Start typing the job address…"
              style={INPUT}
              onChange={next => {
                const sameAsJob = next.address.trim() === (job.site_address ?? '').trim()
                const update = { job_address: sameAsJob ? null : next.address, job_lat: next.lat, job_lng: next.lng }
                patch(update)
                if (next.lat != null && next.lng != null) void lookUpDistance(update)
              }}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LABEL}>Return trip (km){capture.travel_from_maps ? ' · from map' : ''}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={0}
                step="0.1"
                value={capture.travel_km ?? ''}
                onChange={e => patch({ travel_km: numberOrNull(e.target.value), travel_from_maps: false })}
                placeholder="0"
                style={{ ...INPUT, flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                disabled={distanceBusy || !baseAddress || !jobAddress}
                onClick={() => void lookUpDistance(undefined, true)}
              >
                {distanceBusy ? '…' : 'Look up'}
              </button>
            </div>
            {distanceNote && <div style={HINT}>{distanceNote}</div>}
          </div>
          <div>
            <label style={LABEL}>Rate per km ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.rate_per_km ?? ''}
              onChange={e => patch({ rate_per_km: numberOrNull(e.target.value) })}
              placeholder="0.00"
              style={INPUT}
            />
          </div>
        </div>
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Primary zone: decontamination</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Surfaces affected by bodily fluids. The primary zone is named under Details above.
        </div>
        <ZoneRooms
          rooms={capture.rooms}
          onRoomsChange={setRooms}
          squareMetres={biohazardSquareMetres(capture)}
          typedSquareMetres={capture.estimated_m2}
          onTypedSquareMetres={value => patch({ estimated_m2: value })}
          rate={capture.rate_per_m2}
          onRate={value => patch({ rate_per_m2: value })}
        />
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Secondary zone</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Areas affected by odour or flies, but not by bodily fluids. Leave it blank when there is none, and it stays off the quote.
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={LABEL}>Areas</label>
          <input
            value={capture.secondary_zone}
            onChange={e => patch({ secondary_zone: e.target.value })}
            placeholder="hallway, lounge, and kitchen"
            style={INPUT}
          />
          <div style={HINT}>Fills [secondary zone] in the scope and the clauses.</div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={LABEL}>Contaminations</div>
          <NameList
            names={capture.secondary_contaminations}
            onChange={names => patch({ secondary_contaminations: names })}
            suggestions={SECONDARY_CONTAMINATION_SUGGESTIONS}
            placeholder="Add a contamination"
          />
          <div style={HINT}>
            Fills [secondary contamination]{resolvedSecondaryContamination(capture) ? `: “${resolvedSecondaryContamination(capture)}”` : ''}.
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={LABEL}>Objective</label>
          <textarea
            value={capture.secondary_objective}
            onChange={e => patch({ secondary_objective: e.target.value })}
            rows={2}
            placeholder="Remove the odour and the flies from these areas."
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        </div>
        <ZoneRooms
          rooms={capture.secondary_rooms}
          onRoomsChange={setSecondaryRooms}
          squareMetres={biohazardSecondarySquareMetres(capture)}
          typedSquareMetres={capture.secondary_m2}
          onTypedSquareMetres={value => patch({ secondary_m2: value })}
          rate={capture.secondary_rate_per_m2}
          onRate={value => patch({ secondary_rate_per_m2: value })}
        />
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Other zones, considered non-affected</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Areas other than the primary and secondary zones. They are listed in the exclusions as inspected and considered non-affected.
        </div>
        <NameList
          names={capture.other_zones}
          onChange={names => patch({ other_zones: names })}
          suggestions={[...(defaults.assessmentAreaNames ?? []), ...BIOHAZARD_AREA_SUGGESTIONS].filter(name => {
            const lower = name.trim().toLowerCase()
            return !areasAffected.some(area => area.trim().toLowerCase() === lower)
              && !(capture.secondary_zone ?? '').toLowerCase().includes(lower)
          })}
          placeholder="Add a non-affected area"
        />
        <div style={HINT}>
          Fills [other zones]{resolvedOtherZone(capture) ? `: “${resolvedOtherZone(capture)}”` : ''}. Leave the list blank to keep the generic exclusion only.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Labour days</label>
          <input
            type="number"
            min={1}
            step={1}
            value={capture.labour_days ?? ''}
            onChange={e => patch({ labour_days: numberOrNull(e.target.value) })}
            style={INPUT}
          />
          <div style={HINT}>
            {figures.labour_days > 0
              ? `${figures.labour_days} labour ${figures.labour_days === 1 ? 'day' : 'days'} × ${formatAud(figures.rate_per_labour_day)} = ${formatAud(labourLine?.amount ?? 0)}`
              : 'Required before the quote can be generated.'}
          </div>
        </div>
        <div>
          <label style={LABEL}>Rate per person per day ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_labour_day ?? ''}
            onChange={e => patch({ rate_per_labour_day: numberOrNull(e.target.value) })}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Hygienist and verification</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Each one ticked adds a line to the scope of work and a line to the quote.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={capture.coh_rap} onChange={e => patch({ coh_rap: e.target.checked })} />
          Certified Occupational Hygienist: Remediation Action Plan (RAP)
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
            <div style={HINT}>Added first in the scope: the COH inspects the site and prepares the RAP before the works start.</div>
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
        <div style={{ ...HINT, marginLeft: 24 }}>Verification is both ATP testing and laboratory testing.</div>
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
            <div style={{ ...HINT, marginTop: 0 }}>
              Added last in the scope: the COH verifies the decontamination by ATP testing and by laboratory testing. Each is its own line on the quote.
            </div>
          </div>
        )}
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Other fixed lines</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {capture.extra_lines.map(line => {
            const update = (next: Partial<typeof line>) =>
              patch({ extra_lines: capture.extra_lines.map(item => item.id === line.id ? { ...item, ...next } : item) })
            return (
              <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.6fr 0.7fr 0.8fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={LABEL}>Item</label>
                  <input value={line.label} onChange={e => update({ label: e.target.value })} style={INPUT} />
                </div>
                <div>
                  <label style={LABEL}>Qty</label>
                  <input type="number" min={0} step="0.01" value={line.quantity ?? ''} onChange={e => update({ quantity: numberOrNull(e.target.value) })} style={INPUT} />
                </div>
                <div>
                  <label style={LABEL}>Unit</label>
                  <input value={line.unit} onChange={e => update({ unit: e.target.value })} style={INPUT} />
                </div>
                <div>
                  <label style={LABEL}>Rate ($)</label>
                  <input type="number" min={0} step="0.01" value={line.rate ?? ''} onChange={e => update({ rate: numberOrNull(e.target.value) })} placeholder="0.00" style={INPUT} />
                </div>
                <button type="button" className="btn" onClick={() => patch({ extra_lines: capture.extra_lines.filter(item => item.id !== line.id) })}>
                  Remove
                </button>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {BIOHAZARD_EXTRA_LINE_PRESETS.map(preset => (
            <button
              key={preset.label}
              type="button"
              className="btn"
              onClick={() => patch({ extra_lines: [...capture.extra_lines, { id: newBiohazardLineId(), label: preset.label, quantity: 1, unit: preset.unit, rate: null }] })}
            >
              + {preset.label}
            </button>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => patch({ extra_lines: [...capture.extra_lines, { id: newBiohazardLineId(), label: '', quantity: 1, unit: '', rate: null }] })}
          >
            Add a line
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 6, fontSize: 14 }}>
        {figures.lines.map((line, i) => (
          <div key={`${line.kind}:${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{line.label} · {line.quantity.toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}</span>
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
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          These clauses start from the company default and are kept on this job. [biohazard type] and [area affected] are filled when the quote is printed. Use “Save as default for future jobs” to update the company default with this job’s wording.
        </div>
        {(remembered || capture.clauses_from_kind) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <span>
              {capture.clauses_from_kind === kind && remembered
                ? `Inclusions, exclusions, assumptions, and the engagement agreement are from the last ${biohazardCleaningDocumentTitle(kind)} quote${remembered.saved_at ? ` (${new Date(remembered.saved_at).toLocaleDateString('en-AU')})` : ''}. Generating this quote remembers them for the next one.`
                : remembered
                  ? `There are remembered clauses from the last ${biohazardCleaningDocumentTitle(kind)} quote.`
                  : `Generating this quote remembers these clauses for the next ${biohazardCleaningDocumentTitle(kind)} quote.`}
            </span>
            {remembered && clauses && BIOHAZARD_REMEMBERED_KEYS.some(key => !sameText(clauses[key], remembered[key])) && (
              <button type="button" className="btn" style={{ fontSize: 12, padding: '2px 8px' }} onClick={applyLastKindClauses}>
                Use the last {biohazardCleaningDocumentTitle(kind)} clauses
              </button>
            )}
          </div>
        )}
        {clauseBlock('scope_of_work', 'Scope of work', 'numbered')}
        {clauseBlock('inclusions', 'Inclusions', 'list')}
        {clauseBlock('exclusions', 'Exclusions', 'list')}
        {clauseBlock('assumptions', 'Assumptions', 'list')}
        {clauseBlock('payment_terms', 'Payment terms', 'text')}
        {clauses && (
          <div>
            <ClauseHeader
              label="Engagement agreement"
              differs={template != null && !sameText(clauses.engagement_agreement, template.engagement_agreement)}
              savingDefault={savingDefault === 'engagement_agreement'}
              onSaveDefault={() => void saveClauseAsDefault('engagement_agreement')}
              onUseDefault={() => template && editClause('engagement_agreement', template.engagement_agreement)}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              Brackets such as [name], [biohazard type], [area affected], [surface], [kilometres], [labour amount], [deposit], and [total] are filled when the document is printed. The signature lines stay blank for signing.
            </div>
            <RichTextEditor
              value={clauses.engagement_agreement}
              onChange={value => editClause('engagement_agreement', value)}
              minHeight={240}
            />
          </div>
        )}
      </div>

      {shownCheck && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${shownCheck.flags.length > 0 ? '#b45309' : 'var(--border)'}`,
            background: shownCheck.flags.length > 0 ? 'rgba(180, 83, 9, 0.08)' : 'transparent',
          }}
        >
          {shownCheck.flags.length === 0 && (
            <div style={{ fontWeight: 700, fontSize: 13 }}>No gaps or contradictions found.</div>
          )}
          <FlagList title="Gaps" flags={gapFlags} />
          <FlagList title="Contradictions" flags={consistencyFlags} />
          {shownCheck.cleared.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Covered in other words</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13, color: 'var(--text-muted)' }}>
                {shownCheck.cleared.map(item => (
                  <li key={`${item.code}:${item.subject}`}>{biohazardClearedLabel(item)}, matched “{item.evidence}”</li>
                ))}
              </ul>
            </div>
          )}
          {!shownCheck.model && (
            <div style={{ ...HINT, marginTop: 8 }}>The AI check did not run. These are the rule checks only.</div>
          )}
        </div>
      )}

      {saveError && <div style={{ color: 'var(--danger, #f87171)', fontSize: 13, marginTop: 10 }}>{saveError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn" onClick={() => void checkOnly()} disabled={checking || generating}>
          {checking ? 'Checking…' : 'Check quote'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={checking || generating || !clauses}>
          {checking
            ? 'Checking…'
            : generating
              ? 'Saving…'
              : shownCheck && shownCheck.flags.length > 0 ? 'Generate anyway' : 'Generate quote'}
        </button>
      </div>
    </div>
  )
}
