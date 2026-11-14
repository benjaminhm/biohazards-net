'use client'

import type { CSSProperties } from 'react'
import type { AssessmentData } from '@/lib/types'
import { formatAud } from '@/lib/disposalManifest'
import { biohazardCleaningFigures, type BiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import {
  biohazardQuoteHasEstimates,
  biohazardRecordSummary,
  biohazardZoneNames,
  type BiohazardCleaningRecordCapture,
} from '@/lib/biohazardCleaningRecord'
import DefaultedNumberInput from '@/components/DefaultedNumberInput'

const ROW: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12 }
const MUTED: CSSProperties = { color: 'var(--text-muted)' }
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }

/** Biohazard Cleaning Record on the House Survey: measured zones and tests, with the quote's rates and fixed charges carried over. */
export default function BiohazardCleaningRecordSection({
  quote,
  record,
  ad,
  onChange,
  inputStyle,
  labelStyle,
}: {
  quote: BiohazardCleaningCapture
  record: BiohazardCleaningRecordCapture
  ad: AssessmentData | null | undefined
  onChange: (next: BiohazardCleaningRecordCapture) => void
  inputStyle: CSSProperties
  labelStyle: CSSProperties
}) {
  const figures = biohazardCleaningFigures(quote)
  const names = biohazardZoneNames(quote, ad)
  const summary = biohazardRecordSummary(record, quote, ad)
  const patch = (next: Partial<BiohazardCleaningRecordCapture>) => onChange({ ...record, ...next })

  const actual = (label: string, value: number | null, step: string, set: (next: number | null) => void) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        min={0}
        step={step}
        value={value ?? ''}
        onChange={e => set(e.target.value === '' ? null : Number(e.target.value))}
        placeholder="Measured"
        style={inputStyle}
      />
    </div>
  )
  const carried = (label: string, value: number | null | undefined, fallback: number | null, step: string, set: (next: number | null) => void) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <DefaultedNumberInput value={value} fallback={fallback} step={step} onChange={set} style={inputStyle} />
    </div>
  )
  const zone = (name: string) => record.other_zones.find(z => z.name.toLowerCase() === name.toLowerCase()) ?? { name, m2: null, rate_per_m2: null }
  const setZone = (name: string, next: Partial<BiohazardCleaningRecordCapture['other_zones'][number]>) => {
    const rest = record.other_zones.filter(z => z.name.toLowerCase() !== name.toLowerCase())
    patch({ other_zones: [...rest, { ...zone(name), ...next }] })
  }

  if (!biohazardQuoteHasEstimates(quote)) {
    return (
      <section style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: '12px 14px' }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Biohazard Cleaning Record</div>
        <p style={{ margin: 0, fontSize: 14, ...MUTED }}>The Biohazard Cleaning Quote is a fixed price. The statement uses its total, so nothing needs recording here.</p>
      </section>
    )
  }

  return (
    <section style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: '12px 14px', display: 'grid', gap: 12 }}>
      <div style={{ fontWeight: 800 }}>Biohazard Cleaning Record</div>

      <div style={GRID}>
        {actual(names.primary ? `Primary zone: ${names.primary} (m²)` : 'Primary zone (m²)', record.primary_m2, '0.01', v => patch({ primary_m2: v }))}
        {carried('Rate per m² (ex GST) ($)', record.rate_per_m2, figures.rate_per_m2, '0.01', v => patch({ rate_per_m2: v }))}
        {figures.has_secondary && actual(names.secondary ? `Secondary zone: ${names.secondary} (m²)` : 'Secondary zone (m²)', record.secondary_m2, '0.01', v => patch({ secondary_m2: v }))}
        {figures.has_secondary && carried('Secondary rate per m² (ex GST) ($)', record.secondary_rate_per_m2, figures.secondary_rate_per_m2, '0.01', v => patch({ secondary_rate_per_m2: v }))}
        {names.other.map(name => (
          <div key={name} style={{ display: 'contents' }}>
            {actual(`${name} (m²)`, zone(name).m2, '0.01', v => setZone(name, { m2: v }))}
            {carried(`${name} rate per m² (ex GST) ($)`, zone(name).rate_per_m2, null, '0.01', v => setZone(name, { rate_per_m2: v }))}
          </div>
        ))}
        {quote.atp_testing && actual('ATP tests done', record.atp_tests, '1', v => patch({ atp_tests: v }))}
        {quote.atp_testing && carried('Rate per ATP test (ex GST) ($)', record.atp_rate, quote.atp_rate, '0.01', v => patch({ atp_rate: v }))}
        {quote.lab_testing && actual('Lab tests done', record.lab_tests, '1', v => patch({ lab_tests: v }))}
        {quote.lab_testing && carried('Rate per lab test (ex GST) ($)', record.lab_rate, quote.lab_rate, '0.01', v => patch({ lab_rate: v }))}
      </div>

      <div style={GRID}>
        {carried('Labour days', record.labour_days, figures.labour_days, '0.5', v => patch({ labour_days: v }))}
        {carried('Rate per labour day (ex GST) ($)', record.rate_per_labour_day, figures.rate_per_labour_day, '0.01', v => patch({ rate_per_labour_day: v }))}
        {carried('Call-out fee (ex GST) ($)', record.mobilisation_fee, figures.mobilisation_fee, '0.01', v => patch({ mobilisation_fee: v }))}
        {carried('Travel (km)', record.travel_km, figures.travel_km, '0.1', v => patch({ travel_km: v }))}
        {carried('Rate per km (ex GST) ($)', record.rate_per_km, figures.rate_per_km, '0.01', v => patch({ rate_per_km: v }))}
        {figures.has_contents && carried('Affected contents removed (m³)', record.contents_m3, figures.contents_m3, '0.1', v => patch({ contents_m3: v }))}
        {figures.has_contents && carried('Rate per m³ (ex GST) ($)', record.contents_rate_per_m3, figures.contents_rate_per_m3, '0.01', v => patch({ contents_rate_per_m3: v }))}
        {figures.has_contents && carried('Disposal fee (ex GST) ($)', record.contents_disposal_fee, figures.contents_disposal_fee, '0.01', v => patch({ contents_disposal_fee: v }))}
        {quote.coh_rap && carried('COH/RAP fee (ex GST) ($)', record.coh_rap_fee, quote.coh_rap_fee, '0.01', v => patch({ coh_rap_fee: v }))}
        {(quote.extra_lines ?? []).filter(line => line.label.trim()).map(line => (
          <div key={line.id}>
            {carried(`${line.label.trim()} (ex GST) ($)`, record.extra_amounts[line.id], Math.round((line.quantity ?? 0) * (line.rate ?? 0) * 100) / 100, '0.01', v => patch({ extra_amounts: { ...record.extra_amounts, [line.id]: v } }))}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6, fontSize: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        {summary.lines.map(line => (
          <div key={line.label} style={ROW}>
            <span>{line.label}</span>
            <span>{formatAud(line.amount_ex)}</span>
          </div>
        ))}
        <div style={{ ...ROW, fontWeight: 800, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <span>Total ex GST</span>
          <span>{formatAud(summary.total_ex)}</span>
        </div>
        <div style={ROW}>
          <span style={MUTED}>GST</span>
          <span>{formatAud(summary.gst)}</span>
        </div>
        <div style={{ ...ROW, fontWeight: 800 }}>
          <span>Total inc GST</span>
          <span>{formatAud(summary.total_inc)}</span>
        </div>
        {summary.missing.length > 0 && (
          <div style={{ fontSize: 13, color: '#F59E0B' }}>Still to record: {summary.missing.join(', ')}.</div>
        )}
      </div>
    </section>
  )
}
