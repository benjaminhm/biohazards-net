import assert from 'node:assert/strict'
import test from 'node:test'
import { INSTANT_QUOTE_SCHEMA, instantQuoteContent, normalizeInstantQuoteCapture } from '@/lib/instantQuote'
import { DEFAULT_ENGAGEMENT_AGREEMENT, fillInstantQuoteEngagement } from '@/lib/quoteEngagement'
import { DEFAULT_XERO_SETTINGS } from './invoice'
import {
  FULL_FORM,
  XERO_QUOTE_LIMITS,
  fastQuoteBody,
  fastQuoteBodyProblems,
  plainText,
  sectionDescriptions,
  xeroQuoteUrl,
  type PartForm,
  type QuotePart,
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

interface BodyInput {
  inclusive?: boolean
  quoteId?: string
  parts?: Partial<Record<QuotePart, PartForm>>
  coded?: boolean
  typed?: boolean
}

function body(over: Record<string, unknown> = {}, input: BodyInput = {}) {
  const c = content(over)
  return fastQuoteBody({
    content: c,
    agreement: fillInstantQuoteEngagement(c, { companyName: 'Test Cleaning', date: '16 November 2026' }),
    inclusive: input.inclusive ?? true,
    parts: input.parts,
    coded: input.coded,
    typed: input.typed,
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
  const b = body({ price: 5000, price_includes_gst: false }, { inclusive: false })
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

  assert.ok(b.Summary?.startsWith(INSTANT_QUOTE_SCHEMA.basis.described))
  assert.ok(b.Summary?.includes('Job address: 1 Test St, Brisbane'))
  assert.ok(b.Summary?.includes(`Earliest start: Monday 23 November 2026. ${INSTANT_QUOTE_SCHEMA.startNote}`))
  assert.ok(b.Summary?.endsWith(c.presentation))

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

test('with no parts the quote is only the contact, the date and the price', () => {
  const bare = body({}, { parts: {} })
  assert.deepEqual(bare, {
    Status: 'DRAFT',
    Contact: { ContactID: 'contact-1' },
    Date: '2026-11-16',
    LineAmountTypes: 'INCLUSIVE',
    LineItems: [{ Description: 'Contents Clearance and Surface Cleaning', Quantity: 1, UnitAmount: 5500, AccountCode: '200', TaxType: 'OUTPUT' }],
  })
  // Without the account code, and without the status and amount type: Xero then reads the price as excluding GST.
  assert.deepEqual(body({}, { parts: {}, coded: false }).LineItems, [{ Description: 'Contents Clearance and Surface Cleaning', Quantity: 1, UnitAmount: 5500 }])
  const untyped = body({}, { parts: {}, coded: false, typed: false })
  assert.deepEqual(Object.keys(untyped).sort(), ['Contact', 'Date', 'LineItems'])
  assert.equal(untyped.LineItems[0].UnitAmount, 5000)
})

test('parts go on one at a time, and every part in full is the whole quote', () => {
  const whole = body()
  const parts: Partial<Record<QuotePart, PartForm>> = {}
  const built = (['title', 'summary', 'terms', 'scope', 'notes', 'agreement'] as const).map(part => {
    parts[part] = FULL_FORM
    return body({}, { parts: { ...parts } })
  })
  assert.deepEqual(Object.keys(built[0]).sort(), ['Contact', 'Date', 'LineAmountTypes', 'LineItems', 'Reference', 'Status', 'Title'])
  assert.equal(built[1].Summary, whole.Summary)
  assert.equal(built[1].Terms, undefined)
  assert.equal(built[2].Terms, whole.Terms)
  assert.equal(built[2].LineItems.length, 1)
  assert.deepEqual(built[3].LineItems, [whole.LineItems[0]])
  assert.deepEqual(built[4].LineItems, whole.LineItems.filter(line => !line.Description.startsWith('ENGAGEMENT AGREEMENT')))
  assert.deepEqual(built[5], whole)
  // A part left off is off, whatever comes after it.
  const noNotes = body({}, { parts: { scope: FULL_FORM, agreement: FULL_FORM } })
  assert.deepEqual(
    noNotes.LineItems,
    whole.LineItems.filter(line => !/^(Inclusions|Exclusions|Assumptions)\n/.test(line.Description)),
  )
})

test('a part in plain form has keyboard characters only, shorter lines hold less, and no word is lost', () => {
  assert.equal(plainText('• a — b ‘c’ “d” … ☐ ☑ é 5 m² ×\u00A02 \u200B☃'), "- a - b 'c' \"d\" ... [ ] [x] e 5 m2 x 2 ?")
  const whole = body({ scope_of_work: 'Remove the bed — and the “soft” items.\nMop the floor.' })
  const plain = body(
    { scope_of_work: 'Remove the bed — and the “soft” items.\nMop the floor.' },
    { parts: { title: FULL_FORM, summary: FULL_FORM, terms: FULL_FORM, scope: { plain: true, max: 4000 }, notes: { plain: false, max: 300 }, agreement: { plain: true, max: 900 } } },
  )
  assert.ok(plain.LineItems[0].Description.endsWith('\n- Remove the bed - and the "soft" items.\n- Mop the floor.'))
  const words = (lines: { Description: string }[], heading: RegExp) => lines
    .filter(line => heading.test(line.Description))
    .flatMap(line => line.Description.split('\n'))
    .filter(line => !/\(continued\)$/.test(line) && !heading.test(`${line}\n`))
    .join(' ').replace(/\s+/g, ' ')
  for (const heading of [/^Inclusions/, /^Exclusions/, /^Assumptions/]) {
    assert.equal(words(plain.LineItems, heading), words(whole.LineItems, heading))
    for (const line of plain.LineItems.filter(l => heading.test(l.Description))) assert.ok(line.Description.length <= 300)
  }
  const agreement = plain.LineItems.filter(line => line.Description.startsWith('ENGAGEMENT AGREEMENT'))
  assert.ok(agreement.length > 2)
  for (const line of agreement) {
    assert.ok(line.Description.length <= 900)
    assert.ok(/^[\n\x20-\x7E]*$/.test(line.Description))
  }
  assert.equal(words(agreement, /^ENGAGEMENT AGREEMENT/), plainText(words(whole.LineItems, /^ENGAGEMENT AGREEMENT/)))
})

test('client photos change the basis printed in the summary', () => {
  assert.ok(body({ photo_ids: ['p1'] }).Summary?.startsWith(INSTANT_QUOTE_SCHEMA.basis.withPhotos))
})

test('text too long for Xero is reported, not cut', () => {
  const long = body({ presentation: 'x'.repeat(3100), custom_title: 'T'.repeat(101) })
  const problems = fastQuoteBodyProblems(long)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /title is 1 characters too long/)
  assert.match(problems[1], /presentation is \d+ characters too long/)
  assert.ok(long.Summary?.includes('x'.repeat(3100)))
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
