/*
 * Assessment → Document — staff-authored fields (assessment_document_capture) with Suggest from assessment,
 * Listen, AI polish, single Save; internal capture only (no DocType row).
 */
'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Job, AssessmentData, AssessmentDocumentCapture } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { mergedAssessmentDocumentCapture } from '@/lib/assessmentDocumentCapture'
import { assessmentSaveContentBlocksPayload } from '@/lib/contentBlocks'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

const BUBBLE: CSSProperties = {
  width: '100%',
  minHeight: 120,
  padding: '16px 18px',
  borderRadius: 18,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 15,
  lineHeight: 1.55,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
}

const FIELDS: { key: keyof AssessmentDocumentCapture; label: string; placeholder: string }[] = [
  { key: 'site_summary', label: 'Site summary', placeholder: 'Site context, access, and relevant conditions from Presentation…' },
  { key: 'hazards_overview', label: 'Hazards overview', placeholder: 'Summarise presenting and candidate hazards…' },
  { key: 'risks_overview', label: 'Risks overview', placeholder: 'Summarise risk picture and ratings where known…' },
  { key: 'control_measures', label: 'Control measures', placeholder: 'Engineering, administrative, PPE, sequencing…' },
  { key: 'recommendations', label: 'Recommendations', placeholder: 'Next steps, staging, or follow-up assessment needs…' },
  { key: 'limitations', label: 'Limitations', placeholder: 'What was not assessed, assumptions, caveats…' },
]

function captureEqual(a: AssessmentDocumentCapture, b: AssessmentDocumentCapture): boolean {
  return FIELDS.every(({ key }) => (a[key] ?? '') === (b[key] ?? ''))
}

