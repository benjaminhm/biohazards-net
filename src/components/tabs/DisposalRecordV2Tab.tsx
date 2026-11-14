/*
 * Contents Disposal Record, photos first.
 *
 * Photos loaded through the bulk loader (or the PIN camera) are sorted into
 * loads. Each load is built from its photos as a timeline: when and where the
 * container was loaded, tipped, and docketed. The times, places, distance and
 * whatever could be read from the photos are filled in; staff type what is
 * left, check each load against its photos, and mark it verified.
 *
 * It saves the same record as the classic form, so the statement, the printed
 * record and the totals are worked out exactly as before.
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import type { CdrRole, DisposalContainerPreset, DisposalLoad, DisposalLoadEvent, DisposalManifestCapture, DisposalVehicle, Job, Photo } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import CdrPhotoTagger, { type CdrTagRow } from '@/components/CdrPhotoTagger'
import PhotoFolderPicker from '@/components/PhotoFolderPicker'
import ReceiptsPanel from '@/components/ReceiptsPanel'
import { applyReceiptsToLoads, receiptGroups, receiptLabel, receiptTotals, type JobReceipt } from '@/lib/jobReceipts'
import { usedPhotoIds } from '@/lib/photoSelection'
import DefaultedNumberInput from '@/components/DefaultedNumberInput'
import RecordSummaryTable from '@/components/RecordSummaryTable'
import {
  DISPOSAL_CONTENTS_TYPES,
  DISPOSAL_VEHICLE_TYPES,
  applyJobSiteToCapture,
  applyQuoteTipToCapture,
  captureWithMetreDimensions,
  computeDisposalTotals,
  disposalManifestEqual,
  disposalRecordSummary,
  distanceFromSiteKm,
  formatAud,
  formatDistanceLegs,
  formatKg,
  formatM3,
  geoRoundTripPatch,
  loadHasContent,
  loadOriginLatLng,
  loadSkipOnly,
  loadVolumeM3,
  mergedDisposalManifestCapture,
  quoteDisposalLink,
  vehicleTypeLabel,
  vehicleVolumeM3,
  withLegacyMirrors,
} from '@/lib/disposalManifest'
import {
  CDR_ROLES,
  clearSuggestion,
  containerPreset,
  eventTitle,
  eventsOf,
  formatEventWhen,
  isTimelineLoad,
  loadIssues,
  manualTimelineLoad,
  setContainerPreset,
  setLoadContainer,
  syncCaptureWithPhotos,
  unverifiedCount,
  verifyLoad,
  withEventMirrors,
  withEventPlace,
  without,
  type CdrPhoto,
} from '@/lib/disposalTimeline'

interface Props {
  job: Job
  photos: Photo[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: Dispatch<SetStateAction<Photo[]>>
}

type ContainerType = 'trailer' | 'ute' | 'skip' | 'other'
type ChargeKey = 'cost_per_m3' | 'labour_days' | 'rate_per_labour_day' | 'mobilisation_fee'

const REMEMBER_KEY = 'cdr-container-sizes'

const INPUT: CSSProperties = {
  width: '100%', fontSize: 14, padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)',
}
const LABEL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 6,
}
const PANEL: CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 14 }
const AUTOSAVE_DELAY_MS = 1500
/** A stop on automatic saves per visit, in case a save and a re-sort ever disagree. */
const AUTOSAVE_LIMIT = 12

const PANEL_TITLE: CSSProperties = { fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }
const MUTED: CSSProperties = { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }
const CHIP: CSSProperties = {
  display: 'inline-block', marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
  borderRadius: 999, padding: '2px 7px', verticalAlign: 'middle',
  color: '#FDE68A', background: 'rgba(251,191,36,0.16)', border: '1px solid rgba(251,191,36,0.45)',
}
const ROLE_COLOR: Record<CdrRole, string> = { load: '#60A5FA', dropoff: '#FBBF24', docket: '#4ADE80' }

function Field({ label, suggested, children, span }: { label: string; suggested?: boolean; children: ReactNode; span?: number }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label style={LABEL}>
        {label}
        {suggested && <span style={CHIP} title="Filled from the photo. Check it against the photo.">From photo</span>}
      </label>
      {children}
    </div>
  )
}

function rememberedSizes(): DisposalManifestCapture['containers'] {
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY)
    return raw ? (JSON.parse(raw) as DisposalManifestCapture['containers']) : undefined
  } catch {
    return undefined
  }
}

/** Container sizes last used in this browser fill the types this record has no size for. */
function withRememberedSizes(capture: DisposalManifestCapture, remembered: DisposalManifestCapture['containers']): DisposalManifestCapture {
  if (!remembered) return capture
  let next = capture
  for (const { id } of DISPOSAL_VEHICLE_TYPES) {
    const saved = remembered[id]
    if (!saved || capture.containers?.[id]) continue
    const current = containerPreset(capture, id)
    if (current.size.trim() || current.length_m != null || current.width_m != null || current.height_m != null) continue
    next = { ...next, containers: { ...next.containers, [id]: saved } }
  }
  return next
}

