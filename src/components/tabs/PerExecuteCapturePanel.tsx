/*
 * Execute-phase silos: recommendations, quality checks, waste/manifest notes.
 * Stored in assessment_data.per_execute_capture; feeds completion report assembly.
 * Same field chrome as Scope / Assessment document (Listen, Dictate, AI polish) + suggest API.
 */
'use client'

import { useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import type { AssessmentData, Job, PerExecuteCapture } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  emptyPerExecuteCapture,
  mergedPerExecuteCapture,
  perExecuteCaptureHasContent,
} from '@/lib/perExecuteCapture'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import CaptureFieldToolbar from '@/components/CaptureFieldToolbar'

const BUBBLE: CSSProperties = {
  width: '100%',
  minHeight: 88,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  lineHeight: 1.55,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
}

const FIELDS: { key: keyof PerExecuteCapture; label: string; placeholder: string }[] = [
  {
    key: 'recommendations',
    label: 'Recommendations',
    placeholder: 'Post-remediation recommendations for the client or follow-up…',
  },
  {
    key: 'quality_checks',
    label: 'Quality control checks',
    placeholder: 'Verification steps, clearance criteria, sign-offs…',
  },
  {
    key: 'waste_manifest_notes',
    label: 'Waste / disposal manifest notes',
    placeholder: 'What was removed, transport, facility, manifest references…',
  },
]

function captureEqual(a: PerExecuteCapture, b: PerExecuteCapture): boolean {
  return FIELDS.every(({ key }) => (a[key] ?? '') === (b[key] ?? ''))
}

export type PerExecuteEmphasis = 'all' | keyof PerExecuteCapture

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
  emphasis?: PerExecuteEmphasis
  /** When set with onCaptureChange, parent owns state (e.g. Completion Report tab + live preview). */
  capture?: PerExecuteCapture
  onCaptureChange?: Dispatch<SetStateAction<PerExecuteCapture>>
  /** Show suggest + merge controls (default true when emphasis is all). */
  showSuggest?: boolean
  /** When true, hide PER-only save (parent saves per_execute with completion report). */
  embeddedInCompletionReport?: boolean
}

export default function PerExecuteCapturePanel({
  job,
  onJobUpdate,
  emphasis = 'all',
  capture: controlledCapture,
  onCaptureChange,
  showSuggest: showSuggestProp,
  embeddedInCompletionReport = false,
}: Props) {
  const persisted = mergedPerExecuteCapture(job.assessment_data)
  const [internal, setInternal] = useState<PerExecuteCapture>(() => ({ ...persisted }))
  const controlled = controlledCapture !== undefined && typeof onCaptureChange === 'function'
  const capture = controlled ? controlledCapture! : internal
  const setCapture = controlled ? onCaptureChange! : setInternal

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestMergeMode, setSuggestMergeMode] = useState<'fill_empty' | 'replace_all'>('fill_empty')

  const isDirty = !captureEqual(capture, persisted)
  useRegisterUnsavedChanges(
    `per-execute-capture-${emphasis}`,
    embeddedInCompletionReport ? false : isDirty,
  )

  useEffect(() => {
    if (controlled) return
    setInternal({ ...mergedPerExecuteCapture(job.assessment_data) })
  }, [job.id, controlled])

  function setField(key: keyof PerExecuteCapture, value: string) {
    setCapture((c: PerExecuteCapture) => ({ ...c, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
    setSuggestError(null)
  }

  async function handleSuggestFromExecute() {
    setSuggesting(true)
    setSuggestError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-per-execute-capture`, { method: 'POST' })
      const data = (await res.json()) as { suggestions?: PerExecuteCapture; error?: string }
      if (!res.ok) throw new Error(data.error || 'Suggest failed')
      const s = data.suggestions
      if (!s) throw new Error('No suggestions returned')
      setCapture((prev: PerExecuteCapture) => {
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
    setSaveError(null)
    try {
      const base = mergeAssessmentData(job.assessment_data)
      const merged: AssessmentData = {
        ...base,
        per_execute_capture: { ...emptyPerExecuteCapture(), ...capture },
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.job) onJobUpdate(data.job)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const orderedKeys: (keyof PerExecuteCapture)[] =
    emphasis === 'all'
      ? ['recommendations', 'quality_checks', 'waste_manifest_notes']
      : [
          emphasis,
          ...(['recommendations', 'quality_checks', 'waste_manifest_notes'] as const).filter(k => k !== emphasis),
        ]

  const showSuggest = showSuggestProp ?? emphasis === 'all'

  const intro =
    emphasis === 'all' ? (
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
        Execute-phase narrative. This feeds the completion report when report fields are left blank (together with progress
        photos and notes).
      </p>
    ) : (
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
        This silo is part of the completion report data path. Related fields are below; all save together.
      </p>
    )

  return (
    <div style={{ marginBottom: 24 }}>
      {intro}

      {showSuggest && (
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
            onClick={() => void handleSuggestFromExecute()}
            style={{ alignSelf: 'flex-start', padding: '12px 18px', fontSize: 14 }}
          >
            {suggesting ? (
              <>
                <span className="spinner" /> Suggesting…
              </>
            ) : (
              'Suggest from job & progress'
            )}
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Drafts recommendations, QC notes, and waste notes from progress data and Scope of Work (Claude). Review before
            saving.
          </p>
          {suggestError && (
            <p style={{ fontSize: 13, color: '#F87171', margin: 0 }} role="alert">
              {suggestError}
            </p>
          )}
        </div>
      )}

      {orderedKeys.map(key => {
        const meta = FIELDS.find(f => f.key === key)!
        return (
          <div key={key} style={{ marginBottom: emphasis !== 'all' && key !== emphasis ? 12 : 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
              {meta.label}
            </label>
            <textarea
              value={capture[key]}
              onChange={e => setField(key, e.target.value)}
              placeholder={meta.placeholder}
              style={{
                ...BUBBLE,
                minHeight: emphasis !== 'all' && key === emphasis ? 140 : BUBBLE.minHeight,
              }}
              aria-label={meta.label}
            />
            <CaptureFieldToolbar
              jobId={job.id}
              text={capture[key]}
              onTextChange={v => setField(key, v)}
            />
          </div>
        )
      })}

      {saveError && <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12 }}>{saveError}</div>}

      {!embeddedInCompletionReport && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void save()}
          disabled={saving || !isDirty}
          style={{ width: '100%', padding: 12, fontSize: 14 }}
        >
          {saving ? 'Saving…' : savedFlash ? '✓ Saved PER silos' : 'Save execute-phase silos'}
        </button>
      )}

      {embeddedInCompletionReport && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Execute-phase silos save together with <strong style={{ color: 'var(--text)' }}>Save completion report</strong>{' '}
          below.
        </p>
      )}

      {!perExecuteCaptureHasContent(capture) && emphasis === 'all' && !embeddedInCompletionReport && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          Optional; leave blank if you only use the completion report text fields below.
        </p>
      )}
    </div>
  )
}
