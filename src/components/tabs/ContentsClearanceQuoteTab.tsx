'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  CONTENTS_CLEARANCE_SCHEMA,
  contentsClearanceFigures,
  emptyContentsClearanceCapture,
  normalizeContentsClearanceCapture,
  type ContentsClearanceCapture,
} from '@/lib/contentsClearanceQuote'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
}

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  color: 'var(--text-muted)',
}

export default function ContentsClearanceQuoteTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeContentsClearanceCapture(job.assessment_data?.contents_clearance_quote ?? emptyContentsClearanceCapture()),
    [job.assessment_data?.contents_clearance_quote],
  )
  const [capture, setCapture] = useState<ContentsClearanceCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setCapture(normalizeContentsClearanceCapture(job.assessment_data?.contents_clearance_quote))
  }, [job.id, job.updated_at])

  const isDirty = capture.estimated_m3 !== saved.estimated_m3 || capture.estimated_km !== saved.estimated_km
  useRegisterUnsavedChanges('contents-clearance-quote', isDirty)

  const figures = useMemo(
    () => contentsClearanceFigures(capture.estimated_m3, capture.estimated_km),
    [capture.estimated_m3, capture.estimated_km],
  )

  function patch(next: Partial<ContentsClearanceCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
  }

  async function save(next = capture): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_data: { ...merged, contents_clearance_quote: next },
        }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      onJobUpdate(data.job)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveAndCompose() {
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/contents_clearance_quote?compose=1`)
  }

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
        Contents Clearance Quote
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={LABEL}>Client</div>
          <div style={{ fontSize: 14 }}>{job.client_name || '—'}</div>
        </div>
        <div>
          <div style={LABEL}>Address</div>
          <div style={{ fontSize: 14 }}>{job.site_address || '—'}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={LABEL}>Estimated cubic metres</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.estimated_m3 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ estimated_m3: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {formatAud(CONTENTS_CLEARANCE_SCHEMA.ratePerM3)} per m³. {CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay} m³ is one labour day.
          </div>
        </div>
        <div>
          <label style={LABEL}>Estimated kilometres</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.estimated_km ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ estimated_km: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {formatAud(CONTENTS_CLEARANCE_SCHEMA.ratePerKm)} per km. Labour is {formatAud(CONTENTS_CLEARANCE_SCHEMA.ratePerLabourDay)} per day.
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 6, fontSize: 14 }}>
        {figures.lines.map(line => (
          <div key={line.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{line.label} · {line.quantity.toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}</span>
            <span>{formatAud(line.amount)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800, marginTop: 4 }}>
          <span>Total inc GST</span>
          <span>{formatAud(figures.total)}</span>
        </div>
      </div>
      {saveError && <div style={{ color: 'var(--danger, #f87171)', fontSize: 13, marginTop: 10 }}>{saveError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void saveAndCompose()} disabled={saving}>
          Generate quote
        </button>
      </div>
    </div>
  )
}
