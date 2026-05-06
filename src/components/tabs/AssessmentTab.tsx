/*
 * components/tabs/AssessmentTab.tsx
 *
 * The Assessment tab on the job detail page (Presentation). Manages `assessment_data`
 * on the jobs row. Visible sections:
 *
 *   1. Areas — room name, photos, description (speech + polish). JSON still includes
 *      sqm, hazard_level, note for downstream docs / Photos tab.
 *
 *   Contamination, PPE, risks, estimates, observations, etc. are not edited here;
 *   they remain in JSON from other flows or legacy data.
 *
 * Per-area Description offers “Polish text” (grammar/spelling via polish-text API)
 * and optional speech-to-text — staff review before save.
 *
 * Photo uploads (camera / gallery) live in each area card between the room name
 * and description; new shots default to category Assessment and use that area’s name as `area_ref`.
 *
 * All changes are saved via PATCH /api/jobs/[id] by merging the new assessment_data
 * into the existing job record. Fields not present in the tab (e.g. target_price,
 * which lives in QuoteTab) are preserved via the merge.
 */
'use client'

import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react'
import type { Job, AssessmentData, Area, FastQuoteCapture, Photo } from '@/lib/types'
import PhotoUploadPanel from '@/components/PhotoUploadPanel'
import PhotoCard from '@/components/PhotoCard'
import { AREA_ROOM_TYPES, areaRoomSelectValue } from '@/lib/areaRoomTypes'

const DEFAULT_ASSESSMENT: AssessmentData = {
  areas: [],
  contamination_level: 1,
  biohazard_type: '',
  ppe_required: {
    gloves: false, tyvek_suit: false, respirator: false,
    face_shield: false, boot_covers: false, double_bag: false,
  },
  special_risks: {
    sharps: false, chemicals: false, structural_damage: false,
    infectious_disease: false, vermin: false, mold_spores: false,
  },
  estimated_hours: 0,
  estimated_waste_litres: 0,
  access_restrictions: '',
  observations: '',
}

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
  photos: Photo[]
  onPhotosUpdate: (photos: Photo[]) => void
}

function mergeWithDefaults(saved: AssessmentData | null): AssessmentData {
  return { ...DEFAULT_ASSESSMENT, ...(saved ?? {}) }
}

// Speech recognition type shim
type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (e: SpeechRecognitionEvent) => void
  onerror: (e: { error: string }) => void
  onend: () => void
  start: () => void
  stop: () => void
}
type SpeechRecognitionEvent = {
  resultIndex: number
  results: { isFinal: boolean; 0: { transcript: string } }[]
}

/** Where browser speech-to-text is sending transcripts */
type SpeechTarget = null | { kind: 'area'; index: number } | { kind: 'fast_quote' }

function emptyFastQuote(): FastQuoteCapture {
  return {
    enabled: true,
    transcript: '',
    limitations_acknowledged: false,
    updated_at: new Date().toISOString(),
  }
}

