/*
 * Assessment → Document — staff-authored fields (assessment_document_capture) with Suggest from assessment,
 * Listen, AI polish, single Save; internal capture only (no DocType row).
 */
'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Job, AssessmentData, AssessmentDocumentCapture, PathophysiologyRow } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { mergedAssessmentDocumentCapture } from '@/lib/assessmentDocumentCapture'
import { assessmentSaveContentBlocksPayload } from '@/lib/contentBlocks'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { proseHasPrintableContent } from '@/lib/richTextPrint'
import RichTextEditor from '@/components/RichTextEditor'

/** Keys of AssessmentDocumentCapture that are plain-text textareas with the
 *  AI polish + Listen buttons. Recommendations is rendered separately as a
 *  WYSIWYG block below the pathophysiology table and is intentionally NOT
 *  included here — it lives outside the standard FIELDS loop. */
type TextFieldKey =
  | 'site_summary'
  | 'hazards_overview'
  | 'risks_overview'
  | 'control_measures'
  | 'limitations'

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

const FIELDS: { key: TextFieldKey; label: string; placeholder: string }[] = [
  { key: 'site_summary', label: 'Site summary', placeholder: 'Site context, access, and relevant conditions from Presentation…' },
  { key: 'hazards_overview', label: 'Hazards overview', placeholder: 'Summarise presenting and candidate hazards…' },
  { key: 'risks_overview', label: 'Risks overview', placeholder: 'Summarise risk picture and ratings where known…' },
  { key: 'control_measures', label: 'Control measures', placeholder: 'Engineering, administrative, PPE, sequencing…' },
  { key: 'limitations', label: 'Limitations', placeholder: 'What was not assessed, assumptions, caveats…' },
]

const PATHO_COLS: { key: keyof PathophysiologyRow; label: string; placeholder: string; flex: number; rows: number }[] = [
  { key: 'disease', label: 'Disease', placeholder: 'e.g. Hepatitis B', flex: 1.2, rows: 2 },
  { key: 'pathogen', label: 'Pathogen', placeholder: 'e.g. HBV', flex: 1.2, rows: 2 },
  { key: 'transmission', label: 'Transmission', placeholder: 'Bloodborne; sexual…', flex: 1.4, rows: 3 },
  { key: 'effects', label: 'Effects on humans', placeholder: 'Acute hepatitis; chronic infection…', flex: 2.2, rows: 4 },
  { key: 'incubation', label: 'Incubation', placeholder: '30–180 days', flex: 0.9, rows: 2 },
  { key: 'ppe', label: 'PPE', placeholder: 'Bloodborne PPE level…', flex: 1.5, rows: 3 },
]

function pathoTableEqual(a: PathophysiologyRow[] | undefined, b: PathophysiologyRow[] | undefined): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) {
    const x = aa[i], y = bb[i]
    if ((x.disease ?? '') !== (y.disease ?? '')) return false
    if ((x.pathogen ?? '') !== (y.pathogen ?? '')) return false
    if ((x.transmission ?? '') !== (y.transmission ?? '')) return false
    if ((x.effects ?? '') !== (y.effects ?? '')) return false
    if ((x.incubation ?? '') !== (y.incubation ?? '')) return false
    if ((x.ppe ?? '') !== (y.ppe ?? '')) return false
  }
  return true
}

function captureEqual(a: AssessmentDocumentCapture, b: AssessmentDocumentCapture): boolean {
  const textsEqual = FIELDS.every(({ key }) => (a[key] ?? '') === (b[key] ?? ''))
  if (!textsEqual) return false
  if ((a.recommendations ?? '') !== (b.recommendations ?? '')) return false
  return pathoTableEqual(a.pathophysiology_table, b.pathophysiology_table)
}

