/*
 * Execute → Completion Report — field capture in assessment_data.completion_report_capture;
 * feeds composeReport() and /docs/report?compose=1.
 */
'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { AssessmentData, CompletionReportCapture, Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  emptyCompletionReportCapture,
  mergedCompletionReportCapture,
  completionReportCaptureHasContent,
} from '@/lib/completionReportCapture'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'

interface Props {
  job: Job
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

export default function CompletionReportTab({ job, onJobUpdate }: Props) {
  const persisted = mergedCompletionReportCapture(job.assessment_data)
  const [capture, setCapture] = useState<CompletionReportCapture>(() => ({ ...persisted }))

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = !captureEqual(capture, persisted)
  useRegisterUnsavedChanges('completion-report-capture', isDirty)

  useEffect(() => {
    setCapture({ ...mergedCompletionReportCapture(job.assessment_data) })
  }, [job.id])

  function setField(key: keyof CompletionReportCapture, value: string) {
    setCapture(c => ({ ...c, [key]: value }))
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

  const hasAny = completionReportCaptureHasContent(capture)

  return (
    <div style={{ maxWidth: 720, paddingBottom: 32 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Capture completion narrative here. This data feeds the{' '}
        <strong style={{ color: 'var(--text)' }}>Completion Report</strong> document when you open or compose the report.
        Use <strong style={{ color: 'var(--text)' }}>Home → Generate documents</strong> for COD / waste manifest; completion report is created from this page.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
        <Link href={`/jobs/${job.id}/docs/report?compose=1`}>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>
            Open Completion Report preview
          </button>
        </Link>
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
          />
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
        {saving ? 'Saving…' : savedFlash ? '✓ Saved' : 'Save completion report'}
      </button>

      {!hasAny && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>
          All fields optional; empty sections show as em dashes in the composed document until you add text.
        </p>
      )}
    </div>
  )
}
