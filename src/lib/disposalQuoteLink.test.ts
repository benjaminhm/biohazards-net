import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentData } from '@/lib/types'
import { disposalCaptureWithQuote, effectiveCostPerM3, quoteDisposalLink } from '@/lib/disposalManifest'

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

test('no quote leaves the disposal record alone', () => {
  assert.equal(quoteDisposalLink({} as AssessmentData), null)
  assert.equal(disposalCaptureWithQuote({} as AssessmentData).cost_per_m3, null)
})
