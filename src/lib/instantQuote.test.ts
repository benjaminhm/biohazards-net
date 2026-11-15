import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INSTANT_QUOTE_SCHEMA,
  emptyInstantQuoteCapture,
  instantQuoteContent,
  instantQuoteFigures,
  instantQuoteProblems,
  instantQuoteStandardExclusions,
  instantQuoteStandardInclusions,
  instantQuoteStartLabel,
  instantQuoteTitle,
  normalizeInstantQuoteCapture,
} from '@/lib/instantQuote'
import { acceptInstantQuoteDraft, instantQuoteDraftPayload } from '@/lib/instantQuoteDraft'
import { DEFAULT_ENGAGEMENT_AGREEMENT, fillInstantQuoteEngagement } from '@/lib/quoteEngagement'
import { composeDocumentContent } from '@/lib/composeDocument'
import { buildPrintHTML } from '@/lib/printDocument'
import { isAcceptableQuoteType } from '@/lib/acceptableQuotes'
import { hasSignSlots } from '@/lib/signing/slots'
import { quoteAmount } from '@/lib/xero/invoice'
import { usedPhotoIds } from '@/lib/photoSelection'
import type { Job, Photo } from '@/lib/types'

const STANDARD = { inclusions: [] as string[], exclusions: instantQuoteStandardExclusions(['surface']), assumptions: [] as string[] }

function capture(over: Record<string, unknown> = {}) {
  return normalizeInstantQuoteCapture({
    services: ['surface', 'contents'],
    brief: 'Two-bedroom unit. Clear both bedrooms and the living room, then clean the floors.',
    presentation: 'A two-bedroom unit, as described by the client.',
    scope_of_work: 'Remove the contents of both bedrooms.\nClean the hard floors with a neutral detergent.',
    job_exclusions: 'The garage.',
    price: 5500,
    earliest_start: '2026-11-23',
    ...over,
  })
}

test('a price typed including GST is split into the ex-GST amount and the GST', () => {
  assert.deepEqual(instantQuoteFigures({ price: 5500, price_includes_gst: true }), {
    subtotal: 5000, gst: 500, total: 5500, deposit: 2750, balance: 2750,
  })
})

test('a price typed excluding GST has GST added', () => {
  assert.deepEqual(instantQuoteFigures({ price: 5000, price_includes_gst: false }), {
    subtotal: 5000, gst: 500, total: 5500, deposit: 2750, balance: 2750,
  })
})

test('the parts of an awkward price still add up to the cent', () => {
  for (const price of [999.99, 1234.56, 0.01, 3333.33, 10000.01]) {
    for (const price_includes_gst of [true, false]) {
      const f = instantQuoteFigures({ price, price_includes_gst })
      assert.equal(Math.round((f.subtotal + f.gst) * 100), Math.round(f.total * 100))
      assert.equal(Math.round((f.deposit + f.balance) * 100), Math.round(f.total * 100))
    }
  }
})

test('no price is zero, not NaN', () => {
  assert.deepEqual(instantQuoteFigures({ price: null, price_includes_gst: true }), {
    subtotal: 0, gst: 0, total: 0, deposit: 0, balance: 0,
  })
})

test('the title is the services in a fixed order, or the custom title', () => {
  assert.equal(instantQuoteTitle(capture()), 'Contents Clearance and Surface Cleaning')
  assert.equal(instantQuoteTitle(capture({ services: ['surface', 'biohazard', 'contents'] })), 'Biohazard Cleaning, Contents Clearance and Surface Cleaning')
  assert.equal(instantQuoteTitle(capture({ custom_title: ' Estate Clean ' })), 'Estate Clean')
  assert.equal(instantQuoteTitle(emptyInstantQuoteCapture()), 'Quote')
})

test('a saved capture with junk in it is read safely', () => {
  const c = normalizeInstantQuoteCapture({ services: ['mould', 'surface'], price: '-5', earliest_start: 'soon', price_includes_gst: false })
  assert.deepEqual(c.services, ['surface'])
  assert.equal(c.price, null)
  assert.equal(c.earliest_start, '')
  assert.equal(c.price_includes_gst, false)
  assert.deepEqual(normalizeInstantQuoteCapture(null), emptyInstantQuoteCapture())
})

test('the standard exclusions are on every quote and follow the services', () => {
  const surfaceOnly = instantQuoteStandardExclusions(['surface'])
  for (const line of INSTANT_QUOTE_SCHEMA.exclusions.always) assert.ok(surfaceOnly.includes(line))
  assert.ok(surfaceOnly.includes(INSTANT_QUOTE_SCHEMA.exclusions.withoutContents))
  assert.ok(surfaceOnly.includes(INSTANT_QUOTE_SCHEMA.exclusions.withoutBiohazard))
  const all = instantQuoteStandardExclusions(['biohazard', 'contents', 'surface'])
  assert.ok(!all.includes(INSTANT_QUOTE_SCHEMA.exclusions.withoutContents))
  assert.ok(!all.includes(INSTANT_QUOTE_SCHEMA.exclusions.withoutBiohazard))
  assert.deepEqual(instantQuoteStandardInclusions(['contents']), [
    INSTANT_QUOTE_SCHEMA.inclusions.contents,
    INSTANT_QUOTE_SCHEMA.inclusions.always,
  ])
})