export default function AssessmentDocumentTab({ job, onJobUpdate }: Props) {
  const persisted = mergedAssessmentDocumentCapture(job.assessment_data)
  const [capture, setCapture] = useState<AssessmentDocumentCapture>(persisted)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [polishError, setPolishError] = useState<string | null>(null)
  const [polishingKey, setPolishingKey] = useState<keyof AssessmentDocumentCapture | null>(null)
  const [speakingKey, setSpeakingKey] = useState<keyof AssessmentDocumentCapture | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestMergeMode, setSuggestMergeMode] = useState<'fill_empty' | 'replace_all'>('fill_empty')

  const isDirty = !captureEqual(capture, persisted)
  useRegisterUnsavedChanges('assessment-document-capture', isDirty)

  useEffect(() => {
    setCapture(mergedAssessmentDocumentCapture(job.assessment_data))
  }, [job.id])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  function setField(key: keyof AssessmentDocumentCapture, value: string) {
    setCapture(c => ({ ...c, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
    setPolishError(null)
    setSuggestError(null)
  }

  async function handleSuggestFromAssessment() {
    setSuggesting(true)
    setSuggestError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-assessment-document`, { method: 'POST' })
      const data = await res.json() as { suggestions?: AssessmentDocumentCapture; error?: string }
      if (!res.ok) throw new Error(data.error || 'Suggest failed')
      const s = data.suggestions
      if (!s) throw new Error('No suggestions returned')
      setCapture(prev => {
        if (suggestMergeMode === 'replace_all') {
          return { ...prev, ...s }
        }
        const next = { ...prev }
        for (const { key } of FIELDS) {
          if (!(prev[key] ?? '').trim()) {
            next[key] = s[key] ?? ''
          }
        }
        return next
      })
      setSavedFlash(false)
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Suggest failed')
    } finally {
      setSuggesting(false)
    }
  }

  async function save() {
    setSaving(true)
    setSavedFlash(false)
    setSaveError(null)
    try {
      const merged: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        assessment_document_capture: capture,
        ...assessmentSaveContentBlocksPayload(capture),
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const resp = await res.json()
      if (!res.ok) throw new Error(resp.error || 'Save failed')
      onJobUpdate(resp.job)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleListen(key: keyof AssessmentDocumentCapture) {
    if (typeof window === 'undefined') return
    if (speakingKey === key) {
      window.speechSynthesis.cancel()
      setSpeakingKey(null)
      return
    }
    const text = (capture[key] ?? '').trim()
    if (!text) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-AU'
    u.onstart = () => setSpeakingKey(key)
    u.onend = () => setSpeakingKey(null)
    u.onerror = () => setSpeakingKey(null)
    window.speechSynthesis.speak(u)
  }

  async function handlePolish(key: keyof AssessmentDocumentCapture) {
    const text = (capture[key] ?? '').trim()
    if (!text) return
    setPolishError(null)
    setPolishingKey(key)
    try {
      const res = await fetch(`/api/jobs/${job.id}/polish-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Polish failed')
      const next = typeof data.text === 'string' ? data.text : text
      setField(key, next)
    } catch (e) {
      setPolishError(e instanceof Error ? e.message : 'Polish failed')
    } finally {
      setPolishingKey(null)
    }
  }

  const sectionLabelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--accent)',
    marginBottom: 10,
    marginTop: 22,
  }

  return (
    <div style={{ paddingBottom: 40, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
        Assessment document
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Internal staff capture from Presentation, Hazards, and Risks. Review and edit before saving.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginBottom: 20,
          padding: '14px 16px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Suggest merge:</span>
            <select
              value={suggestMergeMode}
              onChange={e => setSuggestMergeMode(e.target.value as 'fill_empty' | 'replace_all')}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            >
              <option value="fill_empty">Fill empty fields only</option>
              <option value="replace_all">Replace all fields</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={suggesting}
          onClick={() => void handleSuggestFromAssessment()}
          style={{ alignSelf: 'flex-start', padding: '12px 18px', fontSize: 14 }}
        >
          {suggesting ? (
            <>
              <span className="spinner" /> Suggesting…
            </>
          ) : (
            'Suggest from assessment'
          )}
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          Uses Presentation, photos, and Hazards/Risks (Presenting). Same requirements as Scope of Work suggest.
        </p>
        {suggestError && (
          <p style={{ fontSize: 13, color: '#F87171', margin: 0 }} role="alert">
            {suggestError}
          </p>
        )}
      </div>

      {FIELDS.map(({ key, label, placeholder }, i) => (
        <div key={key}>
          <div style={i === 0 ? { ...sectionLabelStyle, marginTop: 0 } : sectionLabelStyle}>{label}</div>
          <textarea
            value={capture[key]}
            onChange={e => setField(key, e.target.value)}
            placeholder={placeholder}
            style={BUBBLE}
            aria-label={label}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!(capture[key] ?? '').trim() && speakingKey !== key}
              onClick={() => handleListen(key)}
              title={speakingKey === key ? 'Stop playback' : 'Read aloud (device text-to-speech)'}
            >
              {speakingKey === key ? 'Stop' : 'Listen'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!(capture[key] ?? '').trim() || polishingKey !== null}
              onClick={() => void handlePolish(key)}
              title="Fix spelling and grammar only (AI)"
            >
              {polishingKey === key ? 'Polishing…' : 'AI polish'}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={saving || !isDirty}
        style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 28 }}
      >
        {saving ? (
          <>
            <span className="spinner" /> Saving…
          </>
        ) : savedFlash && !isDirty ? (
          '✓ Saved'
        ) : (
          'Save assessment document'
        )}
      </button>

      {saveError && (
        <p style={{ fontSize: 13, color: '#F87171', marginTop: 10 }} role="alert">
          {saveError}
        </p>
      )}
      {polishError && (
        <p style={{ fontSize: 13, color: '#F87171', marginTop: 10 }} role="alert">
          {polishError}
        </p>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 24, marginBottom: 0 }}>
        Stored on this job as assessment data (internal). Not a separate document in Docs.
      </p>
    </div>
  )
}
