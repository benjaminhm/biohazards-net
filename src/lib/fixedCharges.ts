/**
 * Labour and call-out fee on a record (House Survey, Contents Disposal Record).
 * Both are fixed prices. A blank field takes the linked quote's figure.
 */

export interface FixedChargeFields {
  labour_days?: number | null
  rate_per_labour_day?: number | null
  /** Call-out fee, ex GST. */
  mobilisation_fee?: number | null
}

/** What a blank field becomes. A waived quote call-out is 0. */
export interface FixedChargeDefaults {
  labour_days: number
  rate_per_labour_day: number
  mobilisation_fee: number
}

export interface FixedCharges {
  labour_days: number
  rate_per_labour_day: number
  labour_ex: number
  mobilisation_ex: number
}

export interface RecordSummary {
  /** Quantity × rate. Null when the quantity or rate is missing. */
  quantity_ex: number | null
  labour_ex: number
  mobilisation_ex: number
  total_ex: number | null
  gst: number | null
  total_inc: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function fixedCharges(fields: FixedChargeFields, defaults: FixedChargeDefaults | null): FixedCharges {
  const labour_days = fields.labour_days ?? defaults?.labour_days ?? 0
  const rate_per_labour_day = fields.rate_per_labour_day ?? defaults?.rate_per_labour_day ?? 0
  return {
    labour_days,
    rate_per_labour_day,
    labour_ex: round2(labour_days * rate_per_labour_day),
    mobilisation_ex: round2(fields.mobilisation_fee ?? defaults?.mobilisation_fee ?? 0),
  }
}

/** Measured quantity at the rate, plus labour and the call-out fee. GST is 10%. */
export function recordSummary(quantity: number | null, rate: number | null, charges: FixedCharges): RecordSummary {
  const quantity_ex = quantity == null || rate == null || !Number.isFinite(rate) || rate < 0 ? null : round2(quantity * rate)
  const empty = quantity_ex == null && charges.labour_ex <= 0 && charges.mobilisation_ex <= 0
  const total_ex = empty ? null : round2((quantity_ex ?? 0) + charges.labour_ex + charges.mobilisation_ex)
  const gst = total_ex == null ? null : round2(total_ex * 0.1)
  return {
    quantity_ex,
    labour_ex: charges.labour_ex,
    mobilisation_ex: charges.mobilisation_ex,
    total_ex,
    gst,
    total_inc: total_ex == null || gst == null ? null : round2(total_ex + gst),
  }
}

export function labourDaysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/** Older clause wording that names the labour days. The printed quote shows labour as a fixed amount only. */
const LABOUR_DAY_CLAUSES: [RegExp, string][] = [
  [/^labour for the labour days on this quote, as a fixed amount\.?$/i, 'Labour, as the fixed amount on this quote.'],
  [/^the labour days on this quote are the labour for this cleaning\.?$/i, 'Labour is the fixed amount on this quote. It is not recalculated from the measured area.'],
  [/^work other than the surface cleaning and the labour days on this quote\.?$/i, 'Work other than the surface cleaning and the labour on this quote.'],
]

/** Clause text with each labour-day line in its fixed-amount wording. Other lines are kept as typed. */
export function labourClausesAsFixedAmount(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const match = LABOUR_DAY_CLAUSES.find(([pattern]) => pattern.test(line.trim()))
      return match ? match[1] : line
    })
    .join('\n')
}
