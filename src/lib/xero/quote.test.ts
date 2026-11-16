import assert from 'node:assert/strict'
import test from 'node:test'
import { INSTANT_QUOTE_SCHEMA, instantQuoteContent, normalizeInstantQuoteCapture } from '@/lib/instantQuote'
import { DEFAULT_ENGAGEMENT_AGREEMENT, fillInstantQuoteEngagement } from '@/lib/quoteEngagement'
import { DEFAULT_XERO_SETTINGS } from './invoice'
import {
  XERO_QUOTE_LIMITS,
  fastQuoteBody,
  fastQuoteBodyProblems,
  sectionDescriptions,
  xeroQuoteUrl,
} from './quote'

function content(over: Record<string, unknown> = {}) {
  return instantQuoteContent({
    reference: 'FQ-20261116-1234',
    clientName: 'Jo Smith',
    siteAddress: '1 Test St, Brisbane',
    capture: normalizeInstantQuoteCapture({
      services: ['contents', 'surface'],
      presentation: 'The client reports a two-bedroom unit to be cleared and cleaned.',
      scope_of_work: 'Remove the contents of both bedrooms.\nVacuum, then wet-mop the floors with a neutral detergent.',
      job_exclusions: 'The garage.',
      job_assumptions: 'The client reports the unit is on the ground floor.',
      price: 5500,
      earliest_start: '2026-11-23',
      ...over,
    }),
    engagementAgreement: DEFAULT_ENGAGEMENT_AGREEMENT,
  })
}

function body(over: Record<string, unknown> = {}, input: { priceIncludesGst?: boolean; quoteId?: string } = {}) {
  const c = content(over)
  return fastQuoteBody({
    content: c,
    agreement: fillInstantQuoteEngagement(c, { companyName: 'Test Cleaning', date: '16 November 2026' }),
    priceIncludesGst: input.priceIncludesGst ?? true,
    contactId: 'contact-1',
    settings: DEFAULT_XERO_SETTINGS,
    date: '2026-11-16',
    quoteId: input.quoteId,
  })
}

test('a fast quote goes to Xero as a draft with one priced line', () => {
  const b = body()
  assert.equal(b.Status, 'DRAFT')
  assert.equal(b.QuoteID, undefined)
  assert.deepEqual(b.Contact, { ContactID: 'contact-1' })
  assert.equal(b.Date, '2026-11-16')
  assert.equal(b.Reference, 'FQ-20261116-1234')
  assert.equal(b.Title, 'Contents Clearance and Surface Cleaning')
  const priced = b.LineItems.filter(line => line.UnitAmount != null)
  assert.equal(priced.length, 1)
  assert.deepEqual(
    { Quantity: priced[0].Quantity, UnitAmount: priced[0].UnitAmount, AccountCode: priced[0].AccountCode, TaxType: priced[0].TaxType },
    { Quantity: 1, UnitAmount: 5500, AccountCode: '200', TaxType: 'OUTPUT' },
  )
  assert.equal(b.LineAmountTypes, 'INCLUSIVE')
  assert.deepEqual(fastQuoteBodyProblems(b), [])
})

test('a price typed excluding GST is sent as an exclusive line', () => {
  const b = body({ price: 5000, price_includes_gst: false }, { priceIncludesGst: false })
  assert.equal(b.LineAmountTypes, 'EXCLUSIVE')
  assert.equal(b.LineItems[0].UnitAmount, 5000)
})

