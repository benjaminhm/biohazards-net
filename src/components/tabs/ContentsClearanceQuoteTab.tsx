'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  CONTENTS_CLEARANCE_SCHEMA,
  clauseLines,
  contentsClearanceFigures,
  defaultContentsClearanceStandards,
  emptyContentsClearanceCapture,
  normalizeContentsClearanceCapture,
  normalizeContentsClearanceStandards,
  type ContentsClearanceCapture,
  type ContentsClearanceStandards,
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
  const items = clauseLines(value)
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

export default function ContentsClearanceQuoteTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeContentsClearanceCapture(job.assessment_data?.contents_clearance_quote ?? emptyContentsClearanceCapture()),
    [job.assessment_data?.contents_clearance_quote],
  )
  const [capture, setCapture] = useState<ContentsClearanceCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [standards, setStandards] = useState<ContentsClearanceStandards>(defaultContentsClearanceStandards)
  const [standardsReady, setStandardsReady] = useState(false)
  const skipStandardsSave = useRef(true)

  useEffect(() => {
    setCapture(normalizeContentsClearanceCapture(job.assessment_data?.contents_clearance_quote))
  }, [job.id, job.updated_at])

  const isDirty = capture.estimated_m3 !== saved.estimated_m3
    || capture.estimated_km !== saved.estimated_km
    || capture.rate_per_m3 !== saved.rate_per_m3
    || capture.rate_per_km !== saved.rate_per_km
    || capture.rate_per_labour_day !== saved.rate_per_labour_day
    || capture.job_address !== saved.job_address
    || capture.tip_address !== saved.tip_address
    || capture.return_trip_km !== saved.return_trip_km
    || capture.return_trips !== saved.return_trips
    || capture.disposal_rate_per_tonne !== saved.disposal_rate_per_tonne
    || capture.estimated_tonnes !== saved.estimated_tonnes
  useRegisterUnsavedChanges('contents-clearance-quote', isDirty)

  const figures = useMemo(
    () => contentsClearanceFigures(capture.estimated_m3, capture.estimated_km, {
      ratePerM3: capture.rate_per_m3 ?? CONTENTS_CLEARANCE_SCHEMA.ratePerM3,
      ratePerKm: capture.rate_per_km ?? CONTENTS_CLEARANCE_SCHEMA.ratePerKm,
      ratePerLabourDay: capture.rate_per_labour_day ?? CONTENTS_CLEARANCE_SCHEMA.ratePerLabourDay,
      m3PerLabourDay: CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay,
    }, {
      returnTripKm: capture.return_trip_km,
      returnTrips: capture.return_trips,
      tonnes: capture.estimated_tonnes,
      ratePerTonne: capture.disposal_rate_per_tonne,
    }),
    [capture],
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/company')
      .then(r => r.json())
      .then((data: { company?: { contents_clearance_standards?: unknown } }) => {
        if (cancelled) return
        skipStandardsSave.current = true
        setStandards(normalizeContentsClearanceStandards(data.company?.contents_clearance_standards))
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

  async function persistStandards(next: ContentsClearanceStandards) {
    const res = await fetch('/api/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents_clearance_standards: next }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setSaveError(data.error || 'The clauses could not be saved for future jobs.')
    }
  }

  function editStandards(next: Partial<ContentsClearanceStandards>) {
    setStandards(prev => ({ ...prev, ...next }))
  }

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
    await persistStandards(standards)
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
      <div style={{ fontSize: 14, marginBottom: 12 }}>
        <div style={LABEL}>Client</div>
        <div>{job.client_name || '—'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Disposal fee per tonne ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.disposal_rate_per_tonne ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ disposal_rate_per_tonne: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Estimated tonnes</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.estimated_tonnes ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ estimated_tonnes: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Job address</label>
          <input
            type="text"
            value={capture.job_address ?? job.site_address}
            onChange={e => patch({ job_address: e.target.value })}
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Tip address</label>
          <input
            type="text"
            value={capture.tip_address}
            onChange={e => patch({ tip_address: e.target.value })}
            style={INPUT}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={LABEL}>Return trip (km)</label>
          <input
            type="number"
            min={0}
            step="0.1"
            value={capture.return_trip_km ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ return_trip_km: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Return trips</label>
          <input
            type="number"
            min={0}
            step="1"
            value={capture.return_trips ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ return_trips: raw === '' ? null : Number(raw) })
            }}
            placeholder="0"
            style={INPUT}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {figures.return_trips.toLocaleString('en-AU', { maximumFractionDigits: 2 })} trips × {figures.return_trip_km.toLocaleString('en-AU', { maximumFractionDigits: 2 })} km = {figures.estimated_km.toLocaleString('en-AU', { maximumFractionDigits: 2 })} km
          </div>
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
            {CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay} m³ is one labour day.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={LABEL}>Rate per m³ ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_m3 ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_m3: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Rate per km ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={capture.rate_per_km ?? ''}
            onChange={e => {
              const raw = e.target.value
              patch({ rate_per_km: raw === '' ? null : Number(raw) })
            }}
            placeholder="0.00"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LABEL}>Rate per labour day ($)</label>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800, marginTop: 4 }}>
          <span>Total inc GST</span>
          <span>{formatAud(figures.total)}</span>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
        <ClickToEditText label="Inclusions" asList value={standards.inclusions} onChange={inclusions => editStandards({ inclusions })} />
        <ClickToEditText label="Exclusions" asList value={standards.exclusions} onChange={exclusions => editStandards({ exclusions })} />
        <ClickToEditText label="Assumptions" asList value={standards.assumptions} onChange={assumptions => editStandards({ assumptions })} />
        <ClickToEditText label="Payment terms" value={standards.payment_terms} onChange={payment_terms => editStandards({ payment_terms })} />
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
