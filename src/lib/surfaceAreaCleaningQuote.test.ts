import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  emptySurfaceAreaCleaningCapture,
  surfaceAreaCleaningFigures,
  surfaceAreaCleaningQuoteContent,
} from '@/lib/surfaceAreaCleaningQuote'

test('20 square metres at $50 and 5 labour days at $600', () => {
  const figures = surfaceAreaCleaningFigures(20, { ratePerM2: 50, ratePerLabourDay: 600 }, { labourDays: 5 })
  assert.equal(figures.area_amount, 1000)
  assert.equal(figures.labour_amount, 3000)
  assert.equal(figures.subtotal, 4000)
  assert.equal(figures.gst, 400)
  assert.equal(figures.total, 4400)
  assert.equal(figures.lines.find(line => line.label === 'Labour')?.unit, 'labour days')
})

test('the cleaning quote prints square metres, then fixed labour', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      cleaning_kind: 'squalor',
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 5,
      rate_per_labour_day: 600,
      mobilisation_fee: 100,
    },
  })
  const html = buildPrintHTML(
    'surface_area_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  assert.equal(content.title, 'Gross Filth and Squalor')
  assert.match(html, /class="sow-doc-title">Gross Filth and Squalor</)
  assert.doesNotMatch(html, /sow-doc-title">[^<]*Quote/)
  assert.match(html, /Estimated quantities/)
  assert.match(html, /Fixed Rate Quotations/)
  assert.match(html, /20 m²/)
  assert.match(html, /\$50\.00 \/ m²/)
  assert.match(html, /5 labour days/)
  assert.match(html, />Fixed</)
  assert.match(html, /A labour day = 1 person onsite for 1 day/)
  assert.match(html, /Mobilisation/)
  assert.match(html, /1 Example Street/)
  assert.doesNotMatch(html, /Tip address/)
  assert.doesNotMatch(html, /\/ labour day/)
  assert.equal(content.total, 4510)
})
