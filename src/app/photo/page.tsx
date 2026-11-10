'use client'

import { useEffect, useRef, useState } from 'react'
import {
  flushStandalonePhotoQueue,
  formatBrisbaneFullStamp,
  listQueuedStandalonePhotos,
  queueStandalonePhoto,
  readPositionWithAccuracy,
  stampPhotoJpeg,
  stampVideoFrameJpeg,
  type GeoPointWithAccuracy,
} from '@/lib/standalonePhotoClient'

interface PinPerson {
  person_id: string
  org_id: string
  name: string
  person_code: string
}

interface PinJobOption {
  job_id: string | null
  job_code: string
  label: string
  address: string
}

interface CapturedPhoto {
  id: string
  url: string | null
  device_time: string
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  stamp_text: string
  note: string
  job_code?: string
  job_id?: string | null
  queued?: boolean
}

const PIN_STORAGE_KEY = 'fcq_photo_pin_v1'
const JOB_STORAGE_KEY = 'fcq_photo_job_v1'

const PHOTO_TAG_OPTIONS = [
  { id: 'pool', label: 'Job Pool' },
  { id: 'cdr_load', label: 'CDR Load' },
  { id: 'cdr_dropoff', label: 'CDR Drop-off' },
  { id: 'cdr_docket', label: 'CDR Docket' },
  { id: 'before', label: 'Before' },
  { id: 'during', label: 'During' },
  { id: 'after', label: 'After' },
] as const

type PhotoTagId = (typeof PHOTO_TAG_OPTIONS)[number]['id']

