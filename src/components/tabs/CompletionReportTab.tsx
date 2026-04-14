/*
 * Execute → Completion Report — field capture in assessment_data.completion_report_capture;
 * merged with PER + SOW assembly in composeReport() and /docs/report?compose=1.
 */
'use client'

import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type {
  AssessmentData,
  CompletionReportCapture,
  Job,
  PerExecuteCapture,
  Photo,
  ProgressNote,
  ProgressRoomNote,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  emptyCompletionReportCapture,
  mergedCompletionReportCapture,
  completionReportCaptureHasContent,
} from '@/lib/completionReportCapture'
import {
  emptyPerExecuteCapture,
  mergedPerExecuteCapture,
  perExecuteCaptureEqual,
} from '@/lib/perExecuteCapture'
import {
  assembleCompletionReportFromSources,
  formatSowPlannedSummary,
  isProgressEvidencePhoto,
  mergeStaffCompletionWithAssembly,
} from '@/lib/perCompletionAssembly'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import PerExecuteCapturePanel from '@/components/tabs/PerExecuteCapturePanel'
import CaptureFieldToolbar from '@/components/CaptureFieldToolbar'

interface Props {
  job: Job
  photos: Photo[]
  onJobUpdate: (job: Job) => void
}

const BUBBLE: CSSProperties = {
  width: '100%',
  minHeight: 100,
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

/** Chronological narrative order on this tab (keys match composed report sections). */
const NARRATIVE_FIELDS: { key: keyof CompletionReportCapture; label: string; placeholder: string }[] = [
  {
    key: 'site_conditions',
    label: 'Site & context (on arrival)',
    placeholder: 'Condition as found, access, what was presented on arrival…',
  },
  {
    key: 'executive_summary',
    label: 'Overview',
    placeholder: 'Client, job context, and how this report is structured…',
  },
  {
    key: 'methodology',
    label: 'Planned approach & method',
    placeholder: 'How the work was intended to be carried out…',
  },
  {
    key: 'works_carried_out',
    label: 'Works performed',
    placeholder: 'What was done, by area or sequence…',
  },
  {
    key: 'products_used',
    label: 'Products & equipment used',
    placeholder: 'Chemicals, equipment, PPE as used on site…',
  },
  {
    key: 'outcome',
    label: 'Outcome & limitations',
    placeholder: 'Completion statement, residuals, exclusions or items not in scope…',
  },
  {
    key: 'waste_disposal',
    label: 'Waste & disposal',
    placeholder: 'What was removed, manifests, disposal path…',
  },
  {
    key: 'photo_record',
    label: 'Evidence (photos & records)',
    placeholder: 'Reference progress photos and key documentary evidence…',
  },
  {
    key: 'technician_signoff',
    label: 'Technician sign-off',
    placeholder: 'Name / role / date as needed…',
  },
]

function captureEqual(a: CompletionReportCapture, b: CompletionReportCapture): boolean {
  return NARRATIVE_FIELDS.every(({ key }) => (a[key] ?? '') === (b[key] ?? ''))
}

export default function CompletionReportTab({ job, photos, onJobUpdate }: Props) {
  const persisted = mergedCompletionReportCapture(job.assessment_data)
  const perPersisted = mergedPerExecuteCapture(job.assessment_data)
  const [capture, setCapture] = useState<CompletionReportCapture>(() => ({ ...persisted }))
  const [perExecute, setPerExecute] = useState<PerExecuteCapture>(() => ({ ...perPersisted }))

  const [progressNotes, setProgressNotes] = useState<ProgressNote[]>([])
  const [progressRoomNotes, setProgressRoomNotes] = useState<ProgressRoomNote[]>([])

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [suggestAllBusy, setSuggestAllBusy] = useState(false)
  const [suggestAllError, setSuggestAllError] = useState<string | null>(null)
  const [suggestAllMergeMode, setSuggestAllMergeMode] = useState<'fill_empty' | 'replace_all'>('fill_empty')

  const isDirty =
    !captureEqual(capture, persisted) || !perExecuteCaptureEqual(perExecute, mergedPerExecuteCapture(job.assessment_data))
  useRegisterUnsavedChanges('completion-report-capture', isDirty)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [pnRes, prnRes] = await Promise.all([
          fetch(`/api/jobs/${job.id}/progress-notes`).then(r => r.json()),
          fetch(`/api/jobs/${job.id}/progress-room-notes`).then(r => r.json()),
        ])
        if (!cancelled) {
          setProgressNotes((pnRes.notes ?? []) as ProgressNote[])
          setProgressRoomNotes((prnRes.notes ?? []) as ProgressRoomNote[])
        }
      } catch {
        if (!cancelled) {
          setProgressNotes([])
          setProgressRoomNotes([])
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [job.id])

  useEffect(() => {
    setCapture({ ...mergedCompletionReportCapture(job.assessment_data) })
    setPerExecute(mergedPerExecuteCapture(job.assessment_data))
  }, [job.id])

  function setField(key: keyof CompletionReportCapture, value: string) {
    setCapture(c => ({ ...c, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
  }

  function fillEmptyFieldsFromSources() {
    const assembled = assembleCompletionReportFromSources(job, {
      photos,
      progressNotes,
      progressRoomNotes,
    })
    setCapture(prev => mergeStaffCompletionWithAssembly(prev, assembled))
    setSavedFlash(false)
    setSaveError(null)
  }

  async function suggestAllFromJob() {
    setSuggestAllBusy(true)
    setSuggestAllError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-completion-report-capture`, { method: 'POST' })
      const data = (await res.json()) as {
        completion_report_capture?: CompletionReportCapture
        per_execute_capture?: PerExecuteCapture
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Suggest failed')
      const cr = data.completion_report_capture
      const pe = data.per_execute_capture
      if (!cr || !pe) throw new Error('Incomplete response from server')

      if (suggestAllMergeMode === 'replace_all') {
        setCapture({ ...emptyCompletionReportCapture(), ...cr })
        setPerExecute({ ...emptyPerExecuteCapture(), ...pe })
      } else {
        setCapture(prev => {
          const next = { ...prev }
          ;(Object.keys(cr) as (keyof CompletionReportCapture)[]).forEach(k => {
            if (!(String(prev[k] ?? '').trim())) {
              next[k] = cr[k] ?? ''
            }
          })
          return next
        })
        setPerExecute(prev => {
          const next = { ...prev }
          const pk: (keyof PerExecuteCapture)[] = ['recommendations', 'quality_checks', 'waste_manifest_notes']
          for (const k of pk) {
            if (!(String(prev[k] ?? '').trim())) {
              next[k] = pe[k] ?? ''
            }
          }
          return next
        })
      }
      setSavedFlash(false)
    } catch (e) {
      setSuggestAllError(e instanceof Error ? e.message : 'Suggest failed')
    } finally {
      setSuggestAllBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const base = mergeAssessmentData(job.assessment_data)
      const merged: AssessmentData = {
        ...base,
        completion_report_capture: { ...emptyCompletionReportCapture(), ...capture },
        per_execute_capture: { ...emptyPerExecuteCapture(), ...perExecute },
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.job) {
        onJobUpdate(data.job)
        setCapture({ ...mergedCompletionReportCapture(data.job.assessment_data) })
        setPerExecute(mergedPerExecuteCapture(data.job.assessment_data))
      }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const hasAny = completionReportCaptureHasContent(capture)
  const progressPhotoCount = photos.filter(isProgressEvidencePhoto).length
  const sowPreview = formatSowPlannedSummary(job.assessment_data)
  const activeNoteCount = progressNotes.filter(n => !n.deleted_at && !n.archived_at).length

  return (
    <div style={{ maxWidth: 720, paddingBottom: 32 }}>
      <div
        style={{
          marginBottom: 22,
          padding: '16px 18px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 10, letterSpacing: '0.04em' }}>
          Suggest content (Claude)
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 14px' }}>
          Drafts all completion report fields and PER silos from Scope of Work, progress notes, room notes, and photo
          metadata. Review and edit before saving. Does not persist until you save below.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Merge:</span>
            <select
              value={suggestAllMergeMode}
              onChange={e => setSuggestAllMergeMode(e.target.value as 'fill_empty' | 'replace_all')}
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
          disabled={suggestAllBusy}
          onClick={() => void suggestAllFromJob()}
          style={{ padding: '12px 18px', fontSize: 14 }}
        >
          {suggestAllBusy ? (
            <>
              <span className="spinner" /> Suggesting…
            </>
          ) : (
            'Suggest content'
          )}
        </button>
        {suggestAllError && (
          <p style={{ fontSize: 13, color: '#F87171', margin: '10px 0 0' }} role="alert">
            {suggestAllError}
          </p>
        )}
      </div>

      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Read top to bottom: planned scope, then site context, method, works performed, outcome, follow-up and evidence.
        Blank sections can still be filled automatically from Scope of Work, PER silos, and progress photos/notes. No Claude
        required for routine use. Open the full-page composer below for a print-style preview or to save to the document
        library.
      </p>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
          Planned scope (SOW) — executive summary
        </div>
        <pre
          style={{
            ...BUBBLE,
            minHeight: 72,
            whiteSpace: 'pre-wrap',
            margin: 0,
            fontSize: 13,
          }}
        >
          {sowPreview.trim() || '— No Scope of Work capture yet; add it under Assessment → Scope of Work.'}
        </pre>
      </div>

      <div
        style={{
          marginBottom: 18,
          padding: '12px 14px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-elevated, var(--surface))',
          fontSize: 13,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Sources in use for assembly</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Progress evidence photos: {progressPhotoCount}</li>
          <li>Progress notes: {activeNoteCount}</li>
          <li>Progress room notes: {progressRoomNotes.length}</li>
        </ul>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={fillEmptyFieldsFromSources} style={{ fontSize: 13 }}>
          Fill empty report fields from PER + SOW
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
          Only fills sections that are blank; does not overwrite text you already entered.
        </p>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 10 }}>
        Report narrative (optional overrides)
      </div>

      {NARRATIVE_FIELDS.map(({ key, label, placeholder }) => (
        <Fragment key={key}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
              {label}
            </label>
            <textarea
              value={capture[key]}
              onChange={e => setField(key, e.target.value)}
              placeholder={placeholder}
              style={BUBBLE}
              aria-label={label}
            />
            <CaptureFieldToolbar jobId={job.id} text={capture[key]} onTextChange={v => setField(key, v)} />
          </div>
          {key === 'outcome' && (
            <>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  marginBottom: 10,
                  marginTop: 4,
                }}
              >
                Follow-up & evidence (PER silos)
              </div>
              <PerExecuteCapturePanel
                job={job}
                onJobUpdate={onJobUpdate}
                emphasis="all"
                capture={perExecute}
                onCaptureChange={setPerExecute}
                embeddedInCompletionReport
                omitIntro
                showSuggest={false}
              />
            </>
          )}
        </Fragment>
      ))}

      {saveError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12 }}>{saveError}</div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={saving || !isDirty}
        style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 8 }}
      >
        {saving ? 'Saving…' : savedFlash ? '✓ Saved' : 'Save completion report & execute silos'}
      </button>

      {!hasAny && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>
          All fields optional; empty sections show as em dashes in the composed document until you add text.
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
          marginTop: 28,
        }}
      >
        Full-page composer (optional)
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
        Open the document workspace for save-to-library, print, or an optional ✨ Build (Claude full-document pass). Routine
        completion reporting uses the fields on this tab; Build is not required.
      </p>
      <Link href={`/jobs/${job.id}/docs/report?compose=1`}>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>
          Open full-page composer (compose only)
        </button>
      </Link>
    </div>
  )
}