export default function AssessmentDocumentTab({ job, onJobUpdate }: Props) {
  const persisted = mergedAssessmentDocumentCapture(job.assessment_data)
  const [capture, setCapture] = useState<AssessmentDocumentCapture>(persisted)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [polishError, setPolishError] = useState<string | null>(null)
  const [polishingKey, setPolishingKey] = useState<TextFieldKey | null>(null)
  const [speakingKey, setSpeakingKey] = useState<TextFieldKey | null>(null)
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

  function setField(key: TextFieldKey, value: string) {
    setCapture(c => ({ ...c, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
    setPolishError(null)
    setSuggestError(null)
  }

  /** Recommendations stores TipTap HTML (rich text); set via the WYSIWYG editor. */
  function setRecommendations(html: string) {
    setCapture(c => ({ ...c, recommendations: html }))
    setSavedFlash(false)
    setSaveError(null)
    setSuggestError(null)
  }

  function setPathoRow(index: number, key: keyof PathophysiologyRow, value: string) {
    setCapture(c => {
      const rows = [...(c.pathophysiology_table ?? [])]
      const current = rows[index] ?? { disease: '' }
      rows[index] = { ...current, [key]: value }
      return { ...c, pathophysiology_table: rows }
    })
    setSavedFlash(false)
    setSaveError(null)
  }

  function removePathoRow(index: number) {
    setCapture(c => {
      const rows = [...(c.pathophysiology_table ?? [])]
      rows.splice(index, 1)
      return { ...c, pathophysiology_table: rows }
    })
    setSavedFlash(false)
    setSaveError(null)
  }

  function addPathoRow() {
    setCapture(c => {
      const rows = [...(c.pathophysiology_table ?? []), { disease: '' }]
      return { ...c, pathophysiology_table: rows }
    })
    setSavedFlash(false)
    setSaveError(null)
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
          return { ...prev, ...s, pathophysiology_table: s.pathophysiology_table ?? [] }
        }
        const next: AssessmentDocumentCapture = { ...prev }
        for (const { key } of FIELDS) {
          if (!(prev[key] ?? '').trim()) {
            next[key] = s[key] ?? ''
          }
        }
        // Recommendations is a rich-text field — treat the empty TipTap
        // shell "<p></p>" as empty for fill purposes.
        if (!proseHasPrintableContent(prev.recommendations ?? '')) {
          next.recommendations = s.recommendations ?? ''
        }
        // For the pathophysiology table, only populate when the current table
        // is empty — preserves any manual edits the staff have made.
        if (!(prev.pathophysiology_table ?? []).some(r => (r.disease || '').trim())) {
          next.pathophysiology_table = s.pathophysiology_table ?? []
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

  function handleListen(key: TextFieldKey) {
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

  async function handlePolish(key: TextFieldKey) {
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
        Assessment and Recommendations
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

      <div style={sectionLabelStyle}>Pathophysiology table</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4, marginBottom: 10 }}>
        Disease reference rows for the printed Assessment Document. Populate by uploading PDFs on
        Assessment → Pathogens, then running Suggest above. Rows are grounded only in your uploaded
        references — the AI will not invent diseases. Edit cells inline or remove rows you don&apos;t
        want in the printed table.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(capture.pathophysiology_table ?? []).length === 0 ? (
          <div
            style={{
              padding: '16px 14px',
              border: '1px dashed var(--border)',
              borderRadius: 10,
              fontSize: 13,
              color: 'var(--text-muted)',
            }}
          >
            No pathophysiology rows yet. Upload reference PDFs on Assessment → Pathogens, then run
            Suggest — or add a row manually.
          </div>
        ) : (
          (capture.pathophysiology_table ?? []).map((row, idx) => (
            <div
              key={idx}
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {PATHO_COLS.map(col => (
                  <label
                    key={col.key}
                    style={{
                      flex: `${col.flex} 1 180px`,
                      minWidth: 160,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                      {col.label}
                    </span>
                    <textarea
                      value={row[col.key] ?? ''}
                      onChange={e => setPathoRow(idx, col.key, e.target.value)}
                      placeholder={col.placeholder}
                      rows={col.rows}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-0)',
                        color: 'var(--text)',
                        fontSize: 13,
                        lineHeight: 1.4,
                        resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => removePathoRow(idx)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid rgba(248, 113, 113, 0.45)',
                    background: 'transparent',
                    color: '#FCA5A5',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Remove row
                </button>
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={addPathoRow}
          style={{ alignSelf: 'flex-start' }}
        >
          + Add row
        </button>
      </div>

      <div style={sectionLabelStyle}>Recommendations</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4, marginBottom: 10 }}>
        Next steps, staging, or follow-up assessment needs. Formatting (bold, lists,
        alignment, sizes) carries through to the printed Assessment Document.
      </p>
      <RichTextEditor
        value={capture.recommendations ?? ''}
        onChange={setRecommendations}
        minHeight={180}
      />

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