test('the quote cannot be generated without a service, a scope and a price', () => {
  assert.equal(instantQuoteProblems(emptyInstantQuoteCapture()).length, 3)
  assert.deepEqual(instantQuoteProblems(capture()), [])
  assert.equal(instantQuoteProblems(capture({ price: 0 })).length, 1)
})

test('the earliest start prints as a long date', () => {
  assert.equal(instantQuoteStartLabel('2026-11-23'), 'Monday 23 November 2026')
  assert.equal(instantQuoteStartLabel('2026-02-31'), '')
  assert.equal(instantQuoteStartLabel(''), '')
})

test('the content carries the standard lines first, then the job lines, without repeats', () => {
  const c = instantQuoteContent({
    reference: 'FQ-1',
    clientName: ' Jo Smith ',
    siteAddress: '1 Test St',
    capture: capture({ job_exclusions: `The garage.\n${INSTANT_QUOTE_SCHEMA.exclusions.always[1].toUpperCase()}` }),
  })
  assert.equal(c.client_name, 'Jo Smith')
  assert.equal(c.job_address, '1 Test St')
  assert.equal(c.total, 5500)
  assert.equal(c.exclusions[0], INSTANT_QUOTE_SCHEMA.exclusions.always[0])
  assert.equal(c.exclusions.at(-1), 'The garage.')
  assert.equal(c.exclusions.filter(line => /repairs, rebuilding/i.test(line)).length, 1)
  assert.equal(c.assumptions[0], INSTANT_QUOTE_SCHEMA.assumptions[0])
  assert.equal(c.earliest_start, 'Monday 23 November 2026')
})

test('the model is not sent the price, the client or the address', () => {
  const payload = JSON.stringify(instantQuoteDraftPayload(capture(), { job_type: 'unattended_death', job_description: 'Unit clean.' }))
  assert.ok(!payload.includes('5500'))
  assert.ok(payload.includes('Contents clearance'))
  assert.ok(payload.includes('unattended death'))
})

test('a drafted line with money, a timeframe or a guarantee is left out and reported', () => {
  const draft = acceptInstantQuoteDraft({
    presentation: 'A two-bedroom unit, as described.',
    scope: [
      '1. Remove the contents of both bedrooms.',
      '- Clean the hard floors with a neutral detergent.',
      'Complete the works within 2 days.',
      'Deodorise for $450.',
      'We guarantee the property is safe to occupy.',
    ],
    inclusions: ['Two bedrooms and the living room.'],
    exclusions: ['The garage.', INSTANT_QUOTE_SCHEMA.exclusions.always[0]],
    assumptions: ['The unit is on the ground floor.'],
  }, STANDARD)
  assert.ok(draft)
  assert.equal(draft.scope_of_work, 'Remove the contents of both bedrooms.\nClean the hard floors with a neutral detergent.')
  assert.deepEqual(draft.dropped.map(d => d.reason), ['timeframe', 'money', 'guarantee'])
  assert.equal(draft.job_exclusions, 'The garage.')
  assert.equal(draft.job_assumptions, 'The unit is on the ground floor.')
})

test('ordinary scope wording is not mistaken for money or a timeframe', () => {
  const draft = acceptInstantQuoteDraft({
    presentation: '',
    scope: [
      'Remove the contents of the 2 bedrooms on a day agreed with the client.',
      'Clean the 3 bathrooms with a hospital-grade disinfectant.',
    ],
    inclusions: [], exclusions: [], assumptions: [],
  }, STANDARD)
  assert.ok(draft)
  assert.equal(draft.dropped.length, 0)
  assert.equal(draft.scope_of_work.split('\n').length, 2)
})

test('a draft with too little scope is not used', () => {
  assert.equal(acceptInstantQuoteDraft({ presentation: 'x', scope: ['Clean.'], inclusions: [], exclusions: [], assumptions: [] }, STANDARD), null)
  assert.equal(acceptInstantQuoteDraft('nope', STANDARD), null)
})

test('the company agreement filled for a fixed price states the price and no rates or measured quantities', () => {
  const content = instantQuoteContent({
    reference: 'FQ-20261115-ABCD',
    clientName: 'Jo Smith',
    siteAddress: '1 Test St, Brisbane',
    capture: capture(),
    engagementAgreement: DEFAULT_ENGAGEMENT_AGREEMENT,
  })
  const filled = fillInstantQuoteEngagement(content, { companyName: 'Test Co', abn: '1', date: '15 November 2026' })
  assert.ok(filled.includes('The price is $5,500.00 including GST.'))
  assert.ok(filled.includes('Deposit: $2,750.00'))
  assert.ok(filled.includes('Balance: $2,750.00'))
  assert.ok(filled.includes('Contents Clearance and Surface Cleaning at 1 Test St, Brisbane'))
  assert.ok(!/measured volume replaces|is charged at|Estimated contents|Contents rate|Surface rate|Labour:/.test(filled))
  assert.ok(!/\[(?:volume|surface|rate per|kilometres|labour|total|deposit|name)[^\]]*\]/i.test(filled))
  // The undisclosed-hazard clause is what protects a fixed price. It must survive.
  assert.ok(filled.includes('undisclosed hazard'))
})

