import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssessmentData } from '@/lib/types'
import { normalizeBiohazardCleaningCapture, type BiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import {
  biohazardQuoteHasEstimates,
  biohazardRecordFromJob,
  biohazardRecordSummary,
  normalizeBiohazardCleaningRecord,
} from '@/lib/biohazardCleaningRecord'

function quote(patch: Record<string, unknown>): BiohazardCleaningCapture {
  return normalizeBiohazardCleaningCapture({ travel_km: 0, ...patch })
}

const estimated = quote({
  rooms: [{ id: 'k', name: 'Kitchen', length_m: null, width_m: null, height_m: null }],
  estimated_m2: 20,
  rate_per_m2: 50,
  labour_days: 2,
  rate_per_labour_day: 600,
  mobilisation_fee: 150,
  atp_testing: true,
  atp_tests: 4,
  atp_rate: 25,
  coh_rap: true,
  coh_rap_fee: 90,
  extra_lines: [{ id: 'x1', label: 'Odour treatment', quantity: 1, rate: 200 }],
})

test('an estimated BCQ bills measured m² and tests done at the quote rates, with its fixed parts carried', () => {
  assert.equal(biohazardQuoteHasEstimates(estimated), true)
  const summary = biohazardRecordSummary(normalizeBiohazardCleaningRecord({ primary_m2: 18, atp_tests: 3 }), estimated)
  assert.deepEqual(summary.missing, [])
  assert.deepEqual(summary.lines.map(line => [line.label, line.amount_ex]), [
    ['Primary zone: Kitchen (18 m² × $50.00)', 900],
    ['Labour (2 days × $600.00)', 1200],
    ['Call-out fee', 150],
    ['Testing (3 ATP tests × $25.00)', 75],
    ['Other fees (COH/RAP, Odour treatment)', 290],
  ])
  assert.equal(summary.total_ex, 2615)
  assert.equal(summary.gst, 261.5)
  assert.equal(summary.total_inc, 2876.5)
})

test('staff can change the carried parts, and zero lines are left off', () => {
  const summary = biohazardRecordSummary(normalizeBiohazardCleaningRecord({
    primary_m2: 18, rate_per_m2: 40, atp_tests: 0, labour_days: 1, mobilisation_fee: 0, coh_rap_fee: 0, extra_amounts: { x1: 0 },
    travel_km: 30, rate_per_km: 1.5,
  }), estimated)
  assert.deepEqual(summary.lines.map(line => [line.label, line.amount_ex]), [
    ['Primary zone: Kitchen (18 m² × $40.00)', 720],
    ['Labour (1 day × $600.00)', 600],
    ['Travel (30 km × $1.50)', 45],
  ])
})

test('missing actuals are listed until entered', () => {
  const summary = biohazardRecordSummary(normalizeBiohazardCleaningRecord({}), estimated)
  assert.deepEqual(summary.missing, ['Measured m² for primary zone: kitchen', 'ATP tests done'])
})

test('a fixed-price BCQ needs no record', () => {
  const fixed = quote({ labour_days: 1, rate_per_labour_day: 800 })
  assert.equal(biohazardQuoteHasEstimates(fixed), false)
  const view = biohazardRecordFromJob({ biohazard_cleaning_quote: fixed } as unknown as AssessmentData)!
  assert.equal(view.needed, false)
  assert.equal(view.exists, false)
  assert.equal(biohazardRecordFromJob({} as AssessmentData), null)
})

test('other zones are charged only when staff type both m² and a rate', () => {
  const withOther = quote({ ...estimated, other_zones: ['garage'] })
  const blankRate = biohazardRecordSummary(normalizeBiohazardCleaningRecord({ primary_m2: 18, atp_tests: 3, other_zones: [{ name: 'garage', m2: 5 }] }), withOther)
  assert.equal(blankRate.lines.some(line => line.label.startsWith('Garage')), false)
  const priced = biohazardRecordSummary(normalizeBiohazardCleaningRecord({ primary_m2: 18, atp_tests: 3, other_zones: [{ name: 'garage', m2: 5, rate_per_m2: 10 }] }), withOther)
  assert.deepEqual(priced.lines.find(line => line.label.startsWith('Garage')), { kind: 'zone', label: 'Garage (5 m² × $10.00)', amount_ex: 50 })
})

test('affected contents carry from the quote as one fixed amount, which staff can change on the record', () => {
  const withContents = quote({
    estimated_m2: 20, rate_per_m2: 50, labour_days: 1, rate_per_labour_day: 600,
    contents_m3: 2, contents_rate_per_m3: 100, contents_disposal_fee: 150,
  })
  const carried = biohazardRecordSummary(normalizeBiohazardCleaningRecord({ primary_m2: 20 }), withContents)
  assert.deepEqual(carried.lines.map(line => [line.label, line.amount_ex]), [
    ['Primary zone (20 m² × $50.00)', 1000],
    ['Affected contents removal and disposal', 350],
    ['Labour (1 day × $600.00)', 600],
  ])
  const changed = biohazardRecordSummary(normalizeBiohazardCleaningRecord({ primary_m2: 20, contents_amount: 400 }), withContents)
  assert.deepEqual(changed.lines.filter(line => line.kind === 'contents').map(line => [line.label, line.amount_ex]), [
    ['Affected contents removal and disposal', 400],
  ])
})
