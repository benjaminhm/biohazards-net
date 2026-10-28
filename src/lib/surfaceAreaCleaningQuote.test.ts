import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import { DEFAULT_ENGAGEMENT_AGREEMENT } from '@/lib/quoteEngagement'
import {
  defaultSurfaceAreaCleaningStandards,
  emptySurfaceAreaCleaningCapture,
  SURFACE_AREA_ROOM_PRESETS,
  roomSurfaceArea,
  roomsSurfaceTotal,
  presetRoomCount,
  setPresetRoomCount,
  surfaceAreaCleaningFigures,
  surfaceAreaCleaningQuoteContent,
} from '@/lib/surfaceAreaCleaningQuote'

test('average rooms add and remove rooms by count', () => {
  const bedroom = SURFACE_AREA_ROOM_PRESETS.find(room => room.id === 'bedroom')!
  const kitchen = SURFACE_AREA_ROOM_PRESETS.find(room => room.id === 'kitchen')!
  let rooms = setPresetRoomCount([], kitchen, 1)
  rooms = setPresetRoomCount(rooms, bedroom, 3)
  assert.deepEqual(rooms.map(room => room.name), ['Kitchen', 'Bedroom', 'Bedroom 2', 'Bedroom 3'])
  assert.equal(presetRoomCount(rooms, 'bedroom'), 3)
  rooms = setPresetRoomCount(rooms, bedroom, 1)
  assert.deepEqual(rooms.map(room => room.name), ['Kitchen', 'Bedroom'])
  rooms = setPresetRoomCount(rooms, kitchen, 0)
  assert.deepEqual(rooms.map(room => room.name), ['Bedroom'])
  assert.equal(roomsSurfaceTotal(rooms), 52.2)
})

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

test('presentation, objective, and scope print only when written', () => {
  const blank = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-NARRATIVE',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 20,
      labour_days: 1,
      presentation: '   ',
      objective: '',
      scope_of_work: '\n',
    },
  })
  assert.equal(blank.presentation, '')
  assert.equal(blank.objective, '')
  assert.equal(blank.scope_of_work, '')
  const blankHtml = buildPrintHTML(
    'surface_area_cleaning_quote',
    blank as unknown as Record<string, unknown>,
    [],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  assert.doesNotMatch(blankHtml, /class="label">Presentation/)
  assert.doesNotMatch(blankHtml, /class="label">Objective/)
  assert.doesNotMatch(blankHtml, /class="label">Scope of work/)

  const written = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-NARRATIVE',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 20,
      labour_days: 1,
      presentation: 'Heavy soiling through the living areas.',
      objective: 'Return the living areas to a clean condition.',
      scope_of_work: 'Clean floors, walls, and ceilings in the living areas.',
    },
  })
  const writtenHtml = buildPrintHTML(
    'surface_area_cleaning_quote',
    written as unknown as Record<string, unknown>,
    [],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  assert.match(writtenHtml, /class="label">Presentation/)
  assert.match(writtenHtml, /Heavy soiling through the living areas\./)
  assert.match(writtenHtml, /class="label">Objective/)
  assert.match(writtenHtml, /Return the living areas to a clean condition\./)
  assert.match(writtenHtml, /class="label">Scope of work/)
  assert.match(writtenHtml, /Clean floors, walls, and ceilings in the living areas\./)
})

test('a ticked hygienist adds the same lines as the biohazard quote, and an unticked one stays off', () => {
  const unticked = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-COH',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 5,
      rate_per_labour_day: 600,
      coh_rap_fee: 900,
      atp_tests: 6,
      atp_rate: 25,
      lab_tests: 3,
      lab_rate: 80,
    },
  })
  assert.equal(unticked.service_lines.length, 0)
  assert.equal(unticked.scope_of_work, '')
  assert.equal(unticked.total, 4400)
  assert.doesNotMatch(unticked.inclusions.join('\n'), /Hygienist|COH/)

  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-COH',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 5,
      rate_per_labour_day: 600,
      scope_of_work: 'Clean the living areas.',
      coh_rap: true,
      coh_rap_fee: 900,
      atp_testing: true,
      atp_tests: 6,
      atp_rate: 25,
      lab_testing: true,
      lab_tests: 3,
      lab_rate: 80,
    },
  })
  assert.equal(content.scope_of_work.startsWith('Before the works start, a Certified Occupational Hygienist'), true)
  assert.match(content.scope_of_work, /Clean the living areas\./)
  assert.match(content.scope_of_work, /verifies the decontamination by ATP surface testing and by laboratory testing/)
  assert.equal(content.inclusions.slice(-3).length, 3)
  assert.match(content.inclusions.join('\n'), /site inspection by a Certified Occupational Hygienist/)
  assert.deepEqual(
    content.service_lines.map(line => `${line.label}:${line.quantity}:${line.amount}`),
    [
      'Certified Occupational Hygienist: site inspection and written method:1:900',
      'ATP verification testing:6:150',
      'Laboratory testing:3:240',
    ],
  )
  assert.equal(content.subtotal, 5290)
  assert.equal(content.total, 5819)
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
  assert.match(html, /Certified Occupational Hygienist: site inspection and written method/)
  assert.match(html, /ATP verification testing/)
  assert.match(html, /Laboratory testing/)
  assert.match(html, /\$900\.00/)
  assert.match(html, /6 tests/)
  assert.match(html, /3 tests/)
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
      engagement_agreement: DEFAULT_ENGAGEMENT_AGREEMENT,
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
  assert.match(html, /The price is \$4,400\.00 including GST/)
  assert.match(html, /Estimated surface: 20 m²/)
  assert.match(html, /Surface rate: \$50\.00 ex GST/)
  assert.match(html, /Labour: 5 labour days for the fixed amount of \$3,000\.00 ex GST/)
  assert.match(html, /Deposit: \$2,200\.00/)
  assert.doesNotMatch(html, /Estimated contents/)
  assert.match(content.engagement_agreement, /\[name\]/)
})
