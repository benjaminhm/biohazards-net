import assert from 'node:assert/strict'
import test from 'node:test'
import { contentsClearanceFigures, contentsClearanceQuoteContent, defaultContentsClearanceStandards, emptyContentsClearanceCapture } from '@/lib/contentsClearanceQuote'
import { buildPrintHTML } from '@/lib/printDocument'

test('18 cubic metres is 3 labour days and 24 is 4', () => {
  const estimated = contentsClearanceFigures(18, 0)
  assert.equal(estimated.labour_days, 3)
  assert.equal(estimated.lines[2].quantity, 3)
  const measured = contentsClearanceFigures(24, 0)
  assert.equal(measured.labour_days, 4)
  assert.equal(measured.lines[0].quantity, 24)
  assert.equal(measured.lines[1].amount, 0)
})

test('each line is quantity times its rate, then GST', () => {
  const figures = contentsClearanceFigures(18, 10, {
    ratePerM3: 100,
    ratePerKm: 2,
    ratePerLabourDay: 500,
    m3PerLabourDay: 6,
  })
  assert.equal(figures.lines[0].amount, 1800)
  assert.equal(figures.lines[1].amount, 20)
  assert.equal(figures.lines[2].amount, 1500)
  assert.equal(figures.subtotal, 3320)
  assert.equal(figures.gst, 332)
  assert.equal(figures.total, 3652)
})

test('return trips set the kilometres, and tonnes add a disposal line', () => {
  const figures = contentsClearanceFigures(0, 99, undefined, {
    returnTripKm: 6,
    returnTrips: 2,
    tonnes: 1.5,
    ratePerTonne: 200,
  })
  assert.equal(figures.estimated_km, 12)
  assert.equal(figures.lines.find(line => line.label === 'Distance')?.amount, 0)
  assert.equal(figures.disposal_amount, 300)
  assert.equal(figures.lines.find(line => line.label === 'Disposal')?.quantity, 1.5)
})

test('the quote prints quantities, then clauses, terms, authority, and acceptance', () => {
  const content = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptyContentsClearanceCapture(),
      estimated_m3: 18,
      return_trip_km: 6,
      return_trips: 2,
      rate_per_m3: 100,
      rate_per_km: 2,
      rate_per_labour_day: 500,
      tip_address: 'Tip Road',
    },
    standards: {
      ...defaultContentsClearanceStandards(),
      engagement_agreement: 'The client engages the contractor for this clearance.',
    },
  })
  const html = buildPrintHTML(
    'contents_clearance_quote',
    content as unknown as Record<string, unknown>,
    [],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  const labels = [...html.matchAll(/class="label"[^>]*>([^<]+)/g)].map(match => match[1])
  assert.deepEqual(labels, ['Quantities', 'Inclusions', 'Exclusions', 'Assumptions', 'Payment terms', 'Engagement agreement', 'Authority', 'Acceptance'])
  assert.match(html, /The client engages the contractor for this clearance\./)
  assert.match(html, /Acme Pty Ltd/)
  assert.match(html, /1 Example Street/)
  assert.match(html, /Tip Road/)
  assert.match(html, /2 return trips of 6 km/)
  assert.equal(content.labour_days, 3)
  assert.equal(content.volume_amount, 1800)
  assert.equal(content.distance_amount, 24)
  assert.equal(content.labour_amount, 1500)
  assert.match(html, /\$100\.00 \/ m³/)
  assert.equal(content.title, 'Contents Clearance Quote')
})

test('the client clearance name is the generated document title', () => {
  const hoarding = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: { ...emptyContentsClearanceCapture(), clearance_kind: 'hoarding' },
  })
  const estate = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: { ...emptyContentsClearanceCapture(), clearance_kind: 'estate' },
  })
  assert.equal(hoarding.title, 'Hoarding Clearance Quote')
  assert.equal(estate.title, 'Estate Clearance Quote')
})
