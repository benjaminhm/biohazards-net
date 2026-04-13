/*
 * Scope of Work capture — staff-authored fields (sow_capture) with Suggest from assessment,
 * Listen, AI polish, single Save; feeds build-document JOB CONTEXT.
 */
'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { Job, AssessmentData, SowCapture, Document } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { mergedSowCapture } from '@/lib/sowCapture'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'

interface Props {
  job: Job
  documents: Document[]
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

const FIELDS: { key: keyof SowCapture; label: string; placeholder: string }[] = [
  { key: 'objective', label: 'Objective', placeholder: 'The single outcome this remediation is meant to achieve…' },
  { key: 'scope_work', label: 'Scope / work narrative', placeholder: 'What will be done, where, and to what standard…' },
  { key: 'methodology', label: 'Methodology', placeholder: 'How you will approach the work (containment, sequence, verification)…' },
  { key: 'timeline', label: 'Timeline', placeholder: 'Duration, milestones, access windows…' },
  { key: 'safety', label: 'Safety & PPE', placeholder: 'PPE, containment, site safety (can reference Assessment flags)…' },
  { key: 'waste', label: 'Waste', placeholder: 'Packaging, transport, disposal expectations…' },
  { key: 'exclusions', label: 'Exclusions', placeholder: 'What is explicitly not included in this scope…' },
  { key: 'caveats', label: 'Caveats / disclaimer', placeholder: 'Assumptions, limits, subject-to conditions…' },
]

function captureEqual(a: SowCapture, b: SowCapture): boolean {
  return FIELDS.every(({ key }) => (a[key] ?? '') === (b[key] ?? ''))
}

export default function ScopeOfWorkTab({ job, documents, onJobUpdate }: Props) {
  const persisted = mergedSowCapture(job.assessment_data)
  const [capture, setCapture] = useState<SowCapture>(persisted)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [polishError, setPolishError] = useState<string | null>(null)
  const [polishingKey, setPolishingKey] = useState<keyof SowCapture | null>(null)
  const [speakingKey, setSpeakingKey] = useState<keyof SowCapture | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestMergeMode, setSuggestMergeMode] = useState<'fill_empty' | 'replace_all'>('fill_empty')

  const isDirty = !captureEqual(capture, persisted)
  useRegisterUnsavedChanges('sow-capture', isDirty)

  useEffect(() => {
    setCapture(mergedSowCapture(job.assessment_data))
  }, [job.id])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  function setField(key: keyof SowCapture, value: string) {
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
      const res = await fetch(`/api/jobs/${job.id}/suggest-sow-capture`, { method: 'POST' })
      const data = await res.json() as { suggestions?: SowCapture; error?: string }
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
        sow_capture: capture,
        sow_objective: capture.objective,
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

  function handleListen(key: keyof SowCapture) {
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

  async function handlePolish(key: keyof SowCapture) {
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

  const existingSow = documents.find(d => d.type === 'sow')

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
        Scope of Work
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Objective first, then roadmap (scope, methodology, timeline), then boundaries (exclusions, caveats).
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
          Uses Presentation, photos, and Hazards/Risks chips. Review and edit before saving.
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
          'Save scope of work'
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

      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          marginBottom: 12,
          marginTop: 32,
        }}
      >
        Scope of Work document
      </div>

      {existingSow ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Scope of Work</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Created{' '}
              {new Date(existingSow.created_at).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
          <Link href={`/jobs/${job.id}/docs/sow?docId=${existingSow.id}`}>
            <button className="btn btn-secondary" style={{ fontSize: 13 }} type="button">
              Edit →
            </button>
          </Link>
        </div>
      ) : (
        <Link href={`/jobs/${job.id}/docs/sow`}>
          <button className="btn btn-secondary" style={{ width: '100%', padding: 14, fontSize: 14 }} type="button">
            ＋ Generate Scope of Work with Claude
          </button>
        </Link>
      )}
    </div>
  )
}