export default function DisposalRecordV2Tab({ job, photos, onJobUpdate, onPhotosUpdate }: Props) {
  const router = useRouter()
  const quoteLink = useMemo(() => quoteDisposalLink(job.assessment_data), [job.assessment_data])
  const persisted = useMemo(
    () => applyQuoteTipToCapture(applyJobSiteToCapture(mergedDisposalManifestCapture(job.assessment_data), job), quoteLink),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job.assessment_data, job.updated_at, job.site_address, job.site_lat, job.site_lng, quoteLink],
  )
  const [capture, setCapture] = useState(persisted)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [sortOpen, setSortOpen] = useState<boolean | null>(null)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const [remembered, setRemembered] = useState<DisposalManifestCapture['containers']>(undefined)
  const [receipts, setReceipts] = useState<JobReceipt[] | null>(null)

  useEffect(() => { setRemembered(rememberedSizes()) }, [])

  useEffect(() => {
    let alive = true
    fetch(`/api/jobs/${job.id}/receipts`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((d: { receipts?: JobReceipt[] } | null) => { if (alive && d?.receipts) setReceipts(d.receipts) })
      .catch(() => { /* without receipts, loads keep the fees typed on them */ })
    return () => { alive = false }
  }, [job.id])

  // Confirmed receipts set the tip fee and weight of the loads they cover. Only once they have loaded,
  // so a failed fetch never clears what receipts set.
  useEffect(() => {
    if (!receipts) return
    setCapture(prev => {
      const next = applyReceiptsToLoads(prev.loads, receipts)
      return next === prev.loads ? prev : { ...prev, loads: next }
    })
  }, [receipts, capture.loads])

  // What is on screen now, for a save to tell whether anything changed while it was in flight.
  const live = useRef(capture)
  live.current = capture
  const manualEdits = useRef(0)
  const keepScreen = useRef(false)

  // A saved or reloaded job replaces what is on screen, unless the screen moved on during the save.
  useEffect(() => {
    if (keepScreen.current) {
      keepScreen.current = false
      return
    }
    setCapture(persisted)
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.updated_at])

  // The record follows the photo tags: every tagged load is a load here, holding exactly its photos.
  const cdrPhotos: CdrPhoto[] = photos
  const hasTagged = photos.some(p => (p.cdr_load ?? 0) >= 1)
  useEffect(() => {
    if (!hasTagged && !capture.loads.some(l => l.cdr_number != null)) return
    setCapture(prev => {
      const result = syncCaptureWithPhotos(withRememberedSizes(prev, remembered), cdrPhotos, job)
      return result.changed ? result.capture : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, remembered, job.id, job.updated_at])

  useRegisterUnsavedChanges('disposal-record-v2', touched)
  const unsaved = !disposalManifestEqual(capture, persisted)

  // ── Addresses and distance from the photos' GPS ────────────────────────────
  const placeTried = useRef(new Set<string>())
  useEffect(() => {
    for (const load of capture.loads) {
      for (const event of load.events ?? []) {
        if (event.place.trim() || event.lat == null || event.lng == null) continue
        if (placeTried.current.has(event.id)) continue
        placeTried.current.add(event.id)
        void fetch('/api/geocode/reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: event.lat, lng: event.lng }),
        })
          .then(res => res.json() as Promise<{ address?: string | null }>)
          .then(data => {
            const address = data.address?.trim()
            if (!address) return
            setCapture(prev => ({ ...prev, loads: prev.loads.map(l => (l.id === load.id ? withEventPlace(l, event.id, address) : l)) }))
          })
          .catch(() => { /* the stop keeps its time; the place can be typed */ })
      }
    }
  }, [capture.loads])

  const distanceTried = useRef(new Set<string>())
  useEffect(() => {
    for (const load of capture.loads) {
      if (!isTimelineLoad(load) || loadSkipOnly(load) || load.distance_km != null) continue
      const origin = loadOriginLatLng(load, job)
      const { dump_lat: destLat, dump_lng: destLng } = load
      if (origin.lat == null || origin.lng == null || destLat == null || destLng == null) continue
      const key = `${load.id}:${origin.lat},${origin.lng}|${destLat},${destLng}`
      if (distanceTried.current.has(key)) continue
      distanceTried.current.add(key)
      const straight = distanceFromSiteKm(origin.lat, origin.lng, destLat, destLng)
      void fetch('/api/geocode/distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originLat: origin.lat, originLng: origin.lng, destLat, destLng }),
      })
        .then(res => res.json() as Promise<{ km?: number | null; outKm?: number | null; returnKm?: number | null }>)
        .catch(() => ({} as { km?: number | null; outKm?: number | null; returnKm?: number | null }))
        .then(data => {
          const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null)
          const out = num(data.outKm)
          const back = num(data.returnKm)
          const km = num(data.km) ?? straight
          const trip = out != null || back != null ? geoRoundTripPatch(out, back) : km != null ? geoRoundTripPatch(km, km) : null
          if (!trip) return
          setCapture(prev => ({
            ...prev,
            loads: prev.loads.map(l => (
              l.id === load.id && l.distance_km == null && l.dump_lat === destLat && l.dump_lng === destLng ? { ...l, ...trip } : l
            )),
          }))
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.loads, job.site_lat, job.site_lng])

  // ── Edits ──────────────────────────────────────────────────────────────────
  function edit(change: (prev: DisposalManifestCapture) => DisposalManifestCapture) {
    manualEdits.current += 1
    setCapture(change)
    setTouched(true)
    setSavedFlash(false)
    setSaveError('')
  }

  function patchLoad(id: string, patch: Partial<DisposalLoad>, field?: string) {
    edit(prev => ({
      ...prev,
      loads: prev.loads.map(l => (l.id === id ? withEventMirrors(withLegacyMirrors(clearSuggestion({ ...l, ...patch }, field ?? ''))) : l)),
    }))
  }

  function patchVehicle(id: string, patch: Partial<DisposalVehicle>, field?: string) {
    edit(prev => ({
      ...prev,
      loads: prev.loads.map(l => {
        if (l.id !== id || !l.vehicles[0]) return l
        const next = {
          ...l,
          // An edited volume on the container replaces any load-level volume.
          ...(patch.waste_sqm !== undefined ? { waste_sqm: null } : {}),
          vehicles: [{ ...l.vehicles[0], ...patch }, ...l.vehicles.slice(1)],
        }
        return withEventMirrors(withLegacyMirrors(clearSuggestion(next, field ?? '')))
      }),
    }))
  }

  function patchEvent(loadId: string, eventId: string, patch: Partial<DisposalLoadEvent>) {
    edit(prev => ({
      ...prev,
      loads: prev.loads.map(l => {
        if (l.id !== loadId || !l.events) return l
        return withEventMirrors({
          ...l,
          events: l.events.map(e => {
            if (e.id !== eventId) return e
            // A description someone has typed over is no longer a suggestion.
            return { ...(patch.description !== undefined ? without(e, 'suggested') : e), ...patch }
          }),
        })
      }),
    }))
  }

  function changeContainer(load: DisposalLoad, type: ContainerType) {
    edit(prev => ({ ...prev, loads: prev.loads.map(l => (l.id === load.id ? clearSuggestion(setLoadContainer(prev, l, type), 'container') : l)) }))
  }

  function changePreset(type: ContainerType, patch: Partial<DisposalContainerPreset>) {
    edit(prev => setContainerPreset(prev, type, { ...containerPreset(prev, type), ...patch }))
  }

  function addLoad() {
    edit(prev => ({ ...prev, loads: [...prev.loads, manualTimelineLoad(prev, job)] }))
  }

  async function save(next = capture): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    const editsAtStart = manualEdits.current
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_data: { ...merged, disposal_manifest_capture: captureWithMetreDimensions(applyJobSiteToCapture(next, job)) },
        }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      try {
        if (next.containers) window.localStorage.setItem(REMEMBER_KEY, JSON.stringify(captureWithMetreDimensions(next).containers))
      } catch { /* sizes are only remembered where storage is allowed */ }
      // Anything typed or found while the save was in flight stays on screen for the next save.
      keepScreen.current = live.current !== next
      onJobUpdate(data.job)
      if (manualEdits.current === editsAtStart) setTouched(false)
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

  // Loads built from the photos, and the addresses and distances found for them, save themselves.
  // Anything typed waits for Save record.
  const autosave = useRef({ last: '', count: 0 })
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (touched || saving || !unsaved) return
    const snapshot = JSON.stringify(capture)
    if (autosave.current.last === snapshot || autosave.current.count >= AUTOSAVE_LIMIT) return
    const timer = setTimeout(() => {
      autosave.current = { last: snapshot, count: autosave.current.count + 1 }
      void saveRef.current(capture)
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [capture, touched, saving, unsaved])

  function toggleVerified(load: DisposalLoad) {
    const next: DisposalManifestCapture = {
      ...capture,
      loads: capture.loads.map(l => (l.id !== load.id ? l : l.verified_at ? { ...l, verified_at: null } : verifyLoad(l, new Date().toISOString()))),
    }
    setCapture(next)
    void save(next)
  }

  async function saveAndCompose() {
    if (await save()) router.push(`/jobs/${job.id}/docs/waste_disposal_manifest?compose=1`)
  }

  // ── Photo tags ─────────────────────────────────────────────────────────────
  function mergePhotos(updated: CdrPhoto[]) {
    const byId = new Map(updated.map(p => [p.id, p]))
    // Reads land a few at a time, so each is merged into the latest list.
    onPhotosUpdate(prev => prev.map(p => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p)))
  }

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: job.id, ...body }) })
    const data = (await res.json().catch(() => ({}))) as { photos?: CdrPhoto[]; photo?: CdrPhoto; error?: string }
    return res.ok ? data : { error: data.error ?? `Failed (${res.status})` }
  }

  /** One photo is one load: each picked photo becomes the next load, in the order picked. */
  async function addFromFolder(ids: string[]) {
    setPicking(false)
    if (!ids.length) return
    setPickError('')
    const lastLoad = photos.reduce((max, p) => Math.max(max, p.cdr_load ?? 0), 0)
    const tags = ids.map((id, i) => ({ id, load: lastLoad + i + 1, role: 'load' }))
    const result = await post('/api/photos/cdr-tags', { tags })
      .catch(() => ({ error: 'Could not add the photos. Check the connection and try again.' } as { photos?: CdrPhoto[]; error?: string }))
    if (!result.photos) {
      setPickError(result.error || 'Could not add the photos.')
      return
    }
    mergePhotos(result.photos)
    setSortOpen(null)
  }

  /**
   * Delete a load card. Its photos leave the record (they stay in the job folder)
   * and later loads move up a number, keeping what was typed on them.
   */
  async function deleteLoad(load: DisposalLoad, number: number) {
    if (!window.confirm(`Delete Load ${number}? Its photo stays in the job’s folder.`)) return
    const n = load.cdr_number
    const rows = n == null ? [] : photos.flatMap((p): CdrTagRow[] => {
      const at = p.cdr_load ?? 0
      if (at === n) return [{ id: p.id, load: null, role: null }]
      if (at > n) return [{ id: p.id, load: at - 1, role: p.cdr_role ?? 'load' }]
      return []
    })
    const before = capture
    setCapture(prev => ({ ...prev, loads: prev.loads.filter(l => l.id !== load.id) }))
    if (!rows.length) return
    setPickError('')
    const result = await post('/api/photos/cdr-tags', { tags: rows })
      .catch(() => ({ error: 'Could not delete the load. Check the connection and try again.' } as { photos?: CdrPhoto[]; error?: string }))
    if (!result.photos) {
      setCapture(before)
      setPickError(result.error || 'Could not delete the load.')
      return
    }
    mergePhotos(result.photos)
  }

  // ── What is on screen ──────────────────────────────────────────────────────
  const loads = capture.loads.filter(l => isTimelineLoad(l) || loadHasContent(l))
  const waiting = photos.filter(p => p.cdr_load === 0).length
  const tagged = photos.filter(p => (p.cdr_load ?? 0) >= 1).length
  const sorting = sortOpen ?? waiting > 0
  const record = useMemo(() => disposalRecordSummary({ ...capture, loads }, quoteLink), [capture, loads, quoteLink])
  const totals = computeDisposalTotals(loads)
  const notVerified = loads.filter(l => isTimelineLoad(l) && !l.verified_at).length
  const typesInUse = new Set(loads.map(l => l.vehicles[0]?.type).filter(Boolean))
  const groups = receiptGroups(loads, receipts ?? [])
  const fromReceipts = receiptTotals(groups)
  const receiptNames = new Map((receipts ?? []).map(r => [r.id, receiptLabel(r)]))
  const presetTypes = DISPOSAL_VEHICLE_TYPES.filter(t => t.id !== 'other' || typesInUse.has('other'))

  function chargeField(key: ChargeKey, label: string, step: string, fallback: number | null) {
    return (
      <Field label={label}>
        <DefaultedNumberInput value={capture[key]} fallback={fallback} step={step} onChange={next => edit(prev => ({ ...prev, [key]: next }))} style={INPUT} />
      </Field>
    )
  }

  return (
    <div style={{ paddingBottom: 120, display: 'grid', gap: 16 }}>
      <p style={{ ...MUTED, fontSize: 14, margin: 0 }}>
        Load the tip-run photos through the bulk loader as &ldquo;Disposal record&rdquo;. They are sorted into loads by their
        time and GPS, and each load is laid out below in the order it happened. Check each load against its photos, add what
        the photos could not tell, and mark it verified.
      </p>

      {/* 1. Photos */}
      <div style={{ ...PANEL, borderColor: waiting > 0 ? 'rgba(255,107,53,0.6)' : 'var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ ...PANEL_TITLE, color: 'var(--accent)' }}>Photos</div>
            <div style={MUTED}>
              {waiting > 0
                ? `${waiting} photo${waiting === 1 ? '' : 's'} waiting to be sorted into loads.`
                : tagged > 0
                  ? `${tagged} photo${tagged === 1 ? '' : 's'} sorted into ${new Set(photos.filter(p => (p.cdr_load ?? 0) >= 1).map(p => p.cdr_load)).size} load(s).`
                  : 'No disposal photos yet. Select them from the job’s folder, or load them through the bulk loader.'}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setPicking(true)} style={{ fontSize: 13, fontWeight: 800 }}>
            Select from folder
          </button>
          {(tagged > 0 || waiting > 0) && (
            <button type="button" className="btn btn-secondary" onClick={() => setSortOpen(!sorting)} style={{ fontSize: 13, fontWeight: 700 }}>
              {sorting ? 'Hide photos' : 'Change photo sorting'}
            </button>
          )}
        </div>
        {pickError && <div role="alert" style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: '#F87171' }}>{pickError}</div>}
        {sorting && (
          <div style={{ marginTop: 14 }}>
            <CdrPhotoTagger
              photos={cdrPhotos}
              site={job}
              saveTags={(rows: CdrTagRow[]) => post('/api/photos/cdr-tags', { tags: rows })}
              readPhoto={id => post('/api/photos/cdr-read', { photo_id: id })}
              onPhotos={mergePhotos}
              onSaved={() => setSortOpen(null)}
              onSelectFromFolder={() => setPicking(true)}
            />
          </div>
        )}
        {picking && (
          <PhotoFolderPicker
            jobId={job.id}
            title="Contents Disposal Record"
            photos={photos}
            alreadyIds={new Set(photos.filter(p => p.cdr_load != null).map(p => p.id))}
            usedIds={usedPhotoIds(job.assessment_data, photos)}
            onPhotosUpdate={list => onPhotosUpdate(list)}
            onClose={() => setPicking(false)}
            onAdd={ids => void addFromFolder(ids)}
          />
        )}
      </div>

      {/* Receipts: tip fees and weights come from confirmed receipts */}
      <div style={PANEL}>
        <div style={{ ...PANEL_TITLE, color: '#4ADE80' }}>Tip receipts</div>
        <div style={{ ...MUTED, marginBottom: 12 }}>
          {groups.length
            ? `${fromReceipts.count} confirmed receipt${fromReceipts.count === 1 ? '' : 's'} · ${formatAud(fromReceipts.total_inc_gst)}${fromReceipts.gst ? ` (GST ${formatAud(fromReceipts.gst)})` : ''}${fromReceipts.weight_kg ? ` · ${formatKg(fromReceipts.weight_kg)}` : ''}. Each receipt sets the tip fee and weight of the loads it covers, split by volume.`
            : 'Upload each tip receipt, check what was read, tick the loads it covers and confirm it. The loads then take their tip fee and weight from it.'}
        </div>
        {groups.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {groups.map(g => (
              <div key={g.receipt.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span style={{ fontWeight: 800 }}>{receiptLabel(g.receipt)}</span>
                {g.receipt.supplier && g.receipt.docket_no && <span style={MUTED}>{g.receipt.supplier}</span>}
                <span style={MUTED}>Load{g.loadNumbers.length === 1 ? '' : 's'} {g.loadNumbers.join(' + ')}</span>
                {g.receipt.weight_kg != null && <span style={MUTED}>{formatKg(g.receipt.weight_kg)}</span>}
                {g.receipt.total_inc_gst != null && <span style={{ marginLeft: 'auto', fontWeight: 800, color: '#10B981' }}>{formatAud(g.receipt.total_inc_gst)}</span>}
              </div>
            ))}
          </div>
        )}
        {receipts ? (
          <ReceiptsPanel
            jobId={job.id}
            receipts={receipts}
            onReceipts={update => setReceipts(prev => update(prev ?? []))}
            loads={loads}
            photos={photos}
            onPhotosUpdate={list => onPhotosUpdate(list)}
          />
        ) : (
          <div style={MUTED}>Loading receipts…</div>
        )}
      </div>

      {/* 2. Sizes and rates, set once */}
      <div style={PANEL}>
        <button
          type="button"
          onClick={() => setDetailsOpen(o => !o)}
          aria-expanded={detailsOpen}
          style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ flex: 1 }}>
            <div style={PANEL_TITLE}>Container sizes and rates</div>
            <div style={MUTED}>
              {presetTypes.map(t => {
                const volume = vehicleVolumeM3(containerPreset(capture, t.id) as unknown as DisposalVehicle)
                return `${t.label} ${volume != null ? formatM3(volume) : 'no size'}`
              }).join(' · ')}
              {record.rate_per_m3 != null ? ` · ${formatAud(record.rate_per_m3)} per m³` : ' · no rate per m³'}
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>{detailsOpen ? 'Hide' : 'Edit'}</span>
        </button>
        {detailsOpen && (
          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            <div style={MUTED}>
              Set each container once. Every load in that container takes its size, and its volume is what the client is charged for.
              Type metres, or millimetres straight off the tape.
            </div>
            {presetTypes.map(t => {
              const preset = containerPreset(capture, t.id)
              const volume = vehicleVolumeM3(preset as unknown as DisposalVehicle)
              const dim = (key: 'length_m' | 'width_m' | 'height_m', label: string) => (
                <Field label={label}>
                  <DefaultedNumberInput value={preset[key]} fallback={null} step="0.01" onChange={next => changePreset(t.id as ContainerType, { [key]: next })} style={INPUT} />
                </Field>
              )
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 2fr) repeat(3, minmax(70px, 1fr)) minmax(70px, 1fr)', gap: 10, alignItems: 'end' }}>
                  <Field label={t.label}>
                    <input value={preset.size} onChange={e => changePreset(t.id as ContainerType, { size: e.target.value })} placeholder="e.g. 8×5 tandem" style={INPUT} />
                  </Field>
                  {dim('length_m', 'Length')}
                  {dim('width_m', 'Width')}
                  {dim('height_m', 'Height')}
                  <div style={{ fontSize: 14, fontWeight: 800, paddingBottom: 9 }}>{volume != null ? formatM3(volume) : '—'}</div>
                </div>
              )
            })}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {chargeField('cost_per_m3', 'Rate per m³ (ex GST)', '1', quoteLink?.rate_per_m3 ?? null)}
              {chargeField('labour_days', 'Labour days', '0.5', quoteLink?.charges.labour_days ?? null)}
              {chargeField('rate_per_labour_day', 'Rate per labour day', '1', quoteLink?.charges.rate_per_labour_day ?? null)}
              {chargeField('mobilisation_fee', 'Call-out fee', '1', quoteLink?.charges.mobilisation_fee ?? null)}
            </div>
            {quoteLink && <div style={MUTED}>Blank rates follow the Contents Clearance Quote.</div>}
          </div>
        )}
      </div>

      {/* 3. Loads, each a timeline */}
      {loads.map((load, index) => (
        <LoadCard
          key={load.id}
          number={index + 1}
          load={load}
          saving={saving}
          onLoad={(patch, field) => patchLoad(load.id, patch, field)}
          onVehicle={(patch, field) => patchVehicle(load.id, patch, field)}
          onEvent={(eventId, patch) => patchEvent(load.id, eventId, patch)}
          onContainer={type => changeContainer(load, type)}
          onVerify={() => toggleVerified(load)}
          onRemove={() => void deleteLoad(load, index + 1)}
          onZoom={setZoom}
          receiptName={load.receipt_id ? receiptNames.get(load.receipt_id) ?? 'a receipt' : null}
        />
      ))}

      <button type="button" className="btn btn-secondary" onClick={addLoad} style={{ padding: 12, fontWeight: 700 }}>
        + Load without photos
      </button>

      {/* 4. Totals */}
      <div style={{ ...PANEL, borderColor: 'rgba(148,163,184,0.45)', background: 'linear-gradient(165deg, rgba(100,116,139,0.22) 0%, var(--surface) 58%)' }}>
        <div style={{ ...PANEL_TITLE, color: '#E2E8F0', marginBottom: 6 }}>Summary</div>
        <div style={{ ...MUTED, marginBottom: 12 }}>
          {loads.length} load{loads.length === 1 ? '' : 's'}
          {totals.volume_recorded > 0 ? ` · ${formatM3(totals.volume_m3)}` : ''}
          {totals.weight_recorded > 0 ? ` · ${formatKg(totals.weight_kg)}` : ''}
          {totals.distance_recorded > 0 ? ` · ${totals.distance_km} km` : ''}
        </div>
        <RecordSummaryTable
          quantityLabel="Contents removal"
          quantity={record.volume_m3 == null ? '' : formatM3(record.volume_m3)}
          rate={record.rate_per_m3}
          charges={record.charges}
          summary={record.summary}
        />
        {notVerified > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: '#FBBF24' }}>
            {notVerified} load{notVerified === 1 ? ' is' : 's are'} not verified. {notVerified === 1 ? 'Its' : 'Their'} volume is already counted here and on the statement.
          </div>
        )}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 25, background: 'var(--bg)', borderTop: '1px solid var(--border)', padding: '10px 16px max(12px, env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {saveError && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }} role="alert">{saveError}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={saving || !unsaved} onClick={() => void save()} style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}>
              {saving ? 'Saving…' : savedFlash ? 'Saved' : unsaved ? 'Save record' : 'Saved'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving || loads.length === 0} onClick={() => void saveAndCompose()} style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}>
              Save as document
            </button>
          </div>
        </div>
      </div>

      {zoom && (
        <div role="dialog" aria-label="Photo" onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Disposal photo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}

function LoadCard({ number, load, saving, onLoad, onVehicle, onEvent, onContainer, onVerify, onRemove, onZoom, receiptName }: {
  number: number
  load: DisposalLoad
  saving: boolean
  onLoad: (patch: Partial<DisposalLoad>, field?: string) => void
  onVehicle: (patch: Partial<DisposalVehicle>, field?: string) => void
  onEvent: (eventId: string, patch: Partial<DisposalLoadEvent>) => void
  onContainer: (type: ContainerType) => void
  onVerify: () => void
  onRemove: () => void
  onZoom: (url: string) => void
  /** Set when a confirmed receipt gives this load its tip fee and weight. */
  receiptName: string | null
}) {
  const vehicle = load.vehicles[0]
  const timeline = isTimelineLoad(load)
  const events = eventsOf(load)
  const skip = loadSkipOnly(load)
  const volume = loadVolumeM3(load)
  const issues = loadIssues(load)
  const unchecked = unverifiedCount(load)
  const verified = Boolean(load.verified_at)
  const suggested = (field: string) => !verified && Boolean(load.suggested?.includes(field))
  const hasPhotos = events.some(e => e.photos.length > 0)
  const heading = [
    load.vehicles.map(v => vehicleTypeLabel(v.type)).join(' + '),
    volume != null ? formatM3(volume) : 'no volume',
    load.weight_kg != null ? formatKg(load.weight_kg) : '',
  ].filter(Boolean).join(' · ')

  // A load from the classic form with two containers is edited there.
  const editable = Boolean(vehicle) && load.vehicles.length === 1
  const dim = (key: 'length_m' | 'width_m' | 'height_m', label: string) => (
    <Field label={label}>
      <DefaultedNumberInput value={vehicle?.[key]} fallback={null} step="0.01" onChange={next => onVehicle({ [key]: next })} style={INPUT} />
    </Field>
  )

  return (
    <div style={{ ...PANEL, borderColor: verified ? 'rgba(74,222,128,0.5)' : issues.length ? 'rgba(251,191,36,0.5)' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <span style={{ fontWeight: 800, fontSize: 17 }}>Load {number}</span>
          <span style={{ ...MUTED, fontSize: 14, marginLeft: 10 }}>{heading}</span>
        </div>
        {timeline && (
          <button
            type="button"
            disabled={saving}
            onClick={onVerify}
            aria-pressed={verified}
            style={{
              padding: '8px 14px', borderRadius: 999, fontWeight: 800, fontSize: 13, cursor: 'pointer',
              border: `2px solid ${verified ? '#4ADE80' : 'var(--border)'}`,
              background: verified ? 'rgba(74,222,128,0.16)' : 'transparent',
              color: verified ? '#4ADE80' : 'var(--text)',
            }}
          >
            {verified ? '✓ Verified' : unchecked > 0 ? `Verify (${unchecked} from photos)` : 'Verify'}
          </button>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={onRemove}
          title={hasPhotos ? 'Delete this load. Its photo stays in the job folder.' : 'Delete this load'}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '7px 12px', color: '#F87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          Delete load
        </button>
      </div>

      {!editable ? (
        <div style={MUTED}>This load has more than one container. Edit it in the classic form.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          <Field label="Container" suggested={suggested('container')}>
            <select value={vehicle.type || 'trailer'} onChange={e => onContainer(e.target.value as ContainerType)} style={INPUT}>
              {DISPOSAL_VEHICLE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          {dim('length_m', 'Length')}
          {dim('width_m', 'Width')}
          {dim('height_m', 'Height')}
          <Field label="Charged m³">
            <DefaultedNumberInput value={vehicle.waste_sqm} fallback={vehicleVolumeM3(vehicle)} step="0.1" onChange={next => onVehicle({ waste_sqm: next })} style={INPUT} />
          </Field>
          <Field label="Contents" suggested={suggested('contents')}>
            <select value={vehicle.contents_type} onChange={e => onVehicle({ contents_type: e.target.value as DisposalVehicle['contents_type'] }, 'contents')} style={INPUT}>
              <option value="">Choose…</option>
              {DISPOSAL_CONTENTS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          {vehicle.contents_type === 'other' && (
            <Field label="Other contents">
              <input value={vehicle.contents_other} onChange={e => onVehicle({ contents_other: e.target.value })} style={INPUT} />
            </Field>
          )}
          <Field label="Weight (kg)" suggested={!receiptName && suggested('weight_kg')}>
            {receiptName
              ? <FromReceipt value={load.weight_kg != null ? formatKg(load.weight_kg) : '—'} receipt={receiptName} />
              : <DefaultedNumberInput value={load.weight_kg} fallback={null} step="1" onChange={next => onLoad({ weight_kg: next }, 'weight_kg')} style={INPUT} />}
          </Field>
          {!skip && (
            <Field label="Tip" suggested={suggested('facility')} span={2}>
              <input
                value={load.facility || load.dump_location}
                onChange={e => onLoad({ facility: e.target.value, dump_location: e.target.value }, 'facility')}
                placeholder="Found from the drop-off photo"
                style={INPUT}
              />
            </Field>
          )}
          {!skip && (
            <Field label="Distance (km, return)">
              <DefaultedNumberInput
                value={load.distance_km}
                fallback={null}
                step="0.1"
                onChange={next => onLoad({ distance_km: next, distance_out_km: null, distance_return_km: null, distance_from_geo: false })}
                style={INPUT}
              />
              {load.distance_from_geo && formatDistanceLegs(load.distance_out_km, load.distance_return_km) && (
                <div style={{ ...MUTED, fontSize: 11, marginTop: 3 }}>{formatDistanceLegs(load.distance_out_km, load.distance_return_km)}</div>
              )}
            </Field>
          )}
          {!load.docket_photo_url && !receiptName && (
            <Field label="Docket">
              <select
                value={load.docket_lost ? 'lost' : load.docket_skipped ? 'none' : ''}
                onChange={e => onLoad({ docket_skipped: e.target.value !== '', docket_lost: e.target.value === 'lost' })}
                style={INPUT}
              >
                <option value="">Photo to come</option>
                <option value="none">No docket</option>
                <option value="lost">Docket lost</option>
              </select>
            </Field>
          )}
          <Field label="Recycling">
            <select value={load.recycling ? 'yes' : 'no'} onChange={e => onLoad({ recycling: e.target.value === 'yes' })} style={INPUT}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          {load.recycling && (
            <Field label="Recycled as">
              <input value={load.recycling_type} onChange={e => onLoad({ recycling_type: e.target.value })} placeholder="e.g. scrap metal" style={INPUT} />
            </Field>
          )}
          <Field label={skip ? 'Skip hire (your cost)' : 'Tip fee (your cost)'} suggested={!receiptName && suggested(skip ? 'skip_cost' : 'dump_fee')}>
            {receiptName
              ? <FromReceipt value={(skip ? vehicle.skip_cost : load.dump_fee) != null ? formatAud((skip ? vehicle.skip_cost : load.dump_fee) as number) : '—'} receipt={receiptName} />
              : skip
              ? <DefaultedNumberInput value={vehicle.skip_cost} fallback={null} step="0.01" onChange={next => onVehicle({ skip_cost: next }, 'skip_cost')} style={INPUT} />
              : <DefaultedNumberInput value={load.dump_fee} fallback={null} step="0.01" onChange={next => onLoad({ dump_fee: next }, 'dump_fee')} style={INPUT} />}
            <div style={{ ...MUTED, fontSize: 11, marginTop: 3 }}>Kept for your records. Not printed for the client.</div>
          </Field>
        </div>
      )}

      {/* The load in the order it happened */}
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {events.length === 0 && <div style={MUTED}>No photos on this load.</div>}
        {events.map(event => {
          const title = eventTitle(event, load)
          const shown = event.show_to_client !== false
          return (
            <div key={event.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) minmax(0, 1fr)', gap: 12, paddingLeft: 12, borderLeft: `3px solid ${ROLE_COLOR[event.role]}`, opacity: shown ? 1 : 0.6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: event.photos.length > 1 ? '1fr 1fr' : '1fr', gap: 6, alignContent: 'start' }}>
                {event.photos.map(p => (
                  <button key={p.id} type="button" onClick={() => onZoom(p.url)} aria-label="View photo" style={{ padding: 0, border: 'none', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', background: 'var(--surface-2)', aspectRatio: event.photos.length > 1 ? '1' : '4 / 3' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.note || title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: ROLE_COLOR[event.role] }}>{title}</span>
                  <span style={{ ...MUTED, fontSize: 12 }}>{formatEventWhen(event.at) || 'No time on the photo'}</span>
                  <span style={{ ...MUTED, fontSize: 11 }}>{CDR_ROLES.find(r => r.id === event.role)?.label}</span>
                </div>
                {timeline ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) minmax(0, 2fr)', gap: 8 }}>
                      <input type="datetime-local" value={event.at.length === 10 ? `${event.at}T00:00` : event.at} onChange={e => onEvent(event.id, { at: e.target.value })} aria-label="When" style={INPUT} />
                      <input value={event.place} onChange={e => onEvent(event.id, { place: e.target.value })} placeholder={event.lat != null ? 'Finding the address…' : 'Where'} aria-label="Where" style={INPUT} />
                    </div>
                    <div>
                      <input
                        value={event.description}
                        onChange={e => onEvent(event.id, { description: e.target.value })}
                        placeholder={event.role === 'load' ? 'What is in the load' : 'Add a note for this stop (optional)'}
                        aria-label="Description"
                        style={INPUT}
                      />
                      {event.suggested && !verified && <span style={{ ...CHIP, marginLeft: 0, marginTop: 5 }}>Described from the photo</span>}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={shown} onChange={e => onEvent(event.id, { show_to_client: e.target.checked })} style={{ width: 16, height: 16, margin: 0 }} />
                      Show on the client&rsquo;s record
                      {event.role === 'docket' && shown && <span style={{ fontSize: 11 }}>(the docket shows what you were charged)</span>}
                    </label>
                  </>
                ) : (
                  <div style={MUTED}>{[event.place, event.description].filter(Boolean).join(' · ') || 'Entered in the classic form.'}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {editable && (
        <div style={{ marginTop: 12 }}>
          <input value={load.notes} onChange={e => onLoad({ notes: e.target.value })} placeholder="Notes for your own records (optional)" aria-label="Notes" style={INPUT} />
        </div>
      )}

      {issues.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
          <ul style={{ flex: 1, margin: 0, paddingLeft: 18, fontSize: 13, color: '#FBBF24', lineHeight: 1.6 }}>
            {issues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function FromReceipt({ value, receipt }: { value: string; receipt: string }) {
  return (
    <div title="Change it on the receipt" style={{ ...INPUT, background: 'transparent', borderStyle: 'dashed' }}>
      <span style={{ fontWeight: 700 }}>{value}</span>
      <span style={{ ...MUTED, fontSize: 11, marginLeft: 6 }}>from {receipt}</span>
    </div>
  )
}
