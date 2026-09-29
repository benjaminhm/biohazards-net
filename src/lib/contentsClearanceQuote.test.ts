import assert from 'node:assert/strict'
import test from 'node:test'
import { contentsClearanceFigures, contentsClearanceQuoteContent } from '@/lib/contentsClearanceQuote'
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

test('the quote prints quantities, then clauses, terms, authority, and acceptance', () => {
  const content = contentsClearanceQuoteContent({
    reference: 'CCQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    m3: 18,
    km: 12,
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
  assert.deepEqual(labels, ['Quantities', 'Inclusions', 'Exclusions', 'Assumptions', 'Terms', 'Authority', 'Acceptance'])
  assert.match(html, /Acme Pty Ltd/)
  assert.match(html, /1 Example Street/)
  assert.equal(content.labour_days, 3)
})
