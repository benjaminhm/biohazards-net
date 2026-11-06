import type { CSSProperties } from 'react'
import { formatAud } from '@/lib/disposalManifest'
import { labourDaysText, type FixedCharges, type RecordSummary } from '@/lib/fixedCharges'

const ROW: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12 }
const MUTED: CSSProperties = { color: 'var(--text-muted)' }

function money(n: number | null): string {
  return n == null ? '—' : formatAud(n)
}

/** Quantity × rate, labour, call-out fee, then totals and GST. */
export default function RecordSummaryTable({
  quantityLabel,
  quantity,
  rate,
  charges,
  summary,
}: {
  quantityLabel: string
  /** Formatted quantity, e.g. "42 m²". Blank leaves the detail off. */
  quantity: string
  rate: number | null
  charges: FixedCharges
  summary: RecordSummary
}) {
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
      <div style={ROW}>
        <span>
          {quantityLabel}
          {quantity && rate != null && <span style={MUTED}> ({quantity} × {formatAud(rate)})</span>}
        </span>
        <span>{money(summary.quantity_ex)}</span>
      </div>
      <div style={ROW}>
        <span>
          Labour
          <span style={MUTED}> ({labourDaysText(charges.labour_days)} × {formatAud(charges.rate_per_labour_day)})</span>
        </span>
        <span>{money(summary.labour_ex)}</span>
      </div>
      <div style={ROW}>
        <span>Call-out fee</span>
        <span>{money(summary.mobilisation_ex)}</span>
      </div>
      <div style={{ ...ROW, fontWeight: 800, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <span>Total ex GST</span>
        <span>{money(summary.total_ex)}</span>
      </div>
      <div style={ROW}>
        <span style={MUTED}>GST</span>
        <span>{money(summary.gst)}</span>
      </div>
      <div style={{ ...ROW, fontWeight: 800 }}>
        <span>Total inc GST</span>
        <span>{money(summary.total_inc)}</span>
      </div>
    </div>
  )
}
