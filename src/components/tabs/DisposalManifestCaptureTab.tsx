/*
 * Execute-phase Contents Disposal Record: one card per dump trip.
 * Vehicles (trailer / ute / skip) with size + L×W×H, then a shared weighbridge docket.
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { DisposalLoad, DisposalPhotoRef, DisposalVehicle, Job, Photo } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import DisposalPhotoSlot, { PhotoNoteField, ZoomablePhoto } from '@/components/DisposalPhotoSlot'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import { formatCoordLabel, timeFromTakenAt, type GalleryPlaceContext, type PhotoExif } from '@/lib/photoExif'
import { browserGeocodeAddress } from '@/lib/geocodeBrowser'
import {
  DISPOSAL_CONTENTS_TYPES,
  DISPOSAL_VEHICLE_TYPES,
  anyVehicleReady,
  applyJobSiteToCapture,
  applyJobSiteToLoad,
  computeDisposalTotals,
  contentsLabel,
  disposalManifestEqual,
  distanceFromSiteKm,
  emptyDisposalLoad,
  emptyDisposalVehicle,
  formatAud,
  formatKg,
  formatM3,
  loadOriginLatLng,
  looksLikeCoordLabel,
  looksLikeMillimetres,
  dimensionTrioToMetres,
  captureWithMetreDimensions,
  mergedDisposalManifestCapture,
  moveArrayItem,
  vehicleContentsLabel,
  vehicleTypeLabel,
  vehicleVolumeM3,
} from '@/lib/disposalManifest'

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

const CHECK: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  alignSelf: 'flex-start',
  gap: 10,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text)',
  cursor: 'pointer',
  margin: 0,
}

const CHECKBOX: CSSProperties = {
  width: 18,
  height: 18,
  minWidth: 18,
  flexShrink: 0,
  alignSelf: 'center',
  margin: 0,
}

const CHIP: CSSProperties = {
  display: 'inline-block',
  marginLeft: 8,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#A7F3D0',
  background: 'rgba(16,185,129,0.16)',
  border: '1px solid rgba(52,211,153,0.4)',
  borderRadius: 999,
  padding: '2px 7px',
  verticalAlign: 'middle',
}

function MetaChip({ show, fromDevice, label }: { show: boolean; fromDevice?: boolean; label?: string }) {
  if (!show) return null
  return <span style={CHIP}>{label ?? (fromDevice ? 'From phone' : 'From photo')}</span>
}

function galleryPlaceFor(
  job: Job,
  load: DisposalLoad,
  defaultPlace: 'site' | 'dump',
): GalleryPlaceContext {
  const pickup = load.location.trim() || job.site_address?.trim() || 'Pickup address'
  const dropoff = (load.facility || load.dump_location).trim() || 'Drop-off address'
  return {
    siteLabel: pickup,
    siteLat: load.location_lat ?? job.site_lat ?? null,
    siteLng: load.location_lng ?? job.site_lng ?? null,
    dumpLabel: dropoff,
    dumpLat: load.dump_lat,
    dumpLng: load.dump_lng,
    defaultPlace,
  }
}

const MOVE_BTN: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 14,
  fontWeight: 800,
  flexShrink: 0,
  padding: 0,
}

function PhotoReorderGrid({
  photos,
  altPrefix,
  onMove,
  onNote,
  onRemove,
}: {
  photos: DisposalPhotoRef[]
  altPrefix: string
  onMove: (index: number, direction: -1 | 1) => void
  onNote: (id: string, note: string) => void
  onRemove: (id: string) => void
}) {
  if (photos.length === 0) return null
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        marginBottom: 8,
      }}
    >
      {photos.map((p, pIndex) => (
        <div key={p.id} style={{ position: 'relative' }}>
          <div
            style={{
              borderRadius: 10,
              overflow: 'visible',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <ZoomablePhoto src={p.url} alt={p.note || `${altPrefix} ${pIndex + 1}`} maxHeight={180} />
          </div>
          <PhotoNoteField value={p.note ?? ''} onChange={value => onNote(p.id, value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label={`Move ${altPrefix} photo earlier`}
                  disabled={pIndex === 0}
                  onClick={() => onMove(pIndex, -1)}
                  style={{
                    ...MOVE_BTN,
                    cursor: pIndex === 0 ? 'not-allowed' : 'pointer',
                    opacity: pIndex === 0 ? 0.35 : 1,
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${altPrefix} photo later`}
                  disabled={pIndex === photos.length - 1}
                  onClick={() => onMove(pIndex, 1)}
                  style={{
                    ...MOVE_BTN,
                    cursor: pIndex === photos.length - 1 ? 'not-allowed' : 'pointer',
                    opacity: pIndex === photos.length - 1 ? 0.35 : 1,
                  }}
                >
                  ↓
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#F87171',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function LockGlyph({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 7.4-2" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function withMirrors(load: DisposalLoad): DisposalLoad {
  const v = load.vehicles[0]
  if (!v) return load
  return {
    ...load,
    trailer_skipped: v.photo_skipped,
    trailer_photo_id: v.photo_id,
    trailer_photo_url: v.photo_url,
    size: v.size,
    contents_type: v.contents_type,
    contents_other: v.contents_other,
    contents_description: v.contents_description,
  }
}

function sizePlaceholder(type: DisposalVehicle['type']): string {
  if (type === 'ute') return 'e.g. dual cab tray'
  if (type === 'skip') return 'e.g. 6 m³ skip'
  if (type === 'other') return 'e.g. truck body'
  return 'e.g. 6×4 tandem trailer'
}

function photoLabels(type: DisposalVehicle['type']): { camera: string; skip: string; area: string } {
  const name = vehicleTypeLabel(type)
  return {
    camera: `📷 ${name}`,
    skip: 'Skip photo',
    area: name,
  }
}

export default function DisposalManifestCaptureTab({ job, photos, onJobUpdate, onPhotosUpdate }: Props) {
  const router = useRouter()
  const persisted = useMemo(
    () => applyJobSiteToCapture(mergedDisposalManifestCapture(job.assessment_data), job),
    [job.assessment_data, job.updated_at, job.site_address, job.site_lat, job.site_lng],
  )
  const [capture, setCapture] = useState(persisted)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [openId, setOpenId] = useState<string | null>(persisted.loads[0]?.id ?? null)
  const [unlockedLoadId, setUnlockedLoadId] = useState<string | null>(null)
  const [distanceBusyId, setDistanceBusyId] = useState<string | null>(null)
  const [distanceErrors, setDistanceErrors] = useState<Record<string, string>>({})
  const geocodedLoadIds = useRef(new Set<string>())
  const distanceTried = useRef(new Set<string>())

  const isDirty = !disposalManifestEqual(capture, persisted)
  useRegisterUnsavedChanges('disposal-manifest-capture', isDirty)

  useEffect(() => {
    setCapture(applyJobSiteToCapture(mergedDisposalManifestCapture(job.assessment_data), job))
  }, [job.id, job.updated_at, job.site_address, job.site_lat, job.site_lng])

  useEffect(() => {
    for (const load of capture.loads) {
      if (geocodedLoadIds.current.has(load.id)) continue
      if (load.dump_lat == null || load.dump_lng == null) continue
      const label = (load.facility || load.dump_location).trim()
      if (label && !looksLikeCoordLabel(label)) continue
      void fillDumpAddressFromGps(load.id, load.dump_lat, load.dump_lng, load.dump_location_from_device)
    }
  }, [capture.loads])

  useEffect(() => {
    for (const load of capture.loads) {
      if (load.distance_km != null && !load.distance_from_geo) continue
      const pickupText = load.location.trim() || job.site_address?.trim() || ''
      const dropText = (load.facility || load.dump_location).trim()
      const origin = loadOriginLatLng(load, job)
      const hasPins = origin.lat != null && origin.lng != null && load.dump_lat != null && load.dump_lng != null
      const hasAddresses = Boolean(pickupText && dropText && !looksLikeCoordLabel(dropText))
      if (!hasPins && !hasAddresses) continue
      const key = `${load.id}:${pickupText}|${dropText}|${origin.lat},${origin.lng}|${load.dump_lat},${load.dump_lng}`
      if (distanceTried.current.has(key)) continue
      distanceTried.current.add(key)
      void ensureTripDistance(load.id)
    }
  }, [capture.loads, job.site_lat, job.site_lng, job.site_address])

  const totals = useMemo(() => computeDisposalTotals(capture.loads), [capture.loads])

  function touch() {
    setSavedFlash(false)
    setSaveError('')
  }

  function canAutofillDistance(load: DisposalLoad): boolean {
    return load.distance_km == null || load.distance_from_geo
  }

  async function geocodeAddressPin(address: string): Promise<{ lat: number; lng: number } | null> {
    const q = address.trim()
    if (!q || looksLikeCoordLabel(q)) return null
    const fromBrowser = await browserGeocodeAddress(q)
    if (fromBrowser) return fromBrowser
    try {
      const res = await fetch('/api/geocode/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: q }),
      })
      const data = (await res.json()) as { lat?: number | null; lng?: number | null }
      if (typeof data.lat === 'number' && typeof data.lng === 'number' && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
        return { lat: data.lat, lng: data.lng }
      }
    } catch {
      /* keep going without a pin */
    }
    return null
  }

  async function ensureTripDistance(loadId: string, hint?: Partial<DisposalLoad>, force = false): Promise<{ ok: boolean; error?: string }> {
    const existing = capture.loads.find(l => l.id === loadId)
    const load: DisposalLoad = { ...(existing ?? applyJobSiteToLoad(emptyDisposalLoad(), job)), ...hint, id: loadId }
    if (!force && !canAutofillDistance(load)) return { ok: true }

    const pickupText = load.location.trim() || job.site_address?.trim() || ''
    const dropText = (load.facility || load.dump_location).trim()
    if (!pickupText || !dropText) {
      return { ok: false, error: 'Add pickup and drop-off addresses first' }
    }

    let originLat = load.location_lat ?? job.site_lat ?? null
    let originLng = load.location_lng ?? job.site_lng ?? null
    let destLat = load.dump_lat
    let destLng = load.dump_lng
    const pinPatch: Partial<DisposalLoad> = {}

    if ((force || originLat == null || originLng == null) && pickupText) {
      const pin = await geocodeAddressPin(pickupText)
      if (pin) {
        originLat = pin.lat
        originLng = pin.lng
        pinPatch.location_lat = pin.lat
        pinPatch.location_lng = pin.lng
      }
    }
    if ((force || destLat == null || destLng == null) && dropText) {
      const pin = await geocodeAddressPin(dropText)
      if (pin) {
        destLat = pin.lat
        destLng = pin.lng
        pinPatch.dump_lat = pin.lat
        pinPatch.dump_lng = pin.lng
      }
    }

    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      return { ok: false, error: 'Could not find pickup or drop-off on the map' }
    }

    const straight = distanceFromSiteKm(originLat, originLng, destLat, destLng)
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        if (!force && !canAutofillDistance(l)) return l
        return withMirrors({
          ...l,
          ...pinPatch,
          location_lat: originLat,
          location_lng: originLng,
          dump_lat: destLat,
          dump_lng: destLng,
          ...(straight != null ? { distance_km: straight, distance_from_geo: true } : {}),
        })
      }),
    }))
    touch()
    await applyTripDistance(loadId, originLat, originLng, destLat, destLng, force)
    return { ok: true }
  }

  async function reloadTripDistance(loadId: string) {
    if (distanceBusyId) return
    setDistanceBusyId(loadId)
    setDistanceErrors(prev => ({ ...prev, [loadId]: '' }))
    try {
      const result = await ensureTripDistance(loadId, undefined, true)
      if (!result.ok) {
        setDistanceErrors(prev => ({ ...prev, [loadId]: result.error || 'Could not calculate distance' }))
      }
    } finally {
      setDistanceBusyId(null)
    }
  }

  async function applyTripDistance(
    loadId: string,
    originLat: number | null | undefined,
    originLng: number | null | undefined,
    destLat: number | null | undefined,
    destLng: number | null | undefined,
    force = false,
  ) {
    const straight = distanceFromSiteKm(originLat, originLng, destLat, destLng)
    if (straight == null || originLat == null || originLng == null || destLat == null || destLng == null) return

    let km = straight
    try {
      const res = await fetch('/api/geocode/distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originLat, originLng, destLat, destLng }),
      })
      const data = (await res.json()) as { km?: number | null }
      if (typeof data.km === 'number' && Number.isFinite(data.km) && data.km >= 0) km = data.km
    } catch {
      /* keep straight-line km */
    }

    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        if (!force && !canAutofillDistance(l)) return l
        if (!force) {
          const origin = loadOriginLatLng(l, job)
          if (
            origin.lat != null && origin.lng != null && originLat != null && originLng != null &&
            (origin.lat !== originLat || origin.lng !== originLng)
          ) return l
          if (
            l.dump_lat != null && l.dump_lng != null && destLat != null && destLng != null &&
            (l.dump_lat !== destLat || l.dump_lng !== destLng)
          ) return l
        }
        if (!force && l.distance_km === km && l.distance_from_geo) return l
        return withMirrors({
          ...l,
          location_lat: force ? originLat : (l.location_lat ?? originLat ?? null),
          location_lng: force ? originLng : (l.location_lng ?? originLng ?? null),
          dump_lat: force ? destLat : (l.dump_lat ?? destLat ?? null),
          dump_lng: force ? destLng : (l.dump_lng ?? destLng ?? null),
          distance_km: km,
          distance_from_geo: true,
        })
      }),
    }))
    touch()
  }

  async function fillDumpAddressFromGps(
    loadId: string,
    lat: number,
    lng: number,
    fromDevice: boolean,
  ) {
    geocodedLoadIds.current.add(loadId)
    try {
      const res = await fetch('/api/geocode/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      })
      const data = (await res.json()) as { address?: string | null }
      const address = data.address?.trim()
      if (!address) return
      const existing = capture.loads.find(l => l.id === loadId)
      const origin = loadOriginLatLng(existing ?? {}, job)
      const km = distanceFromSiteKm(origin.lat, origin.lng, lat, lng)
      const allow = !existing || canAutofillDistance(existing)
      setCapture(prev => ({
        loads: prev.loads.map(l => {
          if (l.id !== loadId) return l
          const current = (l.facility || l.dump_location).trim()
          if (current && !looksLikeCoordLabel(current)) return l
          return withMirrors({
            ...l,
            facility: address,
            dump_location: address,
            dump_lat: lat,
            dump_lng: lng,
            dump_location_from_photo: true,
            dump_location_from_device: fromDevice,
            ...(allow && km != null ? { distance_km: km, distance_from_geo: true } : {}),
          })
        }),
      }))
      touch()
      if (allow) void applyTripDistance(loadId, origin.lat, origin.lng, lat, lng)
    } catch {
      /* keep coordinates if geocode is unavailable */
    }
  }

  function patchLoad(id: string, patch: Partial<DisposalLoad>) {
    setCapture(prev => ({
      loads: prev.loads.map(l => (l.id === id ? withMirrors({ ...l, ...patch }) : l)),
    }))
    touch()
  }

  function patchVehicle(loadId: string, vehicleId: string, patch: Partial<DisposalVehicle>) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          vehicles: l.vehicles.map(v => (v.id === vehicleId ? { ...v, ...patch } : v)),
        })
      }),
    }))
    touch()
  }

  function applyVehicleExif(loadId: string, vehicleId: string, photo: Photo, exif: PhotoExif) {
    setCapture(prev => ({
      loads: prev.loads.map(load => {
        if (load.id !== loadId) return load
        const vehicles = load.vehicles.map(v =>
          v.id !== vehicleId
            ? v
            : {
                ...v,
                photo_skipped: false,
                photo_id: photo.id,
                photo_url: photo.file_url,
                photo_note: v.photo_note?.trim() ? v.photo_note : (exif.placeNote ?? ''),
              },
        )
        let next: DisposalLoad = { ...load, vehicles }
        if (!load.date.trim() && exif.date) {
          next.date = exif.date
          next.date_from_photo = true
          next.date_from_device = Boolean(exif.timeFromDevice)
        }
        const geoOk = exif.geoSource === 'site'
        if (geoOk && exif.lat != null && exif.lng != null) {
          next.location_lat = exif.lat
          next.location_lng = exif.lng
        }
        return applyJobSiteToLoad(withMirrors(next), job)
      }),
    }))
    touch()
    onPhotosUpdate([photo, ...photos])
    const geoOk = exif.geoSource === 'site'
    if (geoOk && exif.lat != null && exif.lng != null) {
      const current = capture.loads.find(l => l.id === loadId)
      if (current && canAutofillDistance(current)) {
        void applyTripDistance(loadId, exif.lat, exif.lng, current.dump_lat, current.dump_lng)
      }
    }
  }

  function applyDocketExif(id: string, photo: Photo, exif: PhotoExif) {
    setCapture(prev => ({
      loads: prev.loads.map(load => {
        if (load.id !== id) return load
        const next: DisposalLoad = {
          ...load,
          docket_skipped: false,
          docket_lost: false,
          recycling: false,
          docket_photo_id: photo.id,
          docket_photo_url: photo.file_url,
          docket_photo_note: load.docket_photo_note?.trim() ? load.docket_photo_note : (exif.placeNote ?? ''),
        }
        if (!load.dump_date.trim() && (exif.date || timeFromTakenAt(exif.takenAt))) {
          if (exif.date) next.dump_date = exif.date
          const time = timeFromTakenAt(exif.takenAt)
          if (time) next.dump_time = time
          next.dump_datetime_from_photo = true
          next.dump_datetime_from_device = Boolean(exif.timeFromDevice)
        }
        const geoOk = exif.geoSource === 'dump'
        if (geoOk && exif.lat != null && exif.lng != null) {
          next.dump_lat = exif.lat
          next.dump_lng = exif.lng
          if (!load.dump_location.trim() && !load.facility.trim()) {
            next.dump_location = formatCoordLabel(exif.lat, exif.lng)
            next.dump_location_from_photo = true
            next.dump_location_from_device = Boolean(exif.geoFromDevice)
          }
          if (load.distance_km == null) {
            const origin = loadOriginLatLng(load, job)
            const km = distanceFromSiteKm(origin.lat, origin.lng, exif.lat, exif.lng)
            if (km != null) {
              next.distance_km = km
              next.distance_from_geo = true
            }
          }
        }
        return withMirrors(next)
      }),
    }))
    touch()
    onPhotosUpdate([photo, ...photos])
    const geoOk = exif.geoSource === 'dump'
    if (geoOk && exif.lat != null && exif.lng != null) {
      void fillDumpAddressFromGps(id, exif.lat, exif.lng, Boolean(exif.geoFromDevice))
      const current = capture.loads.find(l => l.id === id)
      if (current && canAutofillDistance(current)) {
        const origin = loadOriginLatLng(current, job)
        void applyTripDistance(id, origin.lat, origin.lng, exif.lat, exif.lng)
      }
    }
  }

  async function save(nextCapture = capture): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_data: { ...merged, disposal_manifest_capture: captureWithMetreDimensions(applyJobSiteToCapture(nextCapture, job)) },
        }),
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

  function moveLoad(index: number, direction: -1 | 1) {
    const load = capture.loads[index]
    if (!load || unlockedLoadId !== load.id) return
    const next = { loads: moveArrayItem(capture.loads, index, direction) }
    setCapture(next)
    setUnlockedLoadId(null)
    void save(next)
  }

  function addLoad() {
    const load = applyJobSiteToLoad(emptyDisposalLoad(), job)
    setCapture(prev => ({ loads: [...prev.loads, load] }))
    setOpenId(load.id)
    touch()
  }

  function addExtraPhoto(loadId: string, vehicleId: string, photo: Photo, exif?: PhotoExif) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          vehicles: l.vehicles.map(v =>
            v.id !== vehicleId
              ? v
              : { ...v, extra_photos: [...(v.extra_photos ?? []), { id: photo.id, url: photo.file_url, note: exif?.placeNote ?? '' }] },
          ),
        })
      }),
    }))
    touch()
    onPhotosUpdate([photo, ...photos])
  }

  function removeExtraPhoto(loadId: string, vehicleId: string, photoId: string) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          vehicles: l.vehicles.map(v =>
            v.id !== vehicleId
              ? v
              : { ...v, extra_photos: (v.extra_photos ?? []).filter(p => p.id !== photoId) },
          ),
        })
      }),
    }))
    touch()
  }

  function patchExtraPhotoNote(loadId: string, vehicleId: string, photoId: string, note: string) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          vehicles: l.vehicles.map(v =>
            v.id !== vehicleId
              ? v
              : {
                  ...v,
                  extra_photos: (v.extra_photos ?? []).map(p => (p.id === photoId ? { ...p, note } : p)),
                },
          ),
        })
      }),
    }))
    touch()
  }

  function addFacilityPhoto(loadId: string, photo: Photo, exif?: PhotoExif) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          facility_photos: [...(l.facility_photos ?? []), { id: photo.id, url: photo.file_url, note: exif?.placeNote ?? '' }],
        })
      }),
    }))
    touch()
    onPhotosUpdate([photo, ...photos])
  }

  function removeFacilityPhoto(loadId: string, photoId: string) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          facility_photos: (l.facility_photos ?? []).filter(p => p.id !== photoId),
        })
      }),
    }))
    touch()
  }

  function patchFacilityPhotoNote(loadId: string, photoId: string, note: string) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          facility_photos: (l.facility_photos ?? []).map(p => (p.id === photoId ? { ...p, note } : p)),
        })
      }),
    }))
    touch()
  }

  function moveExtraPhoto(loadId: string, vehicleId: string, index: number, direction: -1 | 1) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          vehicles: l.vehicles.map(v =>
            v.id !== vehicleId
              ? v
              : { ...v, extra_photos: moveArrayItem(v.extra_photos ?? [], index, direction) },
          ),
        })
      }),
    }))
    touch()
  }

  function moveFacilityPhoto(loadId: string, index: number, direction: -1 | 1) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          facility_photos: moveArrayItem(l.facility_photos ?? [], index, direction),
        })
      }),
    }))
    touch()
  }

  function addVehicle(loadId: string) {
    const vehicle = emptyDisposalVehicle('ute')
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({ ...l, vehicles: [...l.vehicles, vehicle] })
      }),
    }))
    touch()
  }

  function removeVehicle(loadId: string, vehicleId: string) {
    const load = capture.loads.find(l => l.id === loadId)
    if (!load) return
    if (load.vehicles.length > 1 && !window.confirm('Remove this vehicle?')) return
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        if (l.vehicles.length <= 1) {
          return withMirrors({ ...l, vehicles: [emptyDisposalVehicle('trailer')] })
        }
        return withMirrors({ ...l, vehicles: l.vehicles.filter(v => v.id !== vehicleId) })
      }),
    }))
    touch()
  }

  function removeLoad(id: string) {
    if (capture.loads.length <= 1) {
      const fresh = applyJobSiteToLoad(emptyDisposalLoad(), job)
      setCapture({ loads: [fresh] })
      setOpenId(fresh.id)
      touch()
      return
    }
    if (!window.confirm('Remove this load?')) return
    const next = capture.loads.filter(l => l.id !== id)
    setCapture({ loads: next })
    if (openId === id) setOpenId(next[next.length - 1]?.id ?? null)
    touch()
  }

  async function saveAndCompose() {
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/waste_disposal_manifest?compose=1`)
  }

  return (
    <div style={{ maxWidth: 720, paddingBottom: 120 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        One card per dump trip. Record what left the site, where it went, and the
        dump cost. Photos and the weighbridge docket are the proof for the client.
      </p>

      {capture.loads.map((load, index) => {
        const open = openId === load.id
        const typeBits = load.vehicles.map(v => vehicleTypeLabel(v.type)).filter(Boolean)
        const vol = load.vehicles.reduce((n, v) => n + (vehicleVolumeM3(v) ?? 0), 0)
        const volRecorded = load.vehicles.some(v => vehicleVolumeM3(v) != null)
        const titleBits = [
          typeBits.length ? typeBits.join(' + ') : null,
          contentsLabel(load) || null,
          volRecorded ? formatM3(Math.round(vol * 100) / 100) : null,
          load.weight_kg != null ? formatKg(load.weight_kg) : null,
        ].filter(Boolean)
        const docketOpen = anyVehicleReady(load)
        return (
          <div
            key={load.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--surface)',
              marginBottom: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingRight: 8,
              }}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : load.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  padding: '12px 6px 12px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 800,
                  background: 'rgba(100,116,139,0.28)',
                  color: '#E2E8F0',
                  flexShrink: 0,
                }}
              >
                {index + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Load {index + 1}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {titleBits.join(' · ') || 'Vehicles → measurements → docket'}
                </div>
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
              </button>
              <button
                type="button"
                aria-label={unlockedLoadId === load.id ? 'Lock load order' : 'Unlock load order'}
                title={unlockedLoadId === load.id ? 'Unlocked — move, then it saves and locks' : 'Locked — tap to unlock and reorder'}
                onClick={() => setUnlockedLoadId(unlockedLoadId === load.id ? null : load.id)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: unlockedLoadId === load.id
                    ? '1px solid rgba(52,211,153,0.55)'
                    : '1px solid rgba(248,113,113,0.55)',
                  background: unlockedLoadId === load.id
                    ? 'rgba(16,185,129,0.16)'
                    : 'rgba(248,113,113,0.16)',
                  color: unlockedLoadId === load.id ? '#34D399' : '#F87171',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <LockGlyph open={unlockedLoadId === load.id} />
              </button>
              <button
                type="button"
                aria-label="Move load up"
                disabled={unlockedLoadId !== load.id || index === 0 || saving}
                onClick={() => moveLoad(index, -1)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  cursor: unlockedLoadId !== load.id || index === 0 || saving ? 'not-allowed' : 'pointer',
                  opacity: unlockedLoadId !== load.id || index === 0 || saving ? 0.35 : 1,
                  fontSize: 14,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move load down"
                disabled={unlockedLoadId !== load.id || index === capture.loads.length - 1 || saving}
                onClick={() => moveLoad(index, 1)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  cursor: unlockedLoadId !== load.id || index === capture.loads.length - 1 || saving ? 'not-allowed' : 'pointer',
                  opacity: unlockedLoadId !== load.id || index === capture.loads.length - 1 || saving ? 0.35 : 1,
                  fontSize: 14,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                ↓
              </button>
            </div>

            {open && (
              <div style={{ padding: '0 14px 16px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                  <div>
                    <label style={LABEL}>
                      Load date
                      <MetaChip show={load.date_from_photo} fromDevice={load.date_from_device} />
                    </label>
                    <input
                      type="date"
                      value={load.date}
                      onChange={e => patchLoad(load.id, { date: e.target.value, date_from_photo: false, date_from_device: false })}
                      style={INPUT}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>
                      Location
                      <MetaChip show={load.location_from_photo} />
                    </label>
                    <AddressAutocomplete
                      value={load.location}
                      lat={load.location_lat}
                      lng={load.location_lng}
                      placeholder="Pickup / load location"
                      style={INPUT}
                      onChange={next => {
                        const allow = canAutofillDistance(load)
                        const originLat = next.lat ?? job.site_lat
                        const originLng = next.lng ?? job.site_lng
                        const km = distanceFromSiteKm(originLat, originLng, load.dump_lat, load.dump_lng)
                        patchLoad(load.id, {
                          location: next.address,
                          location_lat: next.lat,
                          location_lng: next.lng,
                          location_from_photo: false,
                          ...(allow && km != null ? { distance_km: km, distance_from_geo: true } : {}),
                        })
                        if (allow) {
                          void ensureTripDistance(load.id, {
                            location: next.address,
                            location_lat: next.lat,
                            location_lng: next.lng,
                          })
                        }
                      }}
                    />
                  </div>
                </div>

                {load.vehicles.map((vehicle, vIndex) => {
                  const labels = photoLabels(vehicle.type)
                  const volM3 = vehicleVolumeM3(vehicle)
                  const dimsM = dimensionTrioToMetres(vehicle.length_m, vehicle.width_m, vehicle.height_m)
                  const tapeHint = looksLikeMillimetres(vehicle.length_m) || looksLikeMillimetres(vehicle.width_m) || looksLikeMillimetres(vehicle.height_m)
                  return (
                    <div
                      key={vehicle.id}
                      style={{
                        marginTop: 16,
                        padding: 12,
                        borderRadius: 10,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                      }}
                    >
                      <div style={{ ...LABEL, marginTop: 0 }}>
                        Vehicle {vIndex + 1}
                      </div>
                      <div>
                        <label style={LABEL}>Type</label>
                        <select
                          value={vehicle.type}
                          onChange={e =>
                            patchVehicle(load.id, vehicle.id, {
                              type: e.target.value as DisposalVehicle['type'],
                            })
                          }
                          style={{ ...INPUT, cursor: 'pointer' }}
                        >
                          <option value="">Select…</option>
                          {DISPOSAL_VEHICLE_TYPES.map(t => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <DisposalPhotoSlot
                          jobId={job.id}
                          areaRef={`Disposal load ${index + 1} — ${labels.area} ${vIndex + 1}`}
                          caption={`Load ${index + 1} ${labels.area}`}
                          photoUrl={vehicle.photo_url}
                          skipped={vehicle.photo_skipped}
                          skipLabel={labels.skip}
                          cameraLabel={labels.camera}
                          galleryLabel="🖼 Gallery"
                          placeContext={galleryPlaceFor(job, load, 'site')}
                          onUploaded={(photo, exif) => applyVehicleExif(load.id, vehicle.id, photo, exif)}
                          onOverflow={(photo, exif) => addExtraPhoto(load.id, vehicle.id, photo, exif)}
                          onSkip={() => patchVehicle(load.id, vehicle.id, { photo_skipped: true })}
                          note={vehicle.photo_note}
                          onNoteChange={value => patchVehicle(load.id, vehicle.id, { photo_note: value })}
                          onClear={() =>
                            patchVehicle(load.id, vehicle.id, {
                              photo_skipped: false,
                              photo_id: null,
                              photo_url: null,
                              photo_note: '',
                            })
                          }
                        />
                        {((vehicle.extra_photos ?? []).length > 0 || vehicle.photo_url || vehicle.photo_skipped) && (
                          <div style={{ marginTop: 12 }}>
                            <label style={LABEL}>More photos</label>
                            {((vehicle.extra_photos ?? []).length > 0) && (
                              <PhotoReorderGrid
                                photos={vehicle.extra_photos ?? []}
                                altPrefix="Extra"
                                onMove={(pIndex, direction) => moveExtraPhoto(load.id, vehicle.id, pIndex, direction)}
                                onNote={(id, value) => patchExtraPhotoNote(load.id, vehicle.id, id, value)}
                                onRemove={id => removeExtraPhoto(load.id, vehicle.id, id)}
                              />
                            )}
                            <DisposalPhotoSlot
                              jobId={job.id}
                              areaRef={`Disposal load ${index + 1} — ${labels.area} ${vIndex + 1} extra`}
                              caption={`Load ${index + 1} ${labels.area} extra`}
                              photoUrl={null}
                              skipped={false}
                              skipLabel=""
                              hideSkip
                              cameraLabel="📷 More"
                              galleryLabel="🖼 Gallery"
                              placeContext={galleryPlaceFor(job, load, 'site')}
                              onUploaded={(photo, exif) => addExtraPhoto(load.id, vehicle.id, photo, exif)}
                              onSkip={() => undefined}
                              onClear={() => undefined}
                            />
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                        <div>
                          <label style={LABEL}>Size</label>
                          <input
                            value={vehicle.size}
                            onChange={e => patchVehicle(load.id, vehicle.id, { size: e.target.value })}
                            placeholder={sizePlaceholder(vehicle.type)}
                            style={INPUT}
                          />
                        </div>
                        <div>
                          <label style={LABEL}>Load measurements (metres)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            <div>
                              <label style={{ ...LABEL, fontSize: 10 }}>Length</label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={vehicle.length_m ?? ''}
                                onChange={e =>
                                  patchVehicle(load.id, vehicle.id, {
                                    length_m: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                placeholder="4.05"
                                style={INPUT}
                              />
                            </div>
                            <div>
                              <label style={{ ...LABEL, fontSize: 10 }}>Width</label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={vehicle.width_m ?? ''}
                                onChange={e =>
                                  patchVehicle(load.id, vehicle.id, {
                                    width_m: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                placeholder="1.80"
                                style={INPUT}
                              />
                            </div>
                            <div>
                              <label style={{ ...LABEL, fontSize: 10 }}>Height</label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={vehicle.height_m ?? ''}
                                onChange={e =>
                                  patchVehicle(load.id, vehicle.id, {
                                    height_m: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                placeholder="0.50"
                                style={INPUT}
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                            Volume: {volM3 != null ? formatM3(volM3) : '—'}
                            {tapeHint && (
                              <span>
                                {' '}· tape → {dimsM.length_m ?? '—'} × {dimsM.width_m ?? '—'} × {dimsM.height_m ?? '—'} m
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <label style={LABEL}>Contents type</label>
                          <select
                            value={vehicle.contents_type}
                            onChange={e =>
                              patchVehicle(load.id, vehicle.id, {
                                contents_type: e.target.value as DisposalVehicle['contents_type'],
                              })
                            }
                            style={{ ...INPUT, cursor: 'pointer' }}
                          >
                            <option value="">Select…</option>
                            {DISPOSAL_CONTENTS_TYPES.map(t => (
                              <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        {vehicle.contents_type === 'other' && (
                          <div>
                            <label style={LABEL}>Other contents</label>
                            <input
                              value={vehicle.contents_other}
                              onChange={e =>
                                patchVehicle(load.id, vehicle.id, { contents_other: e.target.value })
                              }
                              placeholder="Name the waste type"
                              style={INPUT}
                            />
                          </div>
                        )}
                        <div>
                          <label style={LABEL}>Content description</label>
                          <textarea
                            value={vehicle.contents_description}
                            onChange={e =>
                              patchVehicle(load.id, vehicle.id, { contents_description: e.target.value })
                            }
                            rows={2}
                            placeholder="e.g. sofas, mattresses, mixed household from dwelling"
                            style={{ ...INPUT, resize: 'vertical', minHeight: 64 }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={() => removeVehicle(load.id, vehicle.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#F87171',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Remove vehicle
                        </button>
                      </div>
                    </div>
                  )
                })}

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => addVehicle(load.id)}
                  style={{ width: '100%', marginTop: 12, padding: 10, fontWeight: 700 }}
                >
                  + Add vehicle
                </button>

                <div style={{ ...LABEL, marginTop: 22 }}>Drop-off</div>
                <div>
                  <label style={LABEL}>
                    Facility / dump location
                    <MetaChip show={load.dump_location_from_photo} fromDevice={load.dump_location_from_device} />
                  </label>
                  <AddressAutocomplete
                    value={load.facility || load.dump_location}
                    lat={load.dump_lat}
                    lng={load.dump_lng}
                    placeholder="Tip / facility name or address"
                    style={INPUT}
                    onChange={next => {
                      const origin = loadOriginLatLng(load, job)
                      const km = distanceFromSiteKm(origin.lat, origin.lng, next.lat, next.lng)
                      const allow = canAutofillDistance(load)
                      patchLoad(load.id, {
                        facility: next.address,
                        dump_location: next.address,
                        dump_lat: next.lat,
                        dump_lng: next.lng,
                        dump_location_from_photo: false,
                        dump_location_from_device: false,
                        ...(allow && km != null
                          ? { distance_km: km, distance_from_geo: true }
                          : allow
                            ? { distance_from_geo: true }
                            : {}),
                      })
                      if (allow) {
                        void ensureTripDistance(load.id, {
                          facility: next.address,
                          dump_location: next.address,
                          dump_lat: next.lat,
                          dump_lng: next.lng,
                        })
                      }
                    }}
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={LABEL}>
                    Distance pickup → facility (km)
                    <MetaChip show={load.distance_from_geo} label="From map" />
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={load.distance_km ?? ''}
                      onChange={e =>
                        patchLoad(load.id, {
                          distance_km: e.target.value === '' ? null : Number(e.target.value),
                          distance_from_geo: false,
                        })
                      }
                      placeholder="Auto from map"
                      style={{ ...INPUT, flex: 1 }}
                    />
                    <button
                      type="button"
                      aria-label="Recalculate distance from pickup and drop-off"
                      title="Recalculate from pickup and drop-off"
                      disabled={distanceBusyId === load.id || saving}
                      onClick={() => void reloadTripDistance(load.id)}
                      style={{
                        ...MOVE_BTN,
                        width: 44,
                        height: 'auto',
                        minHeight: 38,
                        cursor: distanceBusyId === load.id || saving ? 'not-allowed' : 'pointer',
                        opacity: distanceBusyId === load.id || saving ? 0.5 : 1,
                        fontSize: 18,
                      }}
                    >
                      {distanceBusyId === load.id ? '…' : '↻'}
                    </button>
                  </div>
                  {distanceErrors[load.id] && (
                    <div style={{ color: '#F87171', fontSize: 12, marginTop: 6 }}>
                      {distanceErrors[load.id]}
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={LABEL}>Drop-off photos</label>
                  {((load.facility_photos ?? []).length > 0) && (
                    <PhotoReorderGrid
                      photos={load.facility_photos ?? []}
                      altPrefix="Drop-off"
                      onMove={(pIndex, direction) => moveFacilityPhoto(load.id, pIndex, direction)}
                      onNote={(id, value) => patchFacilityPhotoNote(load.id, id, value)}
                      onRemove={id => removeFacilityPhoto(load.id, id)}
                    />
                  )}
                  <DisposalPhotoSlot
                    jobId={job.id}
                    areaRef={`Disposal load ${index + 1} — drop-off`}
                    caption={`Load ${index + 1} drop-off`}
                    photoUrl={null}
                    skipped={false}
                    skipLabel=""
                    hideSkip
                    cameraLabel="📷 Drop-off"
                    galleryLabel="🖼 Gallery"
                    placeContext={galleryPlaceFor(job, load, 'dump')}
                    onUploaded={(photo, exif) => addFacilityPhoto(load.id, photo, exif)}
                    onSkip={() => undefined}
                    onClear={() => undefined}
                  />
                </div>

                {docketOpen && (
                  <>
                    <div style={{ ...LABEL, marginTop: 22 }}>Docket</div>
                    {(!load.docket_skipped || load.docket_photo_url) && (
                    <DisposalPhotoSlot
                      jobId={job.id}
                      areaRef={`Disposal load ${index + 1} — docket`}
                      caption={`Load ${index + 1} dump docket`}
                      photoUrl={load.docket_photo_url}
                      skipped={false}
                      hideSkip
                      skipLabel=""
                      cameraLabel="📷 Docket"
                      galleryLabel="🖼 Gallery"
                      placeContext={galleryPlaceFor(job, load, 'dump')}
                      onUploaded={(photo, exif) => applyDocketExif(load.id, photo, exif)}
                      onOverflow={(photo, exif) => addFacilityPhoto(load.id, photo, exif)}
                      note={load.docket_photo_note}
                      onNoteChange={value => patchLoad(load.id, { docket_photo_note: value })}
                      onSkip={() => undefined}
                      onClear={() =>
                        patchLoad(load.id, {
                          docket_skipped: false,
                          docket_lost: false,
                          recycling: false,
                          docket_photo_id: null,
                          docket_photo_url: null,
                          docket_photo_note: '',
                          dump_location_from_photo: false,
                          dump_location_from_device: false,
                          dump_datetime_from_photo: false,
                          dump_datetime_from_device: false,
                          distance_from_geo: false,
                        })
                      }
                    />
                    )}
                    {!load.docket_photo_url && (
                      <label style={{ ...CHECK, marginTop: load.docket_skipped ? 0 : 12, marginBottom: 12 }}>
                        <input
                          type="checkbox"
                          checked={load.docket_skipped}
                          style={CHECKBOX}
                          onChange={e => {
                            const on = e.target.checked
                            patchLoad(load.id, {
                              docket_skipped: on,
                              docket_lost: on ? load.docket_lost : false,
                              recycling: on ? load.recycling : false,
                            })
                          }}
                        />
                        No docket available
                      </label>
                    )}
                    {load.docket_skipped && !load.docket_photo_url && (
                      <div
                        style={{
                          display: 'grid',
                          gap: 10,
                          marginBottom: 12,
                          padding: '12px 12px 14px',
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-2)',
                        }}
                      >
                        <label style={CHECK}>
                          <input
                            type="checkbox"
                            checked={load.docket_lost}
                            style={CHECKBOX}
                            onChange={e => patchLoad(load.id, { docket_lost: e.target.checked })}
                          />
                          Lost
                        </label>
                        <label style={CHECK}>
                          <input
                            type="checkbox"
                            checked={load.recycling}
                            style={CHECKBOX}
                            onChange={e => patchLoad(load.id, { recycling: e.target.checked })}
                          />
                          Recycling
                        </label>
                        {load.recycling && (
                          <div>
                            <label style={LABEL}>Type of recycle</label>
                            <input
                              value={load.recycling_type ?? ''}
                              onChange={e => patchLoad(load.id, { recycling_type: e.target.value })}
                              placeholder="e.g. metal, cardboard, green waste"
                              style={INPUT}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {(load.docket_photo_url || load.docket_skipped) && (
                  <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={LABEL}>
                          Dump date
                          <MetaChip show={load.dump_datetime_from_photo} fromDevice={load.dump_datetime_from_device} />
                        </label>
                        <input
                          type="date"
                          value={load.dump_date ?? ''}
                          onChange={e =>
                            patchLoad(load.id, {
                              dump_date: e.target.value,
                              dump_datetime_from_photo: false,
                              dump_datetime_from_device: false,
                            })
                          }
                          style={INPUT}
                        />
                      </div>
                      <div>
                        <label style={LABEL}>Dump time</label>
                        <input
                          type="time"
                          value={load.dump_time ?? ''}
                          onChange={e =>
                            patchLoad(load.id, {
                              dump_time: e.target.value,
                              dump_datetime_from_photo: false,
                              dump_datetime_from_device: false,
                            })
                          }
                          style={INPUT}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={LABEL}>Weight (kg)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={load.weight_kg ?? ''}
                          onChange={e =>
                            patchLoad(load.id, {
                              weight_kg: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder="kg"
                          style={INPUT}
                        />
                      </div>
                      <div>
                        <label style={LABEL}>Dump fee ($)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={load.dump_fee ?? ''}
                          onChange={e =>
                            patchLoad(load.id, {
                              dump_fee: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder="0.00"
                          style={INPUT}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={LABEL}>Notes</label>
                      <textarea
                        value={load.notes}
                        onChange={e => patchLoad(load.id, { notes: e.target.value })}
                        rows={2}
                        placeholder="Rego, docket number, containment…"
                        style={{ ...INPUT, resize: 'vertical', minHeight: 64 }}
                      />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => removeLoad(load.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#F87171',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Remove load
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={addLoad}
        style={{ width: '100%', marginBottom: 18, padding: 12, fontWeight: 700 }}
      >
        + Another load
      </button>

      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid rgba(148,163,184,0.45)',
          background: 'linear-gradient(165deg, rgba(100,116,139,0.22) 0%, var(--surface) 58%)',
          marginBottom: 18,
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12, color: '#E2E8F0' }}>
          Disposal totals
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Loads</span>
          <span>{totals.load_count}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Volume</span>
          <span>{totals.volume_recorded ? formatM3(totals.volume_m3) : '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Weight</span>
          <span>{totals.weight_recorded ? formatKg(totals.weight_kg) : '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Distance</span>
          <span>{totals.distance_recorded ? `${totals.distance_km} km` : '—'}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--border)',
            paddingTop: 8,
            marginTop: 6,
          }}
        >
          <strong>Dump fees</strong>
          <strong>{totals.fees_recorded ? formatAud(totals.dump_fees) : '—'}</strong>
        </div>
      </div>

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
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {saveError && (
            <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }} role="alert">
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !isDirty}
              onClick={() => void save()}
              style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}
            >
              {saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save loads'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void saveAndCompose()}
              style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}
            >
              Save as document
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
