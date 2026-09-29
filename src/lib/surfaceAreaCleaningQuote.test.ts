import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  defaultSurfaceAreaCleaningStandards,
  emptySurfaceAreaCleaningCapture,
  SURFACE_AREA_ROOM_PRESETS,
  roomSurfaceArea,
  roomsSurfaceTotal,
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
  assert.equal(
    surfaceAreaCleaningQuoteContent({
      reference: 'SACQ-ESTATE',
      clientName: 'Acme Pty Ltd',
      siteAddress: '1 Example Street',
      capture: { ...emptySurfaceAreaCleaningCapture(), cleaning_kind: 'estate' },
    }).title,
    'Estate Cleaning',
  )
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
  assert.match(html, /accurate onsite measurement survey/)
  assert.equal(content.total, 4510)
})

test('a waived mobilisation fee prints the reason and is not charged', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 5,
      rate_per_labour_day: 600,
      mobilisation_fee: 100,
      mobilisation_waived: true,
      mobilisation_reason: 'No call-out charge, as already onsite for the hoarding removal.',
    },
  })
  assert.equal(content.mobilisation_fee, 0)
  assert.equal(content.total, 4400)
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
  assert.match(html, /already onsite for the hoarding removal/)
  assert.doesNotMatch(html, /\$100\.00/)
})

test('length, width, and height estimate the room surface', () => {
  const measure = roomSurfaceArea({ length_m: 4, width_m: 3, height_m: 2.4 })
  assert.equal(measure?.floor, 12)
  assert.equal(measure?.ceiling, 12)
  assert.equal(measure?.walls, 33.6)
  assert.equal(measure?.total, 57.6)
  const sized = (id: string) => {
    const preset = SURFACE_AREA_ROOM_PRESETS.find(room => room.id === id)
    if (!preset) throw new Error(id)
    return { id, name: preset.name, length_m: preset.length_m, width_m: preset.width_m, height_m: preset.height_m }
  }
  assert.equal(roomsSurfaceTotal([sized('bedroom'), sized('bathroom')]), 79.32)
})

test('the quote uses the room total and lists each room', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-ROOMS',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 1,
      rate_per_m2: 10,
      labour_days: 1,
      rate_per_labour_day: 0,
      rooms: [
        { id: 'a', name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 },
      ],
    },
  })
  assert.equal(content.estimated_m2, 57.6)
  assert.equal(content.rooms[0]?.detail, '4 × 3 × 2.4 m')
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
  assert.match(html, /Bedroom 4 × 3 × 2\.4 m/)
  assert.match(html, /57\.6 m²/)
})

test('engagement brackets are filled on the surface cleaning document', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 5,
      rate_per_labour_day: 600,
    },
    standards: {
      ...defaultSurfaceAreaCleaningStandards(),
      engagement_agreement: 'For [name], [surface], [labour days], total [total]. [volume]',
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
  assert.match(html, /For Acme Pty Ltd, 20 m², 5 labour days, total \$4,400\.00\./)
  assert.doesNotMatch(html, /\[volume\]/)
  assert.match(content.engagement_agreement, /\[name\]/)
})