export default function AssessmentTab({ job, onJobUpdate, photos, onPhotosUpdate }: Props) {
  const [data, setData] = useState<AssessmentData>(mergeWithDefaults(job.assessment_data))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [extractError, setExtractError] = useState('')
  const [speechTarget, setSpeechTarget] = useState<SpeechTarget>(null)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const speechTargetRef = useRef<SpeechTarget>(null)
  /** Invalidates stale recognition onend handlers when starting/stopping a new session */
  const speechGenRef = useRef(0)

  /** Area index whose description is being polished */
  const [polishLoading, setPolishLoading] = useState<number | null>(null)

  useEffect(() => {
    setData(mergeWithDefaults(job.assessment_data))
    setSaveError('')
  }, [job.id])

  function addArea() {
    setData(d => ({
      ...d,
      areas: [
        ...d.areas,
        {
          name: '',
          sqm: 0,
          length_m: 0,
          width_m: 0,
          height_m: 0,
          hazard_level: 1,
          description: '',
          note: '',
        },
      ],
    }))
    setSaved(false)
    setSaveError('')
  }

  function updateArea(index: number, field: keyof Area, value: string | number) {
    setData(d => {
      const areas = [...d.areas]
      areas[index] = { ...areas[index], [field]: value }
      return { ...d, areas }
    })
    setSaved(false)
    setSaveError('')
  }

  /** Update a dimension and auto-derive sqm from length × width when both are set.
   *  Keeps the manual sqm value untouched if the user hasn't entered both L and W. */
  function updateAreaDimension(index: number, field: 'length_m' | 'width_m' | 'height_m', value: number) {
    const safe = Number.isFinite(value) && value >= 0 ? value : 0
    setData(d => {
      const areas = [...d.areas]
      const cur = areas[index]
      const next: Area = { ...cur, [field]: safe }
      const l = field === 'length_m' ? safe : Number(next.length_m ?? 0)
      const w = field === 'width_m' ? safe : Number(next.width_m ?? 0)
      if (l > 0 && w > 0) {
        next.sqm = Math.round(l * w * 100) / 100
      }
      areas[index] = next
      return { ...d, areas }
    })
    setSaved(false)
    setSaveError('')
  }

  function removeArea(index: number) {
    setData(d => ({ ...d, areas: d.areas.filter((_, i) => i !== index) }))
    setSaved(false)
    setSaveError('')
  }

  function updateFastQuote(patch: Partial<FastQuoteCapture>) {
    setData(d => ({
      ...d,
      fast_quote: {
        ...(d.fast_quote ?? emptyFastQuote()),
        ...patch,
        enabled: patch.enabled ?? d.fast_quote?.enabled ?? true,
        updated_at: new Date().toISOString(),
      },
    }))
    setSaved(false)
    setSaveError('')
  }

  async function polishAreaDescription(index: number) {
    const raw = data.areas[index]?.description ?? ''
    if (!raw.trim()) {
      window.alert('Add some text first.')
      return
    }
    setPolishLoading(index)
    try {
      const res = await fetch(`/api/jobs/${job.id}/polish-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      })
      const payload = (await res.json()) as { text?: string; error?: string }
      if (!res.ok || payload.error) {
        window.alert(payload.error ?? 'Could not polish text')
        return
      }
      const next = (payload.text ?? '').trim()
      updateArea(index, 'description', next)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not polish text')
    } finally {
      setPolishLoading(null)
    }
  }

  function stopSpeech() {
    speechGenRef.current += 1
    recognitionRef.current?.stop()
    recognitionRef.current = null
    speechTargetRef.current = null
    setSpeechTarget(null)
    setInterimText('')
  }

  function startSpeech(target: NonNullable<SpeechTarget>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setExtractError('Voice recording is not supported in this browser. Use Chrome.')
      return
    }
    stopSpeech()
    const gen = speechGenRef.current
    speechTargetRef.current = target
    setSpeechTarget(target)

    const recognition: SpeechRecognitionInstance = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-AU'

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let finalChunk = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += transcript + ' '
        else interim += transcript
      }
      if (finalChunk) {
        const t = speechTargetRef.current
        if (t && typeof t === 'object' && t.kind === 'area') {
          const idx = t.index
          setData(d => {
            const areas = [...d.areas]
            if (!areas[idx]) return d
            areas[idx] = {
              ...areas[idx],
              description: (areas[idx].description || '') + finalChunk,
            }
            return { ...d, areas }
          })
          setSaved(false)
        } else if (t && typeof t === 'object' && t.kind === 'fast_quote') {
          setData(d => ({
            ...d,
            fast_quote: {
              ...(d.fast_quote ?? emptyFastQuote()),
              enabled: true,
              transcript: `${d.fast_quote?.transcript ?? ''}${finalChunk}`,
              updated_at: new Date().toISOString(),
            },
          }))
          setSaved(false)
        }
      }
      setInterimText(interim)
    }

    recognition.onerror = (ev: { error: string }) => {
      if (ev.error !== 'no-speech') setExtractError(`Mic error: ${ev.error}`)
      stopSpeech()
    }

    recognition.onend = () => {
      if (gen !== speechGenRef.current) return
      recognitionRef.current = null
      speechTargetRef.current = null
      setSpeechTarget(null)
      setInterimText('')
    }

    recognitionRef.current = recognition
    recognition.start()
    setExtractError('')
  }

  const isAreaSpeech = (i: number) =>
    speechTarget !== null && typeof speechTarget === 'object' && speechTarget.kind === 'area' && speechTarget.index === i
  const isFastQuoteSpeech = speechTarget !== null && typeof speechTarget === 'object' && speechTarget.kind === 'fast_quote'

  function micButtonStyle(active: boolean): CSSProperties {
    return {
      width: 36,
      height: 36,
      borderRadius: '50%',
      flexShrink: 0,
      border: `2px solid ${active ? '#EF4444' : 'var(--border-2)'}`,
      background: active ? 'rgba(239,68,68,0.1)' : 'var(--surface-3)',
      color: active ? '#EF4444' : 'var(--text-muted)',
      fontSize: 15,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.15s',
      animation: active ? 'pulse 1.2s ease-in-out infinite' : 'none',
    }
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: data, status: job.status === 'lead' ? 'assessed' : job.status }),
      })
      const resp = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !resp.job) {
        setSaveError(resp.error ?? `Save failed (${res.status})`)
        return
      }
      onJobUpdate(resp.job)
      setData(mergeWithDefaults(resp.job.assessment_data))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const section = (title: string) => (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12, marginTop: 28 }}>
      {title}
    </div>
  )

  const areaNames = useMemo(
    () => (data.areas ?? []).map(a => (a.name || '').trim()).filter(Boolean),
    [data.areas]
  )
  const fastQuote = data.fast_quote
  /** Photos attached to the Fast Quote brief (no on-site area). Anchored on a fixed
   *  area_ref so they're easy to find, render under their own group in the printed
   *  quote, and get fed to the Quote AI suggester as visual evidence. */
  const FAST_QUOTE_AREA_REF = 'Fast Quote'
  const fastQuotePhotos = photos.filter(
    p => (p.area_ref || '').trim() === FAST_QUOTE_AREA_REF,
  )

  return (
    <div style={{ paddingBottom: 40 }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        }
      `}</style>

      {extractError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 16, lineHeight: 1.45 }}>{extractError}</div>
      )}
      {saveError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 16, lineHeight: 1.45 }} role="alert">
          {saveError}
        </div>
      )}

      {/* Fast Quote */}
      {section('Fast Quote')}
      <div
        className="card"
        style={{
          marginBottom: 14,
          border: fastQuote?.enabled ? '1px solid rgba(255,107,53,0.35)' : '1px solid var(--border)',
          background: fastQuote?.enabled ? 'rgba(255,107,53,0.06)' : 'var(--surface)',
        }}
      >
        {!fastQuote?.enabled ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Fast quote from a voice brief</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Use this when the quote is based on limited information or sight-unseen details. The Quote AI will draft with stronger assumptions, exclusions, and variation caveats.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => updateFastQuote({ enabled: true })}
              style={{ width: 'fit-content', fontSize: 13 }}
            >
              Fast Quote
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Fast Quote mode enabled</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  Dictate the job brief here. Quote generation will treat this as limited-information, sight-unseen input.
                </div>
              </div>
              <button
                type="button"
                onClick={() => (isFastQuoteSpeech ? stopSpeech() : startSpeech({ kind: 'fast_quote' }))}
                title={isFastQuoteSpeech ? 'Stop dictation' : 'Speak fast quote brief'}
                style={micButtonStyle(isFastQuoteSpeech)}
              >
                🎙
              </button>
            </div>
            {isFastQuoteSpeech && interimText && (
              <div
                style={{
                  background: 'rgba(255,107,53,0.06)',
                  border: '1px dashed rgba(255,107,53,0.3)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 8,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                }}
              >
                {interimText}
              </div>
            )}
            <textarea
              value={fastQuote.transcript}
              onChange={e => updateFastQuote({ transcript: e.target.value, enabled: true })}
              placeholder="Voice brief example: Sight unseen quote. Client reports affected bedroom and hallway, odour present, access tomorrow morning, include PPE, waste removal, and allow variation if conditions are worse than described..."
              rows={5}
              style={{ resize: 'vertical', marginBottom: 10 }}
            />

            <div
              style={{
                marginTop: 4,
                marginBottom: 10,
                paddingTop: 10,
                borderTop: '1px dashed rgba(255,107,53,0.25)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 8 }}>
                Optional — attach client-supplied photos (text, email, etc). They&apos;ll be visible
                to the Quote AI suggester and printed under their own group on the quote.
              </div>
              <PhotoUploadPanel
                jobId={job.id}
                fixedAreaRef={FAST_QUOTE_AREA_REF}
                photos={photos}
                onPhotosUpdate={onPhotosUpdate}
                defaultPendingCategory="assessment"
                fixedCapturePhase="assessment"
                compact
              />
              {fastQuotePhotos.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  {fastQuotePhotos.map(photo => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      areaNames={areaNames}
                      showAreaChip={false}
                      onDelete={id => onPhotosUpdate(photos.filter(p => p.id !== id))}
                      onUpdate={updated =>
                        onPhotosUpdate(photos.map(p => (p.id === updated.id ? updated : p)))
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              <input
                type="checkbox"
                checked={fastQuote.limitations_acknowledged}
                onChange={e => updateFastQuote({ limitations_acknowledged: e.target.checked, enabled: true })}
                style={{ marginTop: 2 }}
              />
              <span>
                Treat this as a limited-information quote. The generated quote should include strong assumptions, exclusions, concealed-condition wording, and variation rights.
              </span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {fastQuote.updated_at ? `Updated ${new Date(fastQuote.updated_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => updateFastQuote({ enabled: false })}
                style={{ fontSize: 12 }}
              >
                Disable Fast Quote
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Areas */}
      {section('Areas')}
      {data.areas.map((area, i) => {
        const areaKey = (area.name || '').trim()
        const areaPhotos = areaKey ? photos.filter(p => (p.area_ref || '').trim() === areaKey) : []
        return (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
            <div>
              <label>Area Name</label>
              <select
                value={areaRoomSelectValue(area.name)}
                onChange={e => {
                  const v = e.target.value
                  const cur = (area.name ?? '').trim()
                  const isPreset = AREA_ROOM_TYPES.some(
                    r => r.toLowerCase() === cur.toLowerCase()
                  )
                  let nextName: string
                  if (v === '') {
                    nextName = ''
                  } else if (v === '__other__') {
                    if (isPreset) {
                      nextName = 'Custom room'
                    } else if (cur) {
                      nextName = cur
                    } else {
                      // Empty row → non-empty area_ref so photo upload unlocks immediately
                      nextName = 'Other'
                    }
                  } else {
                    nextName = v
                  }
                  updateArea(i, 'name', nextName)
                }}
                style={{
                  width: '100%',
                  fontSize: 14,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              >
                <option value="">Select room type…</option>
                {AREA_ROOM_TYPES.length === 0 ? (
                  <option value="__other__">Other</option>
                ) : (
                  <>
                    {AREA_ROOM_TYPES.map(r => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="__other__">Other</option>
                  </>
                )}
              </select>
              {areaRoomSelectValue(area.name) === '__other__' && (
                <input
                  value={area.name}
                  onChange={e => updateArea(i, 'name', e.target.value)}
                  placeholder="Type room or area name…"
                  style={{ marginTop: 8, width: '100%' }}
                />
              )}
            </div>
            <button
              onClick={() => removeArea(i)}
              style={{ padding: '10px 12px', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, background: 'rgba(239,68,68,0.08)', fontSize: 13 }}
            >
              Remove
            </button>
          </div>

          {(() => {
            const lengthM = Number(area.length_m ?? 0)
            const widthM = Number(area.width_m ?? 0)
            const heightM = Number(area.height_m ?? 0)
            const derivedSqm = lengthM > 0 && widthM > 0 ? Math.round(lengthM * widthM * 100) / 100 : 0
            const volume = derivedSqm > 0 && heightM > 0 ? Math.round(derivedSqm * heightM * 100) / 100 : 0
            const displaySqm = derivedSqm > 0 ? derivedSqm : Number(area.sqm ?? 0)
            const sqmIsLegacy = derivedSqm === 0 && Number(area.sqm ?? 0) > 0
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <label style={{ margin: 0 }}>Dimensions</label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Foundation for per-m² quoting
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {([
                    { key: 'length_m' as const, label: 'Length (m)' },
                    { key: 'width_m' as const, label: 'Width (m)' },
                    { key: 'height_m' as const, label: 'Height (m)' },
                  ]).map(f => (
                    <div key={f.key}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{f.label}</div>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={Number(area[f.key] ?? 0) > 0 ? Number(area[f.key] ?? 0) : ''}
                        onChange={e => {
                          const n = parseFloat(e.target.value)
                          updateAreaDimension(i, f.key, isNaN(n) ? 0 : n)
                        }}
                        placeholder="0"
                        autoComplete="off"
                        style={{ width: '100%' }}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {displaySqm > 0 ? (
                    <>
                      Floor area:{' '}
                      <strong style={{ color: 'var(--text)' }}>
                        {displaySqm.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²
                      </strong>
                      {volume > 0 && (
                        <>
                          {' · '}Volume:{' '}
                          <strong style={{ color: 'var(--text)' }}>
                            {volume.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m³
                          </strong>
                        </>
                      )}
                      {sqmIsLegacy && (
                        <span style={{ marginLeft: 6, fontStyle: 'italic' }}>
                          (legacy area — add length × width to enable per-m² pricing)
                        </span>
                      )}
                    </>
                  ) : (
                    <>Enter length × width to auto-derive floor area; height enables volume-based pricing (e.g. fogging).</>
                  )}
                </div>
              </div>
            )
          })()}

          <PhotoUploadPanel
            jobId={job.id}
            fixedAreaRef={area.name}
            photos={photos}
            onPhotosUpdate={onPhotosUpdate}
            defaultPendingCategory="assessment"
            compact
          />
          {areaPhotos.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}
            >
              {areaPhotos.map(photo => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  areaNames={areaNames}
                  showAreaChip={false}
                  onDelete={id => onPhotosUpdate(photos.filter(p => p.id !== id))}
                  onUpdate={updated => onPhotosUpdate(photos.map(p => (p.id === updated.id ? updated : p)))}
                />
              ))}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Description</label>
              <button
                type="button"
                onClick={() => (isAreaSpeech(i) ? stopSpeech() : startSpeech({ kind: 'area', index: i }))}
                title={isAreaSpeech(i) ? 'Stop dictation' : 'Speak to add to this description'}
                style={micButtonStyle(isAreaSpeech(i))}
              >
                🎙
              </button>
            </div>
            {isAreaSpeech(i) && interimText && (
              <div
                style={{
                  background: 'rgba(255,107,53,0.06)',
                  border: '1px dashed rgba(255,107,53,0.3)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 8,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                }}
              >
                {interimText}
              </div>
            )}
            <textarea
              value={area.description}
              onChange={e => updateArea(i, 'description', e.target.value)}
              onBlur={e => updateArea(i, 'description', e.target.value)}
              placeholder="What was found here..."
              rows={2}
              style={{ resize: 'vertical' }}
              autoComplete="off"
              enterKeyHint="done"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                title="Fix grammar and spelling only (AI). Review before saving."
                disabled={polishLoading !== null || !(area.description || '').trim()}
                onClick={() => polishAreaDescription(i)}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {polishLoading === i ? 'Polishing…' : 'Polish text'}
              </button>
            </div>
          </div>
        </div>
        )
      })}
      <button className="btn btn-secondary" onClick={addArea} style={{ fontSize: 13, marginBottom: 8 }}>
        + Add Area
      </button>

      <button
        type="button"
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{
          width: '100%',
          padding: 14,
          paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
          fontSize: 15,
          touchAction: 'manipulation',
        }}
      >
        {saving ? <><span className="spinner" /> Saving...</> : saved ? '✓ Saved' : 'Save Assessment'}
      </button>
    </div>
  )
}