export default function StandalonePhotoPage() {
  const [pin, setPin] = useState('')
  const [person, setPerson] = useState<PinPerson | null>(null)
  const [pinError, setPinError] = useState('')
  const [checkingPin, setCheckingPin] = useState(false)
  const [booting, setBooting] = useState(true)

  const [jobOptions, setJobOptions] = useState<PinJobOption[]>([])
  const [jobCode, setJobCode] = useState('')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [photoTag, setPhotoTag] = useState<PhotoTagId>('pool')

  const [now, setNow] = useState<Date>(() => new Date())
  const [geo, setGeo] = useState<GeoPointWithAccuracy | null>(null)
  const [geoStatus, setGeoStatus] = useState<'locating' | 'ready' | 'unavailable'>('locating')

  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [lastCaptured, setLastCaptured] = useState<CapturedPhoto | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])

  // Live viewfinder state so the operator sees the exact stamp overlaid on the camera feed
  const [liveCameraActive, setLiveCameraActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  async function refreshQueuedCount() {
    try {
      const items = await listQueuedStandalonePhotos()
      setQueuedCount(items.length)
    } catch {
      // IndexedDB unavailable
    }
  }

  function rememberJobSelection(code: string, jobId: string | null) {
    const clean = code.trim().toUpperCase()
    setJobCode(clean)
    setSelectedJobId(jobId)
    try {
      window.localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify({ job_code: clean, job_id: jobId }))
    } catch {
      // ignore
    }
  }

  async function verifyPin(candidatePin: string, silent = false) {
    if (!/^\d{4}$/.test(candidatePin)) return
    setCheckingPin(true)
    if (!silent) setPinError('')
    try {
      const res = await fetch(`/api/photo?pin=${encodeURIComponent(candidatePin)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.person) {
        if (!silent) setPinError(data?.error ?? 'Invalid 4-digit PIN.')
        try {
          window.localStorage.removeItem(PIN_STORAGE_KEY)
        } catch {
          // ignore
        }
        setPerson(null)
        return
      }
      setPerson(data.person as PinPerson)
      setPin(candidatePin)
      const fetchedJobs = (data.jobs ?? []) as PinJobOption[]
      setJobOptions(fetchedJobs)
      setPhotos((data.photos ?? []) as CapturedPhoto[])
      try {
        window.localStorage.setItem(PIN_STORAGE_KEY, candidatePin)
      } catch {
        // ignore
      }
    } catch {
      if (!silent) setPinError('Could not check PIN. Check your connection.')
    } finally {
      setCheckingPin(false)
      setBooting(false)
    }
  }

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(clock)
  }, [])

  useEffect(() => {
    let saved = ''
    try {
      const params = new URLSearchParams(window.location.search)
      const urlPin = params.get('pin') ?? ''
      const urlJob = (params.get('job') ?? params.get('job_code') ?? '').trim().toUpperCase()
      saved = /^\d{4}$/.test(urlPin) ? urlPin : (window.localStorage.getItem(PIN_STORAGE_KEY) ?? '')
      if (urlJob) {
        setJobCode(urlJob)
      } else {
        const storedJob = window.localStorage.getItem(JOB_STORAGE_KEY)
        if (storedJob) {
          const parsed = JSON.parse(storedJob) as { job_code?: string; job_id?: string | null }
          if (parsed?.job_code) setJobCode(parsed.job_code)
          if (parsed?.job_id) setSelectedJobId(parsed.job_id)
        }
      }
    } catch {
      saved = ''
    }
    if (/^\d{4}$/.test(saved)) {
      void verifyPin(saved, true)
    } else {
      setBooting(false)
    }
    void refreshQueuedCount()
  }, [])

  useEffect(() => {
    if (!person) return
    let cancelled = false
    function refreshGeo() {
      readPositionWithAccuracy().then(point => {
        if (cancelled) return
        if (point) {
          setGeo(point)
          setGeoStatus('ready')
        } else {
          setGeoStatus(prev => (prev === 'ready' ? 'ready' : 'unavailable'))
        }
      })
    }
    refreshGeo()
    const timer = window.setInterval(refreshGeo, 15000)
    const onOnline = () => {
      void flushStandalonePhotoQueue().then(uploaded => {
        void refreshQueuedCount()
        if (uploaded > 0 && pin) void verifyPin(pin, true)
      })
    }
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [person, pin])

  // Start rear camera live preview so the operator sees the live stamp overlaid on the viewfinder
  useEffect(() => {
    if (!person) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      setLiveCameraActive(false)
      return
    }
    let cancelled = false
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        .then(stream => {
          if (cancelled) {
            stream.getTracks().forEach(t => t.stop())
            return
          }
          streamRef.current = stream
          setLiveCameraActive(true)
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            void videoRef.current.play().catch(() => {})
          }
        })
        .catch(() => {
          if (!cancelled) setLiveCameraActive(false)
        })
    }
    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
  }, [person])

  function tapDigit(d: string) {
    if (checkingPin) return
    setPinError('')
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      void verifyPin(next)
    }
  }

  function clearPin() {
    setPin('')
    setPinError('')
  }

  function switchPerson() {
    try {
      window.localStorage.removeItem(PIN_STORAGE_KEY)
    } catch {
      // ignore
    }
    setPerson(null)
    setPin('')
    setPhotos([])
    setLastCaptured(null)
    setUploadError('')
  }

  const matchedOption = jobOptions.find(o => o.job_code === jobCode.trim().toUpperCase())
  const effectiveJobId = matchedOption?.job_id ?? selectedJobId

  function buildStampLines(capturedAt: Date, point: GeoPointWithAccuracy | null): string[] {
    if (!person) return []
    const cleanJobCode = jobCode.trim().toUpperCase()
    const timeLabel = formatBrisbaneFullStamp(capturedAt)
    const gpsLabel = point
      ? `GPS ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}${point.accuracy_m != null ? ` (±${point.accuracy_m}m)` : ''}`
      : 'GPS UNAVAILABLE'
    const cleanNote = note.trim()
    const tagLabel = PHOTO_TAG_OPTIONS.find(t => t.id === photoTag)?.label ?? 'Job Pool'
    return [
      `TIME: ${timeLabel}`,
      `USER: ${person.name} (${person.person_code} · PIN ${pin})  ·  JOB: ${cleanJobCode || 'UNASSIGNED'}  ·  TAG: ${tagLabel.toUpperCase()}`,
      cleanNote ? `${gpsLabel}  ·  NOTE: ${cleanNote}` : gpsLabel,
    ]
  }

  async function saveStampedBlob(blob: Blob, capturedAt: Date, freshGeo: GeoPointWithAccuracy | null, watermarkLines: string[]) {
    if (!person) return
    const cleanJobCode = jobCode.trim().toUpperCase()
    const cleanNote = note.trim()
    const localPreviewUrl = URL.createObjectURL(blob)
    const stampSummary = watermarkLines.join(' · ')
    const deviceTimeIso = capturedAt.toISOString()

    const form = new FormData()
    form.set('pin', pin)
    form.set('job_code', cleanJobCode)
    form.set('photo_tag', photoTag)
    if (effectiveJobId) form.set('job_id', effectiveJobId)
    form.set('file', blob, 'photo.jpg')
    form.set('device_time', deviceTimeIso)
    form.set('stamp_text', stampSummary)
    form.set('note', cleanNote)
    if (freshGeo) {
      form.set('lat', String(freshGeo.lat))
      form.set('lng', String(freshGeo.lng))
      if (freshGeo.accuracy_m != null) form.set('accuracy_m', String(freshGeo.accuracy_m))
    }

    let savedOnline = false
    try {
      const res = await fetch('/api/photo', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.photo) {
        savedOnline = true
        const captured: CapturedPhoto = {
          ...(data.photo as CapturedPhoto),
          url: localPreviewUrl,
          queued: false,
        }
        setLastCaptured(captured)
        setPhotos(prev => [captured, ...prev])
        setNote('')
      }
    } catch {
      savedOnline = false
    }

    if (!savedOnline) {
      const tempId = crypto.randomUUID()
      await queueStandalonePhoto({
        id: tempId,
        pin,
        jobCode: cleanJobCode,
        jobId: effectiveJobId ?? null,
        photoTag,
        blob,
        deviceTime: deviceTimeIso,
        lat: freshGeo?.lat ?? null,
        lng: freshGeo?.lng ?? null,
        accuracyM: freshGeo?.accuracy_m ?? null,
        stampText: stampSummary,
        note: cleanNote,
      })
      await refreshQueuedCount()
      const queuedPhoto: CapturedPhoto = {
        id: tempId,
        url: localPreviewUrl,
        device_time: deviceTimeIso,
        lat: freshGeo?.lat ?? null,
        lng: freshGeo?.lng ?? null,
        accuracy_m: freshGeo?.accuracy_m ?? null,
        stamp_text: stampSummary,
        note: cleanNote,
        job_code: cleanJobCode,
        job_id: effectiveJobId ?? null,
        queued: true,
      }
      setLastCaptured(queuedPhoto)
      setPhotos(prev => [queuedPhoto, ...prev])
      setNote('')
      setUploadError('Offline — stamped photo saved on phone and will upload when signal returns.')
    } else {
      await flushStandalonePhotoQueue()
      await refreshQueuedCount()
    }
  }

  async function captureFromLiveVideo() {
    if (!person || !videoRef.current) return
    setBusy(true)
    setUploadError('')
    try {
      const capturedAt = new Date()
      const freshGeo = (await readPositionWithAccuracy()) ?? geo
      if (freshGeo) {
        setGeo(freshGeo)
        setGeoStatus('ready')
      }
      const watermarkLines = buildStampLines(capturedAt, freshGeo)
      const blob = await stampVideoFrameJpeg(videoRef.current, watermarkLines)
      await saveStampedBlob(blob, capturedAt, freshGeo, watermarkLines)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not capture photo.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(file: File) {
    if (!person) return
    setBusy(true)
    setUploadError('')
    try {
      const capturedAt = new Date()
      const freshGeo = (await readPositionWithAccuracy()) ?? geo
      if (freshGeo) {
        setGeo(freshGeo)
        setGeoStatus('ready')
      }
      const watermarkLines = buildStampLines(capturedAt, freshGeo)
      const blob = await stampPhotoJpeg(file, watermarkLines)
      await saveStampedBlob(blob, capturedAt, freshGeo, watermarkLines)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not capture photo.')
    } finally {
      setBusy(false)
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  if (booting) {
    return (
      <div style={shellStyle}>
        <div style={{ margin: 'auto', fontWeight: 800, fontSize: 18 }}>Loading Camera…</div>
      </div>
    )
  }

  if (!person) {
    return (
      <div style={shellStyle}>
        <div style={{ maxWidth: 420, width: '100%', margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF6B35' }}>
              Forensic Cleaning QLD
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 28, fontWeight: 900 }}>Field Photo Capture</h1>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
              Enter your 4-digit Person PIN. Every photo is permanently stamped with your Name, User ID, Job Code, GPS coordinates, and timestamp.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[0, 1, 2, 3].map(idx => {
              const char = pin[idx] ?? ''
              return (
                <div
                  key={idx}
                  style={{
                    height: 64,
                    borderRadius: 14,
                    border: char ? '2px solid #FF6B35' : '1px solid var(--border)',
                    background: 'var(--surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    fontWeight: 900,
                    fontFamily: 'monospace',
                  }}
                >
                  {char ? '●' : ''}
                </div>
              )
            })}
          </div>

          {pinError && (
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 14 }}>
              {pinError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} type="button" disabled={checkingPin} onClick={() => tapDigit(d)} style={keypadButton}>
                {d}
              </button>
            ))}
            <button type="button" disabled={checkingPin} onClick={clearPin} style={{ ...keypadButton, fontSize: 15, color: 'var(--text-muted)' }}>
              Clear
            </button>
            <button key="0" type="button" disabled={checkingPin} onClick={() => tapDigit('0')} style={keypadButton}>
              0
            </button>
            <button
              type="button"
              disabled={checkingPin}
              onClick={() => setPin(prev => prev.slice(0, -1))}
              style={{ ...keypadButton, fontSize: 18, color: 'var(--text-muted)' }}
            >
              ⌫
            </button>
          </div>
        </div>
      </div>
    )
  }

  const liveTimeText = formatBrisbaneFullStamp(now)
  const liveGpsText =
    geo != null
      ? `GPS ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}${geo.accuracy_m != null ? ` (±${geo.accuracy_m}m)` : ''}`
      : geoStatus === 'locating'
        ? 'LOCATING GPS…'
        : 'GPS UNAVAILABLE'
  const cleanJobCode = jobCode.trim().toUpperCase()

  return (
    <div style={shellStyle}>
      <div style={{ maxWidth: 560, width: '100%', margin: '0 auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Top operator & job code bar */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '10px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#FF6B35' }}>
              Logged-in Operator · PIN {pin}
            </div>
            <div style={{ fontSize: 17, fontWeight: 900 }}>
              {person.name}{' '}
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>
                ({person.person_code})
              </span>
            </div>
          </div>
          <a
            href="/photo/bulk"
            style={{
              marginLeft: 'auto',
              padding: '7px 11px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontWeight: 700,
              fontSize: 12,
              textDecoration: 'none',
            }}
          >
            Bulk upload
          </a>
          <button
            type="button"
            onClick={switchPerson}
            style={{
              padding: '7px 11px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Switch PIN
          </button>
        </div>

        {/* 4-Digit Job Code */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#FF6B35' }}>
              4-Digit Job Code (from dispatch SMS)
            </span>
            {matchedOption && (
              <span style={{ fontSize: 12, color: '#10B981', fontWeight: 800 }}>
                ✓ {matchedOption.address}
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: jobOptions.length > 0 ? '130px 1fr' : '1fr', gap: 8 }}>
            <input
              value={jobCode}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9A-Za-z-]/g, '').toUpperCase().slice(0, 8)
                const match = jobOptions.find(o => o.job_code === raw.trim())
                rememberJobSelection(raw, match?.job_id ?? null)
              }}
              inputMode="numeric"
              placeholder="4 digits"
              maxLength={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 10px',
                borderRadius: 10,
                border: matchedOption ? '2px solid #10B981' : '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontFamily: 'monospace',
                fontWeight: 900,
                fontSize: 18,
                letterSpacing: '0.16em',
                textAlign: 'center',
              }}
            />
            {jobOptions.length > 0 && (
              <select
                value={matchedOption?.job_code ?? ''}
                onChange={e => {
                  const chosen = jobOptions.find(o => o.job_code === e.target.value)
                  if (chosen) {
                    rememberJobSelection(chosen.job_code, chosen.job_id)
                  } else {
                    rememberJobSelection('', null)
                  }
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <option value="">Pick active job…</option>
                {jobOptions.map(opt => (
                  <option key={`${opt.job_code}_${opt.job_id ?? 'r'}`} value={opt.job_code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* LIVE CAMERA VIEWFINDER WITH PROMINENT STAMP OVERLAY (Hawthorne effect: taker sees the exact audit stamp live) */}
        <div
          style={{
            position: 'relative',
            borderRadius: 16,
            overflow: 'hidden',
            border: '2px solid #FF6B35',
            background: '#050811',
            minHeight: liveCameraActive ? 360 : 170,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {liveCameraActive ? (
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{
                width: '100%',
                height: 380,
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div style={{ padding: '24px 16px 8px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              Every photo you take is permanently stamped with the audit block below:
            </div>
          )}

          {/* Top-left REC / Audit indicator */}
          <div
            style={{
              position: liveCameraActive ? 'absolute' : 'static',
              top: 10,
              left: 10,
              right: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: liveCameraActive ? 0 : '8px 12px 0',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(8, 13, 23, 0.85)',
                border: '1px solid rgba(255,107,53,0.6)',
                color: '#F8FAFC',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.06em',
                fontFamily: 'monospace',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} />
              AUDIT STAMP ACTIVE
            </span>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(8, 13, 23, 0.85)',
                color: geo ? '#4ADE80' : '#FBBF24',
                fontSize: 11,
                fontWeight: 800,
                fontFamily: 'monospace',
              }}
            >
              {geo ? 'GPS LOCKED' : 'GPS SEARCHING'}
            </span>
          </div>

          {/* Bottom live stamp bar — identical layout to what is burned onto the JPEG */}
          <div
            style={{
              position: liveCameraActive ? 'absolute' : 'static',
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(8, 13, 23, 0.88)',
              borderTop: '3px solid #FF6B35',
              padding: '10px 14px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: '#FFFFFF',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', color: '#FF6B35', marginBottom: 2 }}>
              VERIFIED FIELD EVIDENCE RECORD — LOGGED TO AUDIT TRAIL
            </div>
            <div style={{ fontWeight: 800 }}>TIME: {liveTimeText}</div>
            <div style={{ fontWeight: 800 }}>
              USER: {person.name} ({person.person_code} · PIN {pin})  ·  JOB: {cleanJobCode || 'UNASSIGNED'}  ·  TAG: {(PHOTO_TAG_OPTIONS.find(t => t.id === photoTag)?.label ?? 'Job Pool').toUpperCase()}
            </div>
            <div style={{ fontWeight: 700, color: '#E2E8F0' }}>
              {liveGpsText}
              {note.trim() ? `  ·  NOTE: ${note.trim()}` : ''}
            </div>
          </div>
        </div>

        {/* 1-tap destination tag pills for Job Photo Pool / CDR / Reports */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PHOTO_TAG_OPTIONS.map(opt => {
            const active = photoTag === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPhotoTag(opt.id)}
                style={{
                  padding: '7px 11px',
                  borderRadius: 999,
                  border: active ? '1px solid #FF6B35' : '1px solid var(--border)',
                  background: active ? 'rgba(255, 107, 53, 0.2)' : 'var(--surface)',
                  color: active ? '#FF6B35' : 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional area / note stamped on photo (e.g. Load 1, Kitchen, Docket)"
          maxLength={140}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '11px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 15,
          }}
        />

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: liveCameraActive ? '1fr auto' : '1fr', gap: 8 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (liveCameraActive && videoRef.current) {
                void captureFromLiveVideo()
              } else {
                cameraInputRef.current?.click()
              }
            }}
            style={{
              width: '100%',
              minHeight: 76,
              borderRadius: 18,
              border: 'none',
              background: busy ? 'var(--surface-2)' : '#FF6B35',
              color: '#FFFFFF',
              fontSize: 21,
              fontWeight: 900,
              cursor: busy ? 'default' : 'pointer',
              boxShadow: '0 10px 26px rgba(255, 107, 53, 0.28)',
            }}
          >
            {busy ? 'Stamping & Saving…' : '📷 Take Stamped Photo'}
          </button>
          {liveCameraActive && (
            <button
              type="button"
              disabled={busy}
              onClick={() => cameraInputRef.current?.click()}
              title="Use native phone camera"
              style={{
                minHeight: 76,
                padding: '0 14px',
                borderRadius: 18,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              HD Cam
            </button>
          )}
        </div>

        {/* Immediate full-width proof of the photo just taken, showing the burned-in stamp */}
        {lastCaptured && (
          <div
            style={{
              borderRadius: 16,
              border: '2px solid #10B981',
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(16, 185, 129, 0.18)',
                color: '#10B981',
                fontWeight: 900,
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>✓ STAMPED PHOTO LOGGED UNDER {person.name.toUpperCase()} ({person.person_code})</span>
              <span>{lastCaptured.queued ? 'QUEUED' : 'SAVED'}</span>
            </div>
            {lastCaptured.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lastCaptured.url}
                alt={lastCaptured.stamp_text}
                style={{ width: '100%', display: 'block', background: '#000' }}
              />
            )}
          </div>
        )}

        {queuedCount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'rgba(251,191,36,0.14)', color: '#FBBF24', fontWeight: 700, fontSize: 13 }}>
            <span>⏳ {queuedCount} photo{queuedCount === 1 ? '' : 's'} queued on device</span>
            <button
              type="button"
              onClick={() =>
                void flushStandalonePhotoQueue().then(uploaded => {
                  void refreshQueuedCount()
                  if (uploaded > 0) void verifyPin(pin, true)
                })
              }
              style={{ border: 'none', background: 'transparent', color: '#FBBF24', fontWeight: 900, cursor: 'pointer' }}
            >
              Retry now
            </button>
          </div>
        )}

        {uploadError && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 13 }}>
            {uploadError}
          </div>
        )}

        {photos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Session Audit Trail ({photos.length})
            </div>
            {photos.map(item => (
              <div
                key={item.id}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  overflow: 'hidden',
                }}
              >
                {item.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={item.stamp_text}
                    style={{ width: '100%', display: 'block', background: '#000' }}
                  />
                )}
                <div style={{ padding: '10px 12px', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', wordBreak: 'break-word' }}>
                    {item.stamp_text}
                  </span>
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      fontWeight: 800,
                      color: item.queued ? '#FBBF24' : '#10B981',
                    }}
                  >
                    {item.queued ? 'Queued' : 'Saved ✓'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const shellStyle = {
  minHeight: '100dvh',
  background: 'var(--bg)',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
} as const

const keypadButton = {
  height: 64,
  borderRadius: 14,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 24,
  fontWeight: 800,
  cursor: 'pointer',
} as const
