/*
 * Execute-phase Disposal Manifest: one card per dump trip.
 * Vehicles (trailer / ute / skip) with size + L×W×H, then a shared weighbridge docket.
 */
'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { DisposalLoad, DisposalVehicle, Job, Photo } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import DisposalPhotoSlot, { PhotoNoteField, ZoomablePhoto } from '@/components/DisposalPhotoSlot'
import { formatCoordLabel, timeFromTakenAt, type PhotoExif } from '@/lib/photoExif'
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

function MetaChip({ show, fromDevice }: { show: boolean; fromDevice?: boolean }) {
  if (!show) return null
  return <span style={CHIP}>{fromDevice ? 'From phone' : 'From photo'}</span>
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

  const isDirty = !disposalManifestEqual(capture, persisted)
  useRegisterUnsavedChanges('disposal-manifest-capture', isDirty)

  useEffect(() => {
    setCapture(applyJobSiteToCapture(mergedDisposalManifestCapture(job.assessment_data), job))
  }, [job.id, job.updated_at, job.site_address, job.site_lat, job.site_lng])

  const totals = useMemo(() => computeDisposalTotals(capture.loads), [capture.loads])

  function touch() {
    setSavedFlash(false)
    setSaveError('')
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
              },
        )
        let next: DisposalLoad = { ...load, vehicles }
        if (!load.date.trim() && exif.date) {
          next.date = exif.date
          next.date_from_photo = true
          next.date_from_device = Boolean(exif.timeFromDevice)
        }
        if (exif.lat != null && exif.lng != null) {
          next.location_lat = exif.lat
          next.location_lng = exif.lng
        }
        return applyJobSiteToLoad(withMirrors(next), job)
      }),
    }))
    touch()
    onPhotosUpdate([photo, ...photos])
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
        }
        if (!load.dump_date.trim() && (exif.date || timeFromTakenAt(exif.takenAt))) {
          if (exif.date) next.dump_date = exif.date
          const time = timeFromTakenAt(exif.takenAt)
          if (time) next.dump_time = time
          next.dump_datetime_from_photo = true
          next.dump_datetime_from_device = Boolean(exif.timeFromDevice)
        }
        if (exif.lat != null && exif.lng != null) {
          next.dump_lat = exif.lat
          next.dump_lng = exif.lng
          if (!load.dump_location.trim()) {
            next.dump_location = formatCoordLabel(exif.lat, exif.lng)
            next.dump_location_from_photo = true
            next.dump_location_from_device = Boolean(exif.geoFromDevice)
          }
          if (load.distance_km == null) {
            const km = distanceFromSiteKm(job.site_lat, job.site_lng, exif.lat, exif.lng)
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
          assessment_data: { ...merged, disposal_manifest_capture: applyJobSiteToCapture(nextCapture, job) },
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

  function addExtraPhoto(loadId: string, vehicleId: string, photo: Photo) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          vehicles: l.vehicles.map(v =>
            v.id !== vehicleId
              ? v
              : { ...v, extra_photos: [...(v.extra_photos ?? []), { id: photo.id, url: photo.file_url, note: '' }] },
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

  function addFacilityPhoto(loadId: string, photo: Photo) {
    setCapture(prev => ({
      loads: prev.loads.map(l => {
        if (l.id !== loadId) return l
        return withMirrors({
          ...l,
          facility_photos: [...(l.facility_photos ?? []), { id: photo.id, url: photo.file_url, note: '' }],
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
    <div style={{ maxWidth: 720, paddingBottom: 48 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        One card per dump trip. Classify each vehicle (trailer, ute, skip), add size and
        measurements, then the shared weighbridge docket. Volumes and fees roll up below.
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
                    <input
                      value={load.location}
                      onChange={e => patchLoad(load.id, { location: e.target.value, location_from_photo: false })}
                      placeholder="Pickup / load location"
                      style={INPUT}
                    />
                  </div>
                </div>

                {load.vehicles.map((vehicle, vIndex) => {
                  const labels = photoLabels(vehicle.type)
                  const volM3 = vehicleVolumeM3(vehicle)
                  const detailsOpen = Boolean(vehicle.photo_url || vehicle.photo_skipped)
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
                          onUploaded={(photo, exif) => applyVehicleExif(load.id, vehicle.id, photo, exif)}
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
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 1fr',
                                  gap: 8,
                                  marginBottom: 8,
                                }}
                              >
                                {(vehicle.extra_photos ?? []).map((p, pIndex) => (
                                  <div key={p.id} style={{ position: 'relative' }}>
                                    <div
                                      style={{
                                        borderRadius: 10,
                                        overflow: 'hidden',
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface)',
                                      }}
                                    >
                                      <ZoomablePhoto src={p.url} alt={p.note || `Extra ${pIndex + 1}`} maxHeight={180} />
                                    </div>
                                    <PhotoNoteField
                                      value={p.note ?? ''}
                                      onChange={value => patchExtraPhotoNote(load.id, vehicle.id, p.id, value)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeExtraPhoto(load.id, vehicle.id, p.id)}
                                      style={{
                                        marginTop: 6,
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
                                ))}
                              </div>
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
                              onUploaded={(photo) => addExtraPhoto(load.id, vehicle.id, photo)}
                              onSkip={() => undefined}
                              onClear={() => undefined}
                            />
                          </div>
                        )}
                      </div>

                      {detailsOpen && (
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
                            <label style={LABEL}>Load measurements (m)</label>
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
                                  placeholder="L"
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
                                  placeholder="W"
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
                                  placeholder="H"
                                  style={INPUT}
                                />
                              </div>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                              Volume: {volM3 != null ? formatM3(volM3) : '—'}
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
                      )}

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

                {docketOpen && (
                  <>
                    <div style={{ ...LABEL, marginTop: 22 }}>Dump fee / skip docket</div>
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
                      onUploaded={(photo, exif) => applyDocketExif(load.id, photo, exif)}
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
                      <label style={LABEL}>
                        Distance site → facility (km)
                        <MetaChip show={load.distance_from_geo} />
                      </label>
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
                        placeholder="km"
                        style={INPUT}
                      />
                    </div>
                    <div>
                      <label style={LABEL}>
                        Facility / dump location
                        <MetaChip show={load.dump_location_from_photo} fromDevice={load.dump_location_from_device} />
                      </label>
                      <input
                        value={load.facility || load.dump_location}
                        onChange={e =>
                          patchLoad(load.id, {
                            facility: e.target.value,
                            dump_location: e.target.value,
                            dump_location_from_photo: false,
                            dump_location_from_device: false,
                          })
                        }
                        placeholder="Tip / facility name"
                        style={INPUT}
                      />
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
                    <div>
                      <label style={LABEL}>Facility photos</label>
                      {((load.facility_photos ?? []).length > 0) && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 8,
                            marginBottom: 8,
                          }}
                        >
                          {(load.facility_photos ?? []).map((p, pIndex) => (
                            <div key={p.id} style={{ position: 'relative' }}>
                              <div
                                style={{
                                  borderRadius: 10,
                                  overflow: 'hidden',
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                }}
                              >
                                <ZoomablePhoto src={p.url} alt={p.note || `Facility ${pIndex + 1}`} maxHeight={180} />
                              </div>
                              <PhotoNoteField
                                value={p.note ?? ''}
                                onChange={value => patchFacilityPhotoNote(load.id, p.id, value)}
                              />
                              <button
                                type="button"
                                onClick={() => removeFacilityPhoto(load.id, p.id)}
                                style={{
                                  marginTop: 6,
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
                          ))}
                        </div>
                      )}
                      <DisposalPhotoSlot
                        jobId={job.id}
                        areaRef={`Disposal load ${index + 1} — facility extra`}
                        caption={`Load ${index + 1} facility extra`}
                        photoUrl={null}
                        skipped={false}
                        skipLabel=""
                        hideSkip
                        cameraLabel="📷 More"
                        galleryLabel="🖼 Gallery"
                        onUploaded={photo => addFacilityPhoto(load.id, photo)}
                        onSkip={() => undefined}
                        onClear={() => undefined}
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

      {saveError && (
        <div style={{ color: '#F87171', fontSize: 13, marginBottom: 10 }} role="alert">
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
  )
}