test('a job composes to a quote that prints, can be signed and can be invoiced', () => {
  const job = {
    id: '12345678-aaaa-bbbb-cccc-000000000000',
    client_name: 'Jo Smith',
    site_address: '1 Test St, Brisbane',
    assessment_data: { instant_quote: capture() },
  } as unknown as Job
  const { content, source } = composeDocumentContent('instant_quote', job, { instantQuoteEngagement: '' })
  assert.equal(source, 'assessment_capture')
  assert.match(String(content.reference), /^FQ-\d{8}-1234$/)
  assert.ok(String(content.engagement_agreement).includes('ENGAGEMENT AGREEMENT'))
  assert.deepEqual(quoteAmount(content), { exGst: 5000, gst: true })
  assert.ok(isAcceptableQuoteType('instant_quote'))

  const html = buildPrintHTML('instant_quote', content, [], [], null, job.id, 'https://example.test', { client_name: 'Jo Smith', signatureBlock: true })
  assert.ok(html.includes('FIXED PRICE (INC GST)'))
  assert.ok(html.includes('$5,500.00'))
  assert.ok(html.includes('Monday 23 November 2026'))
  assert.ok(html.includes('The garage.'))
  assert.ok(html.includes('Remove the contents of both bedrooms.'))
  assert.ok(hasSignSlots(html))
  assert.ok(!html.includes('Unknown document type'))
})

test('every fast quote says the site was not inspected and the price relies on what the client reported', () => {
  const c = instantQuoteContent({ reference: 'FQ-1', clientName: 'Jo Smith', siteAddress: '1 Test St', capture: capture() })
  assert.match(c.assumptions[0], /has not inspected the site/)
  assert.match(c.assumptions[0], /what the client reported/)
  assert.match(c.assumptions[1], /differs materially from what the client reported/)
})

test('the photos chosen on a fast quote are kept in order and count as used', () => {
  const c = normalizeInstantQuoteCapture({ photo_ids: ['p2', 'p1', 'p2', 7] })
  assert.deepEqual(c.photo_ids, ['p2', 'p1'])
  assert.equal(normalizeInstantQuoteCapture({}).photo_ids, undefined)
  assert.ok(usedPhotoIds({ instant_quote: c } as never).has('p1'))
})

test('a fast quote prints its basis, and only the photos chosen as supplied by the client', () => {
  const photos = [
    { id: 'p1', file_url: 'https://example.test/client-1.jpg', caption: 'Main bedroom' },
    { id: 'p2', file_url: 'https://example.test/staff-2.jpg', caption: '' },
  ] as unknown as Photo[]
  const job = (over: Record<string, unknown>) => ({
    id: '12345678-aaaa-bbbb-cccc-000000000000',
    client_name: 'Jo Smith',
    site_address: '1 Test St, Brisbane',
    assessment_data: { instant_quote: capture(over) },
  }) as unknown as Job
  const print = (j: Job) => buildPrintHTML(
    'instant_quote', composeDocumentContent('instant_quote', j, { instantQuoteEngagement: '' }).content,
    photos, [], null, j.id, 'https://example.test', { client_name: 'Jo Smith', signatureBlock: true },
  )

  const without = print(job({}))
  assert.ok(without.includes('Basis of this quote'))
  assert.ok(without.includes(INSTANT_QUOTE_SCHEMA.basis.described))
  assert.ok(!without.includes(INSTANT_QUOTE_SCHEMA.photosHeading))
  assert.ok(!without.includes('client-1.jpg'))

  const withPhotos = print(job({ photo_ids: ['p1'] }))
  assert.ok(withPhotos.includes(INSTANT_QUOTE_SCHEMA.basis.withPhotos))
  assert.ok(withPhotos.includes(INSTANT_QUOTE_SCHEMA.photosHeading))
  assert.ok(withPhotos.includes('client-1.jpg'))
  assert.ok(withPhotos.includes('Main bedroom'))
  assert.ok(!withPhotos.includes('staff-2.jpg'))
  assert.ok(hasSignSlots(withPhotos))

  // A chosen photo that is no longer on the job leaves the quote described, not "with photos".
  const gone = print(job({ photo_ids: ['deleted'] }))
  assert.ok(gone.includes(INSTANT_QUOTE_SCHEMA.basis.described))
  assert.ok(!gone.includes(INSTANT_QUOTE_SCHEMA.photosHeading))
})