test('the scope and every term of the printed quote are on the Xero quote', () => {
  const c = content()
  const b = body()
  const lines = b.LineItems.map(line => line.Description)
  const all = [b.Summary, ...lines, b.Terms].join('\n')

  assert.ok(lines[0].startsWith('Contents Clearance and Surface Cleaning: the scope of work on this quote\n'))
  for (const step of c.scope_of_work.split('\n')) assert.ok(lines[0].includes(`• ${step}`))
  for (const line of [...c.inclusions, ...c.exclusions, ...c.assumptions]) assert.ok(all.includes(`• ${line}`), line)
  assert.ok(lines.some(line => line.startsWith('Exclusions\n') && line.includes('• The garage.')))

  assert.ok(b.Summary.startsWith(INSTANT_QUOTE_SCHEMA.basis.described))
  assert.ok(b.Summary.includes('Job address: 1 Test St, Brisbane'))
  assert.ok(b.Summary.includes(`Earliest start: Monday 23 November 2026. ${INSTANT_QUOTE_SCHEMA.startNote}`))
  assert.ok(b.Summary.endsWith(c.presentation))

  assert.equal(b.Terms, `Payment terms\n${c.terms}\n\nAuthority\n${c.authority}\n\nAcceptance\n${c.acceptance}`)

  // Every line of the filled agreement, in order, under one heading.
  const agreement = fillInstantQuoteEngagement(c, { companyName: 'Test Cleaning', date: '16 November 2026' })
    .split('\n').map(line => line.trim()).filter(Boolean)
  const onQuote = lines.filter(line => line.startsWith('ENGAGEMENT AGREEMENT')).join('\n').split('\n')
    .filter(line => line !== 'ENGAGEMENT AGREEMENT (continued)')
  assert.deepEqual(onQuote, agreement)
  assert.ok(all.includes('The price is $5,500.00 including GST.'))
  assert.ok(all.includes('quote FQ-20261116-1234, dated 16 November 2026'))
})

test('no description is longer than Xero takes, and long sections carry on', () => {
  const b = body()
  for (const line of b.LineItems) assert.ok(line.Description.length <= XERO_QUOTE_LIMITS.description)
  // The default agreement is longer than one line holds.
  assert.equal(b.LineItems.filter(line => line.Description.startsWith('ENGAGEMENT AGREEMENT')).length, 2)

  assert.deepEqual(
    sectionDescriptions('Scope', ['aaaa bbbb', 'cccc', 'dddd'], { max: 30 }),
    ['Scope\n• aaaa bbbb\n• cccc', 'Scope (continued)\n• dddd'],
  )
  // One line longer than a description holds is cut at a space, with nothing lost.
  assert.deepEqual(sectionDescriptions('S', ['aaaaa bbbbb ccccc'], { max: 30, bullet: '' }), ['S\naaaaa bbbbb\nccccc'])
  assert.deepEqual(sectionDescriptions('Inclusions', []), [])
})

test('client photos change the basis printed in the summary', () => {
  assert.ok(body({ photo_ids: ['p1'] }).Summary.startsWith(INSTANT_QUOTE_SCHEMA.basis.withPhotos))
})

test('text too long for Xero is reported, not cut', () => {
  const long = body({ presentation: 'x'.repeat(3100), custom_title: 'T'.repeat(101) })
  const problems = fastQuoteBodyProblems(long)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /title is 1 characters too long/)
  assert.match(problems[1], /presentation is \d+ characters too long/)
  assert.ok(long.Summary.includes('x'.repeat(3100)))
})

test('updating a draft names the quote, and the link opens it in Xero', () => {
  assert.equal(body({}, { quoteId: 'q-1' }).QuoteID, 'q-1')
  assert.equal(xeroQuoteUrl(' 1b2c '), 'https://go.xero.com/Accounts/Receivable/Quotes/View/1b2c')
})

test('the Xero quote reference is kept on the capture and stays off the composed quote', () => {
  const capture = normalizeInstantQuoteCapture({ xero_quote: { id: ' q-1 ', number: 'QU-0042', status: 'DRAFT' } })
  assert.deepEqual(capture.xero_quote, { id: 'q-1', number: 'QU-0042', status: 'DRAFT' })
  assert.equal(normalizeInstantQuoteCapture({ xero_quote: { number: 'QU-0042' } }).xero_quote, undefined)
  assert.ok(!('xero_quote' in content({ xero_quote: { id: 'q-1', number: 'QU-0042', status: 'DRAFT' } })))
})
