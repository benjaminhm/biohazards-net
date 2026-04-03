/*
 * components/tabs/AssessmentTab.tsx
 *
 * The Assessment tab on the job detail page. Manages the `assessment_data`
 * JSON blob stored on the jobs row. Contains three sub-sections:
 *
 *   1. Areas — the rooms/zones affected by the biohazard event. Each area has
 *      a name, size (m²), and contamination level. These feed the QuoteTab's
 *      target pricing and the AI document generation prompts.
 *
 *   2. Checklists — PPE required and special risks (sharps, chemicals, etc.).
 *      Presented as checkbox grids. These appear verbatim in SOW documents.
 *
 *   3. Custom Fields — a dynamic key/value list for site-specific data
 *      (insurance claim numbers, coroner release status, etc.). FIELD_SUGGESTIONS
 *      is a datalist so staff can pick common fields without free-typing every time.
 *
 * SmartFill is available on this tab too — the extract-assessment endpoint
 * extracts AssessmentData fields from voice or text input and merges them in.
 *
 * All changes are saved via PATCH /api/jobs/[id] by merging the new assessment_data
 * into the existing job record. Fields not present in the tab (e.g. target_price,
 * which lives in QuoteTab) are preserved via the merge.
 */
'use client'

import { useState, useEffect, useRef } from 'react'
import type { Job, AssessmentData, Area, CustomField } from '@/lib/types'

// Common field labels for quick selection — datalist suggestions
const FIELD_SUGGESTIONS = [
  'Insurance Company',
  'Claim Number',
  'Policy Number',
  'Property Owner',
  'Property Manager',
  'Agent Contact',
  'Key Location',
  'Access Code',
  'Coroner Released',
  'Body Removed',
  'Police Report Number',
  'Asbestos Suspected',
  'Meth Residue Testing Required',
  'Specialist Disposal Required',
  'Skip Bin Required',
  'Number of Affected Rooms',
  'Sewage Category',
  'Water Damage Classification',
  'Mould Type',
  'Council Notification Required',
  'Environmental Authority Required',
  'Previous Works Done',
  'Utilities Isolated',
  'Pet / Animal on Premises',
  'Next of Kin Contact',
  'Funeral Director',
  'Real Estate Contact',
  'Body Corporate Notified',
]

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
}

