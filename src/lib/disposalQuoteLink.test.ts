import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentData } from '@/lib/types'
import {
  computeDisposalTotals,
  disposalCaptureWithQuote,
  disposalPriceLines,
  disposalRecordSummary,
  effectiveCostPerM3,
  emptyDisposalLoad,
  emptyDisposalVehicle,
  mergedDisposalManifestCapture,
  quoteDisposalLink,
} from '@/lib/disposalManifest'

const quote = {
  estimated_m3: 24,
  rate_per_m3: 85,
  tip_address: 'Wangara Transfer Station',
  tip_lat: -31.79,
  tip_lng: 115.83,
}

test('a blank disposal rate and tip follow the contents clearance quote', () => {
  const ad = { contents_clearance_quote: quote } as unknown as AssessmentData
  const capture = disposalCaptureWithQuote(ad)
  assert.equal(capture.cost_per_m3, 85)
  assert.equal(capture.defaults.facility, 'Wangara Transfer Station')
  assert.equal(capture.defaults.dump_lat, -31.79)
  assert.equal(capture.loads[0]?.facility, 'Wangara Transfer Station')
  assert.equal(capture.prepaid_m3, null)
  assert.equal(quoteDisposalLink(ad)?.quoted_m3, 24)
})

test('a typed disposal rate and tip are kept', () => {
  const ad = {
    contents_clearance_quote: quote,
    disposal_manifest_capture: {
      cost_per_m3: 90,
      defaults: { facility: 'Red Hill Landfill' },
      loads: [],
    },
  } as unknown as AssessmentData
  const capture = disposalCaptureWithQuote(ad)
  assert.equal(capture.cost_per_m3, 90)
  assert.equal(capture.defaults.facility, 'Red Hill Landfill')
  assert.equal(effectiveCostPerM3({ cost_per_m3: null }, quoteDisposalLink(ad)), 85)
})

test('the record summary is counted volume at the rate, plus labour and the call-out fee', () => {
  const load = {
    ...emptyDisposalLoad(),
    dump_fee: 220,
    vehicles: [{ ...emptyDisposalVehicle('skip'), waste_sqm: 10, skip_cost: 550, waste_price: 999 }],
  }
  const ad = {
    contents_clearance_quote: { ...quote, maximum_man_days: 2, rate_per_labour_day: 600, mobilisation_fee: 150 },
    disposal_manifest_capture: { loads: [load], prepaid_m3: 24 },
  } as unknown as AssessmentData
  const link = quoteDisposalLink(ad)
  const record = disposalRecordSummary(mergedDisposalManifestCapture(ad), link)
  assert.equal(record.volume_m3, 10)
  assert.equal(record.rate_per_m3, 85)
  assert.equal(record.summary.quantity_ex, 850)
  assert.equal(record.summary.labour_ex, 1200)
  assert.equal(record.summary.mobilisation_ex, 150)
  assert.equal(record.summary.total_ex, 2200)
  assert.equal(record.summary.gst, 220)
  assert.equal(record.summary.total_inc, 2420)

  const typed = disposalRecordSummary({ ...mergedDisposalManifestCapture(ad), labour_days: 1, mobilisation_fee: 0 }, link)
  assert.equal(typed.summary.total_ex, 1450)

  const waived = quoteDisposalLink({
    contents_clearance_quote: { ...quote, mobilisation_fee: 150, mobilisation_waived: true },
  } as unknown as AssessmentData)
  assert.equal(waived?.charges.mobilisation_fee, 0)
})

test('no quote leaves the disposal record alone', () => {
  assert.equal(quoteDisposalLink({} as AssessmentData), null)
  assert.equal(disposalCaptureWithQuote({} as AssessmentData).cost_per_m3, null)
})

test('skip waste, other vehicles, and billed m3 are included in totals and prices', () => {
  const skip12 = () => ({
    ...emptyDisposalLoad(),
    vehicles: [{ ...emptyDisposalVehicle('skip'), length_m: 5, width_m: 2, height_m: 1, waste_sqm: 12, skip_cost: 0 }],
  })
  const loads = [
    skip12(),
    skip12(),
    skip12(),
    {
      ...emptyDisposalLoad(),
      vehicles: [{ ...emptyDisposalVehicle('other'), length_m: 3, width_m: 1.9, height_m: 0.8, waste_sqm: 4.5645, waste_price: 684.68 }],
    },
    {
      ...emptyDisposalLoad(),
      vehicles: [
        { ...emptyDisposalVehicle('ute'), length_m: 2.1, width_m: 1.8, height_m: 1 },
        { ...emptyDisposalVehicle('trailer'), length_m: 2.5, width_m: 1.8, height_m: 1.2 },
      ],
    },
    {
      ...emptyDisposalLoad(),
      vehicles: [
        { ...emptyDisposalVehicle('skip'), length_m: 2.1, width_m: 1.8, height_m: 1.5, skip_cost: 0 },
        { ...emptyDisposalVehicle('trailer'), length_m: 2.5, width_m: 1.8, height_m: 1.2 },
      ],
    },
    {
      ...emptyDisposalLoad(),
      vehicles: [{ ...emptyDisposalVehicle('other'), length_m: 3, width_m: 1.8, height_m: 1 }],
    },
  ]
  const totals = computeDisposalTotals(loads)
  assert.equal(totals.volume_m3, 66.21)

  const prices = disposalPriceLines(loads, 150, 30)
  assert.equal(prices.skips_ex, 6250.5)
  assert.equal(prices.trailers_ex, 1620)
  assert.equal(prices.utes_ex, 567)
  assert.equal(prices.others_ex, 1494.68)
  assert.equal(prices.prepaid_ex, 4500)
  assert.equal(prices.total_ex, 5432.18)
})

test('selecting skip removes the tip address and distance from defaults and skip-only loads', () => {
  const ad = {
    contents_clearance_quote: quote,
    disposal_manifest_capture: {
      defaults: {
        vehicle_type: 'skip',
        facility: 'Bundaberg Regional Council - Childers Waste Management Facility',
        dump_lat: -25.23,
        dump_lng: 152.27,
        distance_km: 4.2,
      },
      loads: [
        {
          id: 'l1',
          vehicles: [{ id: 'v1', type: 'skip', length_m: 5, width_m: 2, height_m: 1 }],
          facility: 'Bundaberg Regional Council - Childers Waste Management Facility',
          dump_location: 'Bundaberg Regional Council - Childers Waste Management Facility',
          dump_lat: -25.23,
          dump_lng: 152.27,
          distance_km: 4.2,
        },
      ],
    },
  } as unknown as AssessmentData

  const capture = disposalCaptureWithQuote(ad)
  assert.equal(capture.defaults.facility, '')
  assert.equal(capture.defaults.dump_lat, null)
  assert.equal(capture.defaults.distance_km, null)
  assert.equal(capture.loads[0]?.facility, '')
  assert.equal(capture.loads[0]?.dump_location, '')
  assert.equal(capture.loads[0]?.distance_km, null)
})
