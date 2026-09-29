import assert from 'node:assert/strict'
import test from 'node:test'
import { contentsClearanceFigures, contentsClearanceQuoteContent, contentsClearanceTimeFrame, defaultContentsClearanceStandards, emptyContentsClearanceCapture, normalizeContentsClearanceStandards } from '@/lib/contentsClearanceQuote'
import { buildPrintHTML } from '@/lib/printDocument'

test('18 cubic metres is 3 man days and 24 is 4', () => {
  const estimated = contentsClearanceFigures(18, 0)
  assert.equal(estimated.labour_days, 3)
  assert.equal(estimated.lines[2].quantity, 3)
  assert.equal(estimated.lines[2].unit, 'labour days')
  const measured = contentsClearanceFigures(24, 0)
  assert.equal(measured.labour_days, 4)
  assert.equal(measured.lines[0].quantity, 24)
  assert.equal(measured.lines[1].amount, 0)
  assert.equal(contentsClearanceFigures(28, 0).labour_days, 5)
  const quoted = contentsClearanceFigures(18, 0, {
    ratePerM3: 0,
    ratePerKm: 0,
    ratePerLabourDay: 500,
    m3PerLabourDay: 6,
  }, { maximumManDays: 5 })
  assert.equal(quoted.labour_days, 5)
  assert.equal(quoted.lines.find(line => line.label === 'Labour')?.amount, 2500)
  const slower = contentsClearanceFigures(18, 0, {
    ratePerM3: 0,
    ratePerKm: 0,
    ratePerLabourDay: 0,
    m3PerLabourDay: 4,
  })
  assert.equal(slower.labour_days, 5)
  assert.equal(slower.m3_per_labour_day, 4)
  assert.equal(contentsClearanceTimeFrame(4), '4 man days (4 days with 1 person or 1 day with 4 persons)')
})

test('cubic metres per person per day on the job sets the man days', () => {
  const content = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptyContentsClearanceCapture(),
      estimated_m3: 18,
      m3_per_labour_day: 9,
      rate_per_labour_day: 500,
    },
  })
  assert.equal(content.labour_days, 2)
  assert.equal(content.m3_per_labour_day, 9)
  assert.equal(content.labour_amount, 1000)
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
  assert.equal(content.labour_days, 2)
  assert.doesNotMatch(html, /m³ per day/)
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
  const hauled = contentsClearanceFigures(18, 0, undefined, {
    returnTripKm: 10,
    returnTrips: 1,
    m3PerTrip: 5,
    tripsPerDay: 2,
  })
  assert.equal(hauled.return_trips, 4)
  assert.equal(hauled.estimated_km, 40)
  assert.equal(hauled.trip_days, 2)
  const hauledQuote = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptyContentsClearanceCapture(),
      estimated_m3: 18,
      return_trip_km: 10,
      m3_per_trip: 5,
      trips_per_day: 2,
    },
  })
  const hauledHtml = buildPrintHTML(
    'contents_clearance_quote',
    hauledQuote as unknown as Record<string, unknown>,
    [],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  assert.match(hauledHtml, /18 m³ ÷ 5 m³ per trip/)
  assert.match(hauledHtml, /4 trips ÷ 2 trips per day, 2 days/)
  assert.equal(figures.mobilisation_fee, 0)
  assert.equal(figures.lines.some(line => line.label === 'Mobilisation'), false)
})

