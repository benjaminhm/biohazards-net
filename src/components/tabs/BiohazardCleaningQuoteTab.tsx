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
} from '@/lib/surfaceAreaCleaningQuote'
import {
  BIOHAZARD_CLEANING_CLIENT_TITLES,
  BIOHAZARD_EXTRA_LINE_PRESETS,
  biohazardClauseLines,
  biohazardCleaningFigures,
  biohazardJobDefaults,
  biohazardSquareMetres,
  emptyBiohazardCleaningCapture,
  newBiohazardLineId,
  normalizeBiohazardCleaningCapture,
  normalizeBiohazardCleaningClauses,
  resolvedAreaAffected,
  resolvedBiohazardKind,
  resolvedBiohazardType,
  resolvedObjective,
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
}: {
  label: string
  differs: boolean
  onSaveDefault: () => void
  onUseDefault: () => void
  savingDefault: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
      <div style={{ ...LABEL, marginBottom: 0 }}>{label}</div>
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

function FlagList({ title, flags }: { title: string; flags: BiohazardCheckFlag[] }): ReactNode {
  if (flags.length === 0) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }}>
        {flags.map(flag => (
          <li key={`${flag.code}:${flag.clause}:${flag.subject}`}>
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
  const [companyAddress, setCompanyAddress] = useState('')
  const [savingDefault, setSavingDefault] = useState<BiohazardClauseKey | null>(null)
  const [distanceBusy, setDistanceBusy] = useState(false)
  const [distanceNote, setDistanceNote] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<BiohazardCheckResult | null>(null)
  const [checkedKey, setCheckedKey] = useState('')
  const [generating, setGenerating] = useState(false)

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
  const biohazardType = resolvedBiohazardType(capture, defaults)
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
        setTemplate(normalizeBiohazardCleaningClauses(co?.biohazard_cleaning_standards ?? null, engagement))
        setCompanyAddress((co?.address ?? '').trim())
      })
      .catch(() => {
        if (!cancelled) setTemplate(normalizeBiohazardCleaningClauses(null))
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (template && capture.clauses == null) {
      setCapture(prev => (prev.clauses == null ? { ...prev, clauses: template } : prev))
    }
  }, [template, capture.clauses])

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
      const res = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biohazard_cleaning_standards: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || 'The default could not be saved.')
      }
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
      if (ok) router.push(`/jobs/${job.id}/docs/biohazard_cleaning_quote?compose=1`)
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
        />
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
            onChange={e => patch({ cleaning_kind: e.target.value as BiohazardCleaningCapture['cleaning_kind'] })}
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
          <label style={LABEL}>Biohazard type</label>
          <input
            value={biohazardType}
            onChange={e => patch({ biohazard_type: e.target.value })}
            placeholder="blood and bodily fluids"
            style={INPUT}
          />
          <div style={HINT}>Fills [biohazard type] in the scope and the clauses.</div>
        </div>
        <div>
          <label style={LABEL}>Area affected</label>
          <input
            value={areaAffected}
            onChange={e => patch({ area_affected: e.target.value })}
            placeholder="main bedroom and ensuite"
            style={INPUT}
          />
          <div style={HINT}>
            Fills [area affected].
            {defaults.assessmentAreaNames && defaults.assessmentAreaNames.length > 0
              ? ` Assessment areas: ${defaults.assessmentAreaNames.join(', ')}.`
              : ''}
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
          value={objective}
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
        <div style={LABEL}>Affected area</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Tick a room, or give the number of rooms, to add it at the average size. You can change the sizes below. The total is the floor, the ceiling, and the walls.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px', fontSize: 13, marginBottom: 10 }}>
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
        <div style={{ display: 'grid', gap: 8 }}>
          {capture.rooms.map(room => {
            const measure = roomSurfaceArea(room)
            const metres = (key: 'length_m' | 'width_m' | 'height_m', raw: string) =>
              setRooms(capture.rooms.map(item => item.id === room.id ? { ...item, [key]: numberOrNull(raw) } : item))
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
                  {measure ? `${measure.total.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²` : '—'}
                </div>
                <button type="button" className="btn" onClick={() => setRooms(capture.rooms.filter(item => item.id !== room.id))}>
                  Remove
                </button>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button type="button" className="btn" onClick={() => setRooms([...capture.rooms, newSurfaceAreaRoom()])}>
            Add a room
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div>
            <label style={LABEL}>Estimated square metres</label>
            {capture.rooms.length > 0 ? (
              <div style={{ ...INPUT, background: 'transparent' }}>
                {(biohazardSquareMetres(capture) ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 2 })}
              </div>
            ) : (
              <input
                type="number"
                min={0}
                step="0.01"
                value={capture.estimated_m2 ?? ''}
                onChange={e => patch({ estimated_m2: numberOrNull(e.target.value) })}
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
              value={capture.rate_per_m2 ?? ''}
              onChange={e => patch({ rate_per_m2: numberOrNull(e.target.value) })}
              placeholder="0.00"
              style={INPUT}
            />
          </div>
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
