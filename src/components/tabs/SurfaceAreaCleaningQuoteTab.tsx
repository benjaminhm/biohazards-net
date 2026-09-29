'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import RichTextEditor from '@/components/RichTextEditor'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  SURFACE_AREA_CLIENT_TITLES,
  SURFACE_AREA_SCHEMA,
  defaultSurfaceAreaCleaningStandards,
  emptySurfaceAreaCleaningCapture,
  normalizeSurfaceAreaCleaningCapture,
  normalizeSurfaceAreaCleaningStandards,
  surfaceAreaClauseLines,
  surfaceAreaCleaningFigures,
  type SurfaceAreaCleaningCapture,
  type SurfaceAreaCleaningStandards,
} from '@/lib/surfaceAreaCleaningQuote'

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

function ClickToEditText({
  label,
  value,
  onChange,
  asList,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  asList?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const items = surfaceAreaClauseLines(value)
  return (
    <div>
      <div style={LABEL}>{label}</div>
      {editing ? (
        <textarea
          autoFocus
          value={value}
          rows={asList ? Math.max(4, items.length + 1) : 4}
          onChange={e => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          placeholder={asList ? 'One item per line' : ''}
          style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '8px 10px',
            color: 'var(--text)',
            cursor: 'text',
            font: 'inherit',
          }}
        >
          {asList && items.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: 'grid', gap: 4 }}>
              {items.map(item => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <span style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{value.trim() || 'Click to edit'}</span>
          )}
        </button>
      )}
    </div>
  )
}

export default function SurfaceAreaCleaningQuoteTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeSurfaceAreaCleaningCapture(job.assessment_data?.surface_area_cleaning_quote ?? emptySurfaceAreaCleaningCapture()),
    [job.assessment_data?.surface_area_cleaning_quote],
  )
  const [capture, setCapture] = useState<SurfaceAreaCleaningCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [standards, setStandards] = useState<SurfaceAreaCleaningStandards>(defaultSurfaceAreaCleaningStandards)
  const [standardsReady, setStandardsReady] = useState(false)
  const skipStandardsSave = useRef(true)

  useEffect(() => {
    setCapture(normalizeSurfaceAreaCleaningCapture(job.assessment_data?.surface_area_cleaning_quote))
  }, [job.id, job.updated_at])

  const isDirty = capture.cleaning_kind !== saved.cleaning_kind
    || capture.estimated_m2 !== saved.estimated_m2
    || capture.labour_days !== saved.labour_days
    || capture.rate_per_m2 !== saved.rate_per_m2
    || capture.rate_per_labour_day !== saved.rate_per_labour_day
    || capture.job_address !== saved.job_address
    || capture.mobilisation_fee !== saved.mobilisation_fee
  useRegisterUnsavedChanges('surface-area-cleaning-quote', isDirty)

  const figures = useMemo(
    () => surfaceAreaCleaningFigures(capture.estimated_m2, {
      ratePerM2: capture.rate_per_m2 ?? SURFACE_AREA_SCHEMA.ratePerM2,
      ratePerLabourDay: capture.rate_per_labour_day ?? SURFACE_AREA_SCHEMA.ratePerLabourDay,
    }, {
      labourDays: capture.labour_days,
      mobilisationFee: capture.mobilisation_fee,
    }),
    [capture],
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/company')
      .then(r => r.json())
      .then((data: { company?: { surface_area_cleaning_standards?: unknown } }) => {
        if (cancelled) return
        skipStandardsSave.current = true
        setStandards(normalizeSurfaceAreaCleaningStandards(data.company?.surface_area_cleaning_standards))
        setStandardsReady(true)
      })
      .catch(() => {
        if (!cancelled) setStandardsReady(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!standardsReady) return
    if (skipStandardsSave.current) {
      skipStandardsSave.current = false
      return
    }
    const timer = window.setTimeout(() => { void persistStandards(standards) }, 500)
    return () => window.clearTimeout(timer)
  }, [standards, standardsReady])

  async function persistStandards(next: SurfaceAreaCleaningStandards) {
    const res = await fetch('/api/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface_area_cleaning_standards: next }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setSaveError(data.error || 'The clauses could not be saved for future jobs.')
    }
  }

  function editStandards(next: Partial<SurfaceAreaCleaningStandards>) {
    setStandards(prev => ({ ...prev, ...next }))
  }

  function patch(next: Partial<SurfaceAreaCleaningCapture>) {
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
          assessment_data: { ...merged, surface_area_cleaning_quote: next },
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
    if (!(capture.labour_days != null && capture.labour_days > 0)) {
      setSaveError('Enter the labour days before generating the quote.')
      return
    }
    await persistStandards(standards)
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/surface_area_cleaning_quote?compose=1`)
  }

  const labourLine = figures.lines.find(line => line.label === 'Labour')

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
        Surface Area Cleaning Quote
      </div>
      <div style={{ marginBottom: 12, maxWidth: 360 }}>
        <label style={LABEL}>For the client, this is</label>
        <select
          value={capture.cleaning_kind}
          onChange={e => patch({ cleaning_kind: e.target.value as SurfaceAreaCleaningCapture['cleaning_kind'] })}
          style={INPUT}
        >
          {SURFACE_AREA_CLIENT_TITLES.map(option => (
            <option key={option.id} value={option.id}>{option.title}</option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 14, marginBottom: 12 }}>
        <div style={LABEL}>Client</div>
        <div>{job.client_name || '—'}</div>
      </div>
      <div style={{ marginBottom: 12, maxWidth: 360 }}>
        <label style={LABEL}>Mobilisation fee ($)</label>
        <input
          type="number"
          min={0}
          step="0.01"
          value={capture.mobilisation_fee ?? ''}
          onChange={e => {
            const raw = e.target.value
            patch({ mobilisation_fee: raw === '' ? null : Number(raw) })
          }}
          placeholder="0.00"
          style={INPUT}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Attendance and setup, ex GST. It is added to the quote when the amount is more than zero.
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL}>Job address</label>
        <input
          value={capture.job_address ?? job.site_address ?? ''}
          onChange={e => patch({ job_address: e.target.value })}
          style={INPUT}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Estimated square metres</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.estimated_m2 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ estimated_m2: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Labour days</label>
          <input
            type="number"
            min={1}
            step={1}
            value={capture.labour_days ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ labour_days: raw === '' ? null : Number(raw) })
            }}
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {figures.labour_days > 0
              ? `${figures.labour_days.toLocaleString('en-AU', { maximumFractionDigits: 0 })} labour ${figures.labour_days === 1 ? 'day' : 'days'} × ${formatAud(figures.rate_per_labour_day)} = ${formatAud(labourLine?.amount ?? 0)}`
              : 'Required before the quote can be generated.'}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={LABEL}>Rate per m² ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_m2 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_m2: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Rate per person per day ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_labour_day ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_labour_day: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 6, fontSize: 14 }}>
        {figures.lines.map(line => (
          <div key={line.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{line.label} · {line.quantity.toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}</span>
            <span>{formatAud(line.amount)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>Subtotal (ex GST)</span>
          <span>{formatAud(figures.subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>GST (10%)</span>
          <span>{formatAud(figures.gst)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800, marginTop: 4 }}>
          <span>Total (inc GST)</span>
          <span>{formatAud(figures.total)}</span>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
        <ClickToEditText label="Inclusions" asList value={standards.inclusions} onChange={inclusions => editStandards({ inclusions })} />
        <ClickToEditText label="Exclusions" asList value={standards.exclusions} onChange={exclusions => editStandards({ exclusions })} />
        <ClickToEditText label="Assumptions" asList value={standards.assumptions} onChange={assumptions => editStandards({ assumptions })} />
        <ClickToEditText label="Payment terms" value={standards.payment_terms} onChange={payment_terms => editStandards({ payment_terms })} />
        <div>
          <div style={LABEL}>Engagement agreement</div>
          {standardsReady && (
            <RichTextEditor
              value={standards.engagement_agreement}
              onChange={engagement_agreement => editStandards({ engagement_agreement })}
              minHeight={240}
            />
          )}
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
