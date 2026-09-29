'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import type { Job } from '@/lib/types'
import { browserDrivingRoundTripKm, browserGeocodeAddress, type MapWaypoint } from '@/lib/geocodeBrowser'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  CONTENTS_CLEARANCE_SCHEMA,
  clauseLines,
  contentsClearanceFigures,
  defaultContentsClearanceStandards,
  emptyContentsClearanceCapture,
  normalizeContentsClearanceCapture,
  normalizeContentsClearanceStandards,
  type ContentsClearanceCapture,
  type ContentsClearanceStandards,
} from '@/lib/contentsClearanceQuote'

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

async function pinFor(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng }
  }
  const fromBrowser = await browserGeocodeAddress(address)
  if (fromBrowser) return fromBrowser
  try {
    const res = await fetch('/api/geocode/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    const data = (await res.json()) as { lat?: number | null; lng?: number | null }
    if (typeof data.lat === 'number' && typeof data.lng === 'number' && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
      return { lat: data.lat, lng: data.lng }
    }
  } catch {
    /* server geocode is the fallback */
  }
  return null
}

async function serverRoundTripKm(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): Promise<number | null> {
  try {
    const res = await fetch('/api/geocode/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originLat: origin.lat,
        originLng: origin.lng,
        destLat: dest.lat,
        destLng: dest.lng,
      }),
    })
    const data = (await res.json()) as { km?: number | null }
    if (!res.ok) return null
    return typeof data.km === 'number' && Number.isFinite(data.km) && data.km >= 0 ? data.km : null
  } catch {
    return null
  }
}

function ClickToEditText({
  label,
  value,
  onChange,
  asList,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  asList?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const items = clauseLines(value)
  return (
    <div>
      <div style={LABEL}>{label}</div>
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
            <span style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{value.trim() || 'Click to edit'}</span>
          )}
        </button>
      )}
    </div>
  )
}

export default function ContentsClearanceQuoteTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeContentsClearanceCapture(job.assessment_data?.contents_clearance_quote ?? emptyContentsClearanceCapture()),
    [job.assessment_data?.contents_clearance_quote],
  )
  const [capture, setCapture] = useState<ContentsClearanceCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [standards, setStandards] = useState<ContentsClearanceStandards>(defaultContentsClearanceStandards)
  const [standardsReady, setStandardsReady] = useState(false)
  const [distanceBusy, setDistanceBusy] = useState(false)
  const [distanceNote, setDistanceNote] = useState('')
  const skipStandardsSave = useRef(true)
  const distanceSeq = useRef(0)
  const appliedDistanceKey = useRef('')
  const captureRef = useRef(capture)
  const jobRef = useRef(job)
  captureRef.current = capture
  jobRef.current = job

  useEffect(() => {
    setCapture(normalizeContentsClearanceCapture(job.assessment_data?.contents_clearance_quote))
  }, [job.id, job.updated_at])

  const isDirty = capture.estimated_m3 !== saved.estimated_m3
    || capture.estimated_km !== saved.estimated_km
    || capture.rate_per_m3 !== saved.rate_per_m3
    || capture.rate_per_km !== saved.rate_per_km
    || capture.rate_per_labour_day !== saved.rate_per_labour_day
    || capture.job_address !== saved.job_address
    || capture.job_lat !== saved.job_lat
    || capture.job_lng !== saved.job_lng
    || capture.tip_address !== saved.tip_address
    || capture.tip_lat !== saved.tip_lat
    || capture.tip_lng !== saved.tip_lng
    || capture.return_trip_km !== saved.return_trip_km
    || capture.return_trip_from_maps !== saved.return_trip_from_maps
    || capture.return_trips !== saved.return_trips
    || capture.disposal_rate_per_tonne !== saved.disposal_rate_per_tonne
    || capture.estimated_tonnes !== saved.estimated_tonnes
  useRegisterUnsavedChanges('contents-clearance-quote', isDirty)

  const figures = useMemo(
    () => contentsClearanceFigures(capture.estimated_m3, capture.estimated_km, {
      ratePerM3: capture.rate_per_m3 ?? CONTENTS_CLEARANCE_SCHEMA.ratePerM3,
      ratePerKm: capture.rate_per_km ?? CONTENTS_CLEARANCE_SCHEMA.ratePerKm,
      ratePerLabourDay: capture.rate_per_labour_day ?? CONTENTS_CLEARANCE_SCHEMA.ratePerLabourDay,
      m3PerLabourDay: CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay,
    }, {
      returnTripKm: capture.return_trip_km,
      returnTrips: capture.return_trips,
      tonnes: capture.estimated_tonnes,
      ratePerTonne: capture.disposal_rate_per_tonne,
    }),
    [capture],
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/company')
      .then(r => r.json())
      .then((data: { company?: { contents_clearance_standards?: unknown } }) => {
        if (cancelled) return
        skipStandardsSave.current = true
        setStandards(normalizeContentsClearanceStandards(data.company?.contents_clearance_standards))
        setStandardsReady(true)
      })
      .catch(() => {
        if (!cancelled) setStandardsReady(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!standardsReady) return
    if (skipStandardsSave.current) {
      skipStandardsSave.current = false
      return
    }
    const timer = window.setTimeout(() => { void persistStandards(standards) }, 500)
    return () => window.clearTimeout(timer)
  }, [standards, standardsReady])

  async function persistStandards(next: ContentsClearanceStandards) {
    const res = await fetch('/api/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents_clearance_standards: next }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setSaveError(data.error || 'The clauses could not be saved for future jobs.')
    }
  }

  function editStandards(next: Partial<ContentsClearanceStandards>) {
    setStandards(prev => ({ ...prev, ...next }))
  }

  function patch(next: Partial<ContentsClearanceCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
  }

  useEffect(() => {
    const siteAddress = (job.site_address ?? '').trim()
    const jobAddress = (capture.job_address ?? siteAddress).trim()
    const tipAddress = capture.tip_address.trim()
    if (!jobAddress || !tipAddress) return
    const savedJob = (saved.job_address ?? siteAddress).trim()
    const savedTip = saved.tip_address.trim()
    const samePlaces = jobAddress === savedJob && tipAddress === savedTip
    if (samePlaces && captureRef.current.return_trip_km != null && !captureRef.current.return_trip_from_maps) return
    if (samePlaces && captureRef.current.return_trip_from_maps && captureRef.current.return_trip_km != null) return
    const distanceKey = `${jobAddress}|${tipAddress}`
    if (appliedDistanceKey.current === distanceKey) return
    appliedDistanceKey.current = distanceKey
    const timer = window.setTimeout(() => { void fillDistanceFromMaps() }, 300)
    return () => window.clearTimeout(timer)
  }, [capture.job_address, capture.job_lat, capture.job_lng, capture.tip_address, capture.tip_lat, capture.tip_lng, job.site_address, job.site_lat, job.site_lng, saved.job_address, saved.tip_address])

  async function fillDistanceFromMaps(override?: Partial<ContentsClearanceCapture>, manual = false) {
    const seq = ++distanceSeq.current
    const current = { ...captureRef.current, ...override }
    const site = jobRef.current
    const jobAddress = (current.job_address ?? site.site_address ?? '').trim()
    const tipAddress = current.tip_address.trim()
    if (!jobAddress || !tipAddress) {
      if (manual) setDistanceNote('Add the job address and the tip address first.')
      return
    }
    setDistanceBusy(true)
    setDistanceNote('')
    try {
      const originLat = current.job_address == null ? (current.job_lat ?? site.site_lat ?? null) : current.job_lat
      const originLng = current.job_address == null ? (current.job_lng ?? site.site_lng ?? null) : current.job_lng
      const originPin = typeof originLat === 'number' && typeof originLng === 'number'
        ? { lat: originLat, lng: originLng }
        : null
      const destPin = typeof current.tip_lat === 'number' && typeof current.tip_lng === 'number'
        ? { lat: current.tip_lat, lng: current.tip_lng }
        : null
      const origin: MapWaypoint = originPin ?? jobAddress
      const destination: MapWaypoint = destPin ?? tipAddress
      let km = await browserDrivingRoundTripKm(origin, destination)
      let pins = { origin: originPin, dest: destPin }
      if (km == null) {
        const originResolved = originPin ?? await pinFor(null, null, jobAddress)
        const destResolved = destPin ?? await pinFor(null, null, tipAddress)
        if (seq !== distanceSeq.current) return
        if (originResolved && destResolved) {
          pins = { origin: originResolved, dest: destResolved }
          km = await browserDrivingRoundTripKm(originResolved, destResolved)
          if (km == null) km = await serverRoundTripKm(originResolved, destResolved)
        }
      }
      if (seq !== distanceSeq.current) return
      if (km == null) {
        appliedDistanceKey.current = ''
        setDistanceNote('Driving distance is unavailable. You can type the kilometres.')
        return
      }
      setCapture(prev => {
        const merged = { ...prev, ...override }
        const stillJob = (merged.job_address ?? site.site_address ?? '').trim() === jobAddress
        const stillTip = merged.tip_address.trim() === tipAddress
        if (!stillJob || !stillTip) return prev
        return {
          ...merged,
          job_lat: pins.origin?.lat ?? merged.job_lat,
          job_lng: pins.origin?.lng ?? merged.job_lng,
          tip_lat: pins.dest?.lat ?? merged.tip_lat,
          tip_lng: pins.dest?.lng ?? merged.tip_lng,
          return_trip_km: km,
          return_trip_from_maps: true,
          return_trips: merged.return_trips == null ? 1 : merged.return_trips,
        }
      })
      setDistanceNote('Added from Google Maps: the drive to the tip and back.')
    } catch {
      if (seq === distanceSeq.current) {
        setDistanceNote('Driving distance is unavailable. You can type the kilometres.')
      }
    } finally {
      if (seq === distanceSeq.current) setDistanceBusy(false)
    }
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
          assessment_data: { ...merged, contents_clearance_quote: next },
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
    await persistStandards(standards)
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/contents_clearance_quote?compose=1`)
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
      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
        Contents Clearance Quote
      </div>
      <div style={{ fontSize: 14, marginBottom: 12 }}>
        <div style={LABEL}>Client</div>
        <div>{job.client_name || '—'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Disposal fee per tonne ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.disposal_rate_per_tonne ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ disposal_rate_per_tonne: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Estimated tonnes</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.estimated_tonnes ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ estimated_tonnes: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
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
              const update = {
                job_address: sameAsJob ? null : next.address,
                job_lat: next.lat,
                job_lng: next.lng,
              }
              patch(update)
              const jobAddress = (update.job_address ?? job.site_address ?? '').trim()
              appliedDistanceKey.current = `${jobAddress}|${captureRef.current.tip_address.trim()}`
              void fillDistanceFromMaps(update)
            }}
          />
        </div>
        <div>
          <label style={LABEL}>Tip address</label>
          <AddressAutocomplete
            value={capture.tip_address}
            lat={capture.tip_lat}
            lng={capture.tip_lng}
            placeholder="Start typing the tip address…"
            style={INPUT}
            onChange={next => {
              const update = {
                tip_address: next.address,
                tip_lat: next.lat,
                tip_lng: next.lng,
              }
              patch(update)
              const jobAddress = (captureRef.current.job_address ?? job.site_address ?? '').trim()
              appliedDistanceKey.current = `${jobAddress}|${next.address.trim()}`
              void fillDistanceFromMaps(update)
            }}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>
            Return trip (km)
            {capture.return_trip_from_maps ? ' · from map' : ''}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              min={0}
              step="0.1"
              value={capture.return_trip_km ?? ''}
              onChange={e => {
                const raw = e.target.value
                patch({
                  return_trip_km: raw === '' ? null : Number(raw),
                  return_trip_from_maps: false,
                })
              }}
              placeholder="0"
              style={{ ...INPUT, flex: 1 }}
            />
            <button
              type="button"
              className="btn"
              disabled={distanceBusy || !(capture.job_address ?? job.site_address ?? '').trim() || !capture.tip_address.trim()}
              onClick={() => {
                const jobAddress = (capture.job_address ?? job.site_address ?? '').trim()
                appliedDistanceKey.current = ''
                appliedDistanceKey.current = `${jobAddress}|${capture.tip_address.trim()}`
                void fillDistanceFromMaps(undefined, true)
              }}
            >
              {distanceBusy ? '…' : 'Look up'}
            </button>
          </div>
          {distanceNote && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{distanceNote}</div>
          )}
        </div>
        <div>
          <label style={LABEL}>Return trips</label>
          <input
            type="number"
            min={0}
            step="1"
            value={capture.return_trips ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ return_trips: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {figures.return_trips.toLocaleString('en-AU', { maximumFractionDigits: 2 })} trips × {figures.return_trip_km.toLocaleString('en-AU', { maximumFractionDigits: 2 })} km = {figures.estimated_km.toLocaleString('en-AU', { maximumFractionDigits: 2 })} km
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={LABEL}>Estimated cubic metres</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.estimated_m3 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ estimated_m3: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay} m³ is one labour day.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={LABEL}>Rate per m³ ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_m3 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_m3: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Rate per km ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_km ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_km: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Rate per labour day ($)</label>
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
      <div style={{ marginTop: 14, display: 'grid', gap: 6, fontSize: 14 }}>
        {figures.lines.map(line => (
          <div key={line.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{line.label} · {line.quantity.toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}</span>
            <span>{formatAud(line.amount)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800, marginTop: 4 }}>
          <span>Total inc GST</span>
          <span>{formatAud(figures.total)}</span>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
        <ClickToEditText label="Inclusions" asList value={standards.inclusions} onChange={inclusions => editStandards({ inclusions })} />
        <ClickToEditText label="Exclusions" asList value={standards.exclusions} onChange={exclusions => editStandards({ exclusions })} />
        <ClickToEditText label="Assumptions" asList value={standards.assumptions} onChange={assumptions => editStandards({ assumptions })} />
        <ClickToEditText label="Payment terms" value={standards.payment_terms} onChange={payment_terms => editStandards({ payment_terms })} />
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