test('a mobilisation fee is added ex GST before the total', () => {
  const figures = contentsClearanceFigures(18, 0, {
    ratePerM3: 100,
    ratePerKm: 0,
    ratePerLabourDay: 500,
    m3PerLabourDay: 6,
  }, { mobilisationFee: 250 })
  assert.equal(figures.lines[0].label, 'Mobilisation')
  assert.equal(figures.lines[0].amount, 250)
  assert.equal(figures.subtotal, 1800 + 1500 + 250)
  assert.equal(figures.gst, 355)
  assert.equal(figures.total, 3905)
  const content = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptyContentsClearanceCapture(),
      estimated_m3: 18,
      rate_per_m3: 100,
      rate_per_labour_day: 500,
      mobilisation_fee: 250,
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
  assert.match(html, /Mobilisation/)
  assert.match(html, /\$250\.00/)
  assert.equal(content.total, 3905)
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
  assert.deepEqual(labels, ['Estimated quantities', 'Fixed Rate Quotations', 'Inclusions', 'Exclusions', 'Assumptions', 'Payment terms', 'Engagement agreement', 'Authority', 'Acceptance'])
  assert.match(html, /class="sow-doc-title">Contents Clearance</)
  assert.doesNotMatch(html, /sow-doc-title">[^<]*Quote/)
  assert.match(html, /Estimated subtotal \(ex GST\)/)
  assert.match(html, /\$1,824\.00/)
  assert.match(html, /Fixed subtotal \(ex GST\)/)
  assert.match(html, /\$1,500\.00/)
  assert.ok(html.indexOf('Estimated quantities') < html.indexOf('Fixed Rate Quotations'))
  assert.ok(html.indexOf('Fixed Rate Quotations') < html.indexOf('>Labour<'))
  assert.doesNotMatch(html, /5 days with 1 person or 1 day with 5 persons/)
  assert.doesNotMatch(html, /days with 1 person/)
  assert.match(html, /3 labour days/)
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
  assert.match(html, /\$1,800\.00/)
  assert.match(html, /GST \(10%\)/)
  assert.match(html, /\$3,656\.40/)
  assert.match(html, /18 m³/)
  assert.match(html, /The measured volume replaces that estimate/)
  assert.match(html, /The labour days on this quote are the labour for this clearance/)
  assert.doesNotMatch(html, /divided by/)
  assert.doesNotMatch(html, /for every 6/)
  assert.equal(content.title, 'Contents Clearance')
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
  assert.equal(hoarding.title, 'Hoarding Clearance')
  assert.equal(estate.title, 'Estate Clearance')
})

test('a saved copy of the old labour-follows-volume clauses is replaced, and an edit is kept', () => {
  const refreshed = normalizeContentsClearanceStandards({
    inclusions: [
      'Contents clearance of the stated volume at the standard rate per cubic metre.',
      'Travel at the standard rate per kilometre.',
      'Labour at one man day for every 6 cubic metres, at the standard rate per person per day.',
    ].join('\n'),
    assumptions: [
      'Cubic metres are an estimate. The measured volume replaces the estimate, and labour days are that volume divided by 6, rounded to a whole day.',
      'Kilometres are an estimate of the travel for this clearance.',
      'The technician decides on site how the contents leave the property.',
    ].join('\n'),
    payment_terms: 'A deposit of 50% of this estimate is requested before the clearance starts. The balance is the measured cubic metres, the kilometres, and the labour days that follow the measured volume, at the rates on this quote. GST is 10%.',
    exclusions: [
      'Surface cleaning, sanitising, and remediation.',
      'Repairs, rebuilding, and restoration of contents.',
      'Work beyond the quantities on this quote.',
    ].join('\n'),
    engagement_agreement: 'Kept.',
  })
  const current = defaultContentsClearanceStandards()
  assert.equal(refreshed.inclusions, current.inclusions)
  assert.equal(refreshed.assumptions, current.assumptions)
  assert.equal(refreshed.payment_terms, current.payment_terms)
  assert.equal(refreshed.exclusions, current.exclusions)
  assert.equal(refreshed.engagement_agreement, 'Kept.')
  const edited = normalizeContentsClearanceStandards({
    inclusions: 'Contents clearance of the garage only.',
  })
  assert.equal(edited.inclusions, 'Contents clearance of the garage only.')
  assert.equal(edited.assumptions, current.assumptions)
})
