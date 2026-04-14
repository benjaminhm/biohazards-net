/*
 * Execute → Completion Report — field capture in assessment_data.completion_report_capture;
 * merged with PER + SOW assembly in composeReport() and /docs/report?compose=1.
 */
'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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
import { composeDocumentContent, buildComposedPreviewHtml } from '@/lib/composeDocument'
import type { CompanyProfile } from '@/lib/types'

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

const FIELDS: { key: keyof CompletionReportCapture; label: string; placeholder: string }[] = [
  { key: 'executive_summary', label: 'Executive summary', placeholder: 'High-level outcome and context after works…' },
  { key: 'site_conditions', label: 'Site conditions on arrival', placeholder: 'Condition as found, access, notable constraints…' },
  { key: 'works_carried_out', label: 'Works carried out', placeholder: 'What was done, by area or sequence…' },
  { key: 'methodology', label: 'Methodology', placeholder: 'Approach, containment, verification steps…' },
  { key: 'products_used', label: 'Products & equipment', placeholder: 'Chemicals, equipment, PPE relevant to completion…' },
  { key: 'waste_disposal', label: 'Waste disposal', placeholder: 'What was removed, manifests, disposal path…' },
  { key: 'photo_record', label: 'Photo record', placeholder: 'Reference progress photos / key evidence (during/after)…' },
  { key: 'outcome', label: 'Outcome', placeholder: 'Clear statement of completion or residual items…' },
  { key: 'technician_signoff', label: 'Technician sign-off', placeholder: 'Name / role / date as needed…' },
]

function captureEqual(a: CompletionReportCapture, b: CompletionReportCapture): boolean {
  return FIELDS.every(({ key }) => (a[key] ?? '') === (b[key] ?? ''))
}

export default function CompletionReportTab({ job, photos, onJobUpdate }: Props) {
  const persisted = mergedCompletionReportCapture(job.assessment_data)
  const perPersisted = mergedPerExecuteCapture(job.assessment_data)
  const [capture, setCapture] = useState<CompletionReportCapture>(() => ({ ...persisted }))
  const [perExecute, setPerExecute] = useState<PerExecuteCapture>(() => ({ ...perPersisted }))

  const [progressNotes, setProgressNotes] = useState<ProgressNote[]>([])
  const [progressRoomNotes, setProgressRoomNotes] = useState<ProgressRoomNote[]>([])
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [composedPreviewHtml, setComposedPreviewHtml] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(true)

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty =
    !captureEqual(capture, persisted) || !perExecuteCaptureEqual(perExecute, mergedPerExecuteCapture(job.assessment_data))
  useRegisterUnsavedChanges('completion-report-capture', isDirty)

  const previewJob = useMemo((): Job => {
    const ad = mergeAssessmentData(job.assessment_data)
    return {
      ...job,
      assessment_data: {
        ...ad,
        completion_report_capture: { ...emptyCompletionReportCapture(), ...capture },
        per_execute_capture: { ...emptyPerExecuteCapture(), ...perExecute },
      },
    }
  }, [job, capture, perExecute])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [pnRes, prnRes, coRes] = await Promise.all([
          fetch(`/api/jobs/${job.id}/progress-notes`).then(r => r.json()),
          fetch(`/api/jobs/${job.id}/progress-room-notes`).then(r => r.json()),
          fetch('/api/company').then(r => r.json()),
        ])
        if (!cancelled) {
          setProgressNotes((pnRes.notes ?? []) as ProgressNote[])
          setProgressRoomNotes((prnRes.notes ?? []) as ProgressRoomNote[])
          setCompany(coRes.company ?? null)
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const origin = window.location.origin
    const { content: composed } = composeDocumentContent('report', previewJob, {
      report: {
        photos,
        progressNotes,
        progressRoomNotes,
      },
    })
    setComposedPreviewHtml(
      buildComposedPreviewHtml(
        'report',
        composed as Record<string, unknown>,
        photos,
        previewJob.assessment_data?.areas ?? [],
        company,
        previewJob.id,
        origin,
        {
          client_name: previewJob.client_name,
          client_email: previewJob.client_email,
          client_phone: previewJob.client_phone,
        },
      ),
    )
  }, [previewJob, photos, progressNotes, progressRoomNotes, company])

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
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        The completion report is composed deterministically from execute-phase sources (progress photos, notes, PER silos)
        plus planned Scope of Work for the executive summary. Use the live preview below — no Claude required for
        routine use. Optional full-page tools are linked at the bottom.
      </p>

      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setPreviewOpen(o => !o)}
          className="btn btn-secondary"
          style={{ fontSize: 13, marginBottom: 10 }}
          aria-expanded={previewOpen}
        >
          {previewOpen ? '▾' : '▸'} Live composed preview (deterministic)
        </button>
        {previewOpen && composedPreviewHtml && (
          <div
            style={{
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid var(--border)',
              background: '#fff',
              minHeight: 320,
            }}
          >
            <iframe
              title="Completion report composed preview"
              srcDoc={composedPreviewHtml}
              style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
              sandbox="allow-scripts allow-same-origin allow-modals"
            />
          </div>
        )}
        {previewOpen && !composedPreviewHtml && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16 }}>Loading preview…</div>
        )}
      </div>

      <PerExecuteCapturePanel
        job={job}
        onJobUpdate={onJobUpdate}
        emphasis="all"
        capture={perExecute}
        onCaptureChange={setPerExecute}
        embeddedInCompletionReport
      />

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

      <div style={{ marginBottom: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={fillEmptyFieldsFromSources} style={{ fontSize: 13 }}>
          Fill empty report fields from PER + SOW
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
          Only fills sections that are blank; does not overwrite text you already entered.
        </p>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 10 }}>
        Completion report text (optional overrides)
      </div>

      {FIELDS.map(({ key, label, placeholder }) => (
        <div key={key} style={{ marginBottom: 16 }}>
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
        completion reporting uses the live preview above; Build is not required.
      </p>
      <Link href={`/jobs/${job.id}/docs/report?compose=1`}>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>
          Open full-page composer (compose only)
        </button>
      </Link>
    </div>
  )
}