function HazardLevel({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            width: 32, height: 32, borderRadius: 6, fontSize: 13, fontWeight: 700,
            border: `2px solid ${value === n ? 'var(--accent)' : 'var(--border)'}`,
            background: value === n ? 'var(--accent)' : 'var(--surface-2)',
            color: value === n ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, textTransform: 'none', letterSpacing: 'normal', color: 'var(--text)', marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
      {label}
    </label>
  )
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

export default function AssessmentTab({ job, onJobUpdate }: Props) {
  const [data, setData] = useState<AssessmentData>(mergeWithDefaults(job.assessment_data))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [smartText, setSmartText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [justExtracted, setJustExtracted] = useState(false)
  const [recording, setRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  useEffect(() => {
    setData(mergeWithDefaults(job.assessment_data))
  }, [job.id])

  function setField<K extends keyof AssessmentData>(key: K, value: AssessmentData[K]) {
    setData(d => ({ ...d, [key]: value }))
    setSaved(false)
  }

  function addArea() {
    setData(d => ({
      ...d,
      areas: [...d.areas, { name: '', sqm: 0, hazard_level: 1, description: '' }],
    }))
    setSaved(false)
  }

  function updateArea(index: number, field: keyof Area, value: string | number) {
    setData(d => {
      const areas = [...d.areas]
      areas[index] = { ...areas[index], [field]: value }
      return { ...d, areas }
    })
    setSaved(false)
  }

  function removeArea(index: number) {
    setData(d => ({ ...d, areas: d.areas.filter((_, i) => i !== index) }))
    setSaved(false)
  }

  function addCustomField() {
    setData(d => ({ ...d, custom_fields: [...(d.custom_fields ?? []), { label: '', value: '' }] }))
    setSaved(false)
  }

  function updateCustomField(index: number, key: keyof CustomField, value: string) {
    setData(d => {
      const fields = [...(d.custom_fields ?? [])]
      fields[index] = { ...fields[index], [key]: value }
      return { ...d, custom_fields: fields }
    })
    setSaved(false)
  }

  function removeCustomField(index: number) {
    setData(d => ({ ...d, custom_fields: (d.custom_fields ?? []).filter((_, i) => i !== index) }))
    setSaved(false)
  }

  function startRecording() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setExtractError('Voice recording is not supported in this browser. Use Chrome.')
      return
    }
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
      if (finalChunk) setSmartText(t => t + finalChunk)
      setInterimText(interim)
    }

    recognition.onerror = (e: { error: string }) => {
      if (e.error !== 'no-speech') setExtractError(`Mic error: ${e.error}`)
      setRecording(false)
      setInterimText('')
    }

    recognition.onend = () => {
      setRecording(false)
      setInterimText('')
    }

    recognitionRef.current = recognition
    recognition.start()
    setRecording(true)
    setExtractError('')
  }

  function stopRecording() {
    recognitionRef.current?.stop()
    setRecording(false)
    setInterimText('')
  }

  async function extractFromText() {
    if (!smartText.trim()) return
    setExtracting(true)
    setExtractError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/extract-assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: smartText }),
      })
      const { extracted, error } = await res.json()
      if (error) throw new Error(error)

      // Merge extracted fields into current data — don't overwrite with nulls
      setData(d => ({
        ...d,
        contamination_level: extracted.contamination_level ?? d.contamination_level,
        biohazard_type:      extracted.biohazard_type      || d.biohazard_type,
        estimated_hours:     extracted.estimated_hours     ?? d.estimated_hours,
        estimated_waste_litres: extracted.estimated_waste_litres ?? d.estimated_waste_litres,
        access_restrictions: extracted.access_restrictions || d.access_restrictions,
        observations:        extracted.observations
          ? (d.observations ? `${d.observations}\n\n${extracted.observations}` : extracted.observations)
          : d.observations,
        areas: extracted.areas?.length ? [...d.areas, ...extracted.areas] : d.areas,
        ppe_required: extracted.ppe_required
          ? { ...d.ppe_required, ...Object.fromEntries(Object.entries(extracted.ppe_required).filter(([, v]) => v === true)) }
          : d.ppe_required,
        special_risks: extracted.special_risks
          ? { ...d.special_risks, ...Object.fromEntries(Object.entries(extracted.special_risks).filter(([, v]) => v === true)) }
          : d.special_risks,
        custom_fields: [
          ...(d.custom_fields ?? []),
          ...(extracted.custom_fields ?? []),
        ],
      }))

      setJustExtracted(true)
      setSmartText('')
      setTimeout(() => setJustExtracted(false), 3000)
    } catch (e: unknown) {
      setExtractError(e instanceof Error ? e.message : 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: data, status: job.status === 'lead' ? 'assessed' : job.status }),
      })
      const resp = await res.json()
      onJobUpdate(resp.job)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const section = (title: string) => (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12, marginTop: 28 }}>
      {title}
    </div>
  )

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── SmartFill ── */}
      <div style={{
        background: justExtracted ? 'rgba(34,197,94,0.06)' : 'var(--surface-2)',
        border: `1px solid ${justExtracted ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: '16px',
        marginBottom: 28,
        transition: 'all 0.3s',
      }}>
        {justExtracted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#4ADE80', fontWeight: 600, fontSize: 14 }}>
            <span style={{ fontSize: 20 }}>✓</span>
            Fields extracted — review below and save when ready
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>SmartFill</div>
              {/* Mic button */}
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                title={recording ? 'Stop recording' : 'Speak your site notes'}
                style={{
                  width: 38, height: 38, borderRadius: '50%',
                  border: `2px solid ${recording ? '#EF4444' : 'var(--border-2)'}`,
                  background: recording ? 'rgba(239,68,68,0.1)' : 'var(--surface-3)',
                  color: recording ? '#EF4444' : 'var(--text-muted)',
                  fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                  animation: recording ? 'pulse 1.2s ease-in-out infinite' : 'none',
                }}
              >
                🎙
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              {recording
                ? 'Listening — speak your site notes, then tap 🎙 to stop'
                : 'Tap 🎙 to speak, or paste an email thread or notes below'}
            </div>

            {/* Live interim transcript shown while speaking */}
            {recording && interimText && (
              <div style={{
                background: 'rgba(255,107,53,0.06)', border: '1px dashed rgba(255,107,53,0.3)',
                borderRadius: 8, padding: '10px 12px', marginBottom: 10,
                fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6,
              }}>
                {interimText}
              </div>
            )}

            <textarea
              value={smartText}
              onChange={e => setSmartText(e.target.value)}
              placeholder={recording ? 'Transcript will appear here as you speak…' : 'Or paste email, notes, or voice memo transcript here…'}
              rows={4}
              style={{ resize: 'vertical', fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}
            />
            {extractError && (
              <div style={{ fontSize: 12, color: '#F87171', marginBottom: 8 }}>{extractError}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={extractFromText}
                disabled={!smartText.trim() || extracting || recording}
                className="btn btn-primary"
                style={{ fontSize: 13, padding: '10px 20px', opacity: (!smartText.trim() || recording) ? 0.4 : 1 }}
              >
                {extracting ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Extracting…</> : '⚡ Extract Fields'}
              </button>
              {smartText && !recording && (
                <button
                  type="button"
                  onClick={() => setSmartText('')}
                  style={{ fontSize: 13, padding: '10px 14px', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, background: 'none', cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>

            <style>{`
              @keyframes pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
                50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
              }
            `}</style>
          </>
        )}
      </div>

      {/* Areas */}
      {section('Areas')}
      {data.areas.map((area, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
            <div>
              <label>Area Name</label>
              <input value={area.name} onChange={e => updateArea(i, 'name', e.target.value)} placeholder="e.g. Master Bedroom" />
            </div>
            <div>
              <label>Sqm</label>
              <input type="number" value={area.sqm || ''} onChange={e => updateArea(i, 'sqm', parseFloat(e.target.value) || 0)} placeholder="0" min="0" />
            </div>
            <button
              onClick={() => removeArea(i)}
              style={{ padding: '10px 12px', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, background: 'rgba(239,68,68,0.08)', fontSize: 13 }}
            >
              Remove
            </button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label>Hazard Level</label>
            <HazardLevel value={area.hazard_level} onChange={v => updateArea(i, 'hazard_level', v)} />
          </div>
          <div>
            <label>Description</label>
            <textarea value={area.description} onChange={e => updateArea(i, 'description', e.target.value)} placeholder="What was found here..." rows={2} style={{ resize: 'vertical' }} />
          </div>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={addArea} style={{ fontSize: 13, marginBottom: 8 }}>
        + Add Area
      </button>

      {/* Contamination */}
      {section('Contamination')}
      <div className="field">
        <label>Contamination Level</label>
        <HazardLevel value={data.contamination_level} onChange={v => setField('contamination_level', v)} />
      </div>
      <div className="field">
        <label>Biohazard Type</label>
        <input value={data.biohazard_type} onChange={e => setField('biohazard_type', e.target.value)} placeholder="e.g. Blood, Decomposition, Sewage..." />
      </div>

      {/* PPE */}
      {section('PPE Required')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Checkbox label="Gloves" checked={data.ppe_required.gloves} onChange={v => setField('ppe_required', { ...data.ppe_required, gloves: v })} />
        <Checkbox label="Tyvek Suit" checked={data.ppe_required.tyvek_suit} onChange={v => setField('ppe_required', { ...data.ppe_required, tyvek_suit: v })} />
        <Checkbox label="Respirator" checked={data.ppe_required.respirator} onChange={v => setField('ppe_required', { ...data.ppe_required, respirator: v })} />
        <Checkbox label="Face Shield" checked={data.ppe_required.face_shield} onChange={v => setField('ppe_required', { ...data.ppe_required, face_shield: v })} />
        <Checkbox label="Boot Covers" checked={data.ppe_required.boot_covers} onChange={v => setField('ppe_required', { ...data.ppe_required, boot_covers: v })} />
        <Checkbox label="Double Bag" checked={data.ppe_required.double_bag} onChange={v => setField('ppe_required', { ...data.ppe_required, double_bag: v })} />
      </div>

      {/* Special Risks */}
      {section('Special Risks')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Checkbox label="Sharps" checked={data.special_risks.sharps} onChange={v => setField('special_risks', { ...data.special_risks, sharps: v })} />
        <Checkbox label="Chemicals" checked={data.special_risks.chemicals} onChange={v => setField('special_risks', { ...data.special_risks, chemicals: v })} />
        <Checkbox label="Structural Damage" checked={data.special_risks.structural_damage} onChange={v => setField('special_risks', { ...data.special_risks, structural_damage: v })} />
        <Checkbox label="Infectious Disease" checked={data.special_risks.infectious_disease} onChange={v => setField('special_risks', { ...data.special_risks, infectious_disease: v })} />
        <Checkbox label="Vermin" checked={data.special_risks.vermin} onChange={v => setField('special_risks', { ...data.special_risks, vermin: v })} />
        <Checkbox label="Mold Spores" checked={data.special_risks.mold_spores} onChange={v => setField('special_risks', { ...data.special_risks, mold_spores: v })} />
      </div>

      {/* Estimates */}
      {section('Estimates & Access')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <div className="field">
          <label>Estimated Hours</label>
          <input type="number" value={data.estimated_hours || ''} onChange={e => setField('estimated_hours', parseFloat(e.target.value) || 0)} placeholder="0" min="0" step="0.5" />
        </div>
        <div className="field">
          <label>Estimated Waste (Litres)</label>
          <input type="number" value={data.estimated_waste_litres || ''} onChange={e => setField('estimated_waste_litres', parseFloat(e.target.value) || 0)} placeholder="0" min="0" />
        </div>
      </div>
      <div className="field">
        <label>Access Restrictions</label>
        <input value={data.access_restrictions} onChange={e => setField('access_restrictions', e.target.value)} placeholder="e.g. Key with property manager, code required..." />
      </div>

      {/* Observations */}
      {section('Technician Observations')}
      <div className="field">
        <textarea
          value={data.observations}
          onChange={e => setField('observations', e.target.value)}
          placeholder="Detailed notes from the site assessment — the more detail here, the better Claude's documents will be..."
          rows={6}
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* ── Additional Details (dynamic custom fields) ── */}
      {section('Additional Details')}
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, marginTop: -8, lineHeight: 1.5 }}>
        Capture anything specific to this job — insurance, access, contacts, specialist requirements. All fields feed into generated documents.
      </p>

      {/* Suggestions datalist */}
      <datalist id="field-label-suggestions">
        {FIELD_SUGGESTIONS.map(s => <option key={s} value={s} />)}
      </datalist>

      {(data.custom_fields ?? []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {(data.custom_fields ?? []).map((field, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: '0 0 44%' }}>
                <input
                  list="field-label-suggestions"
                  value={field.label}
                  onChange={e => updateCustomField(i, 'label', e.target.value)}
                  placeholder="Field name…"
                  style={{ fontSize: 13 }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input
                  value={field.value}
                  onChange={e => updateCustomField(i, 'value', e.target.value)}
                  placeholder="Value…"
                  style={{ fontSize: 13 }}
                />
              </div>
              <button
                type="button"
                onClick={() => removeCustomField(i)}
                style={{
                  flexShrink: 0, padding: '0 10px', height: 42,
                  color: 'var(--text-muted)', border: '1px solid var(--border)',
                  borderRadius: 8, background: 'none', fontSize: 16,
                  display: 'flex', alignItems: 'center', cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={addCustomField}
        style={{ fontSize: 13, marginBottom: 24 }}
      >
        + Add Detail
      </button>

      <button
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{ width: '100%', padding: 14, fontSize: 15 }}
      >
        {saving ? <><span className="spinner" /> Saving...</> : saved ? '✓ Saved' : 'Save Assessment'}
      </button>
    </div>
  )
}
