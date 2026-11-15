import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import { CONTENTS_CLEARANCE_APPENDIX_AREA_REF, SURFACE_AREA_APPENDIX_AREA_REF } from '@/lib/photoGroups'
import { DEFAULT_ENGAGEMENT_AGREEMENT } from '@/lib/quoteEngagement'
import type { Photo } from '@/lib/types'
import {
  defaultSurfaceAreaCleaningStandards,
  emptySurfaceAreaCleaningCapture,
  applyRoomMeasure,
  mergeMeasuredRooms,
  nextRoomName,
  normalizeSurfaceAreaCleaningCapture,
  parseRoomMeasure,
  roomMeasureView,
  type SurfaceAreaRoom,
  normalizeSurfaceAreaCleaningStandards,
  SURFACE_AREA_ROOM_PRESETS,
  roomSurfaceArea,
  roomsSurfaceTotal,
  presetRoomCount,
  setPresetRoomCount,
  surfaceAreaCleaningFigures,
  surfaceAreaCleaningQuoteContent,
} from '@/lib/surfaceAreaCleaningQuote'

test('an empty company agreement is replaced by the default surface cleaning agreement', () => {
  assert.equal(normalizeSurfaceAreaCleaningStandards({ engagement_agreement: '' }).engagement_agreement, DEFAULT_ENGAGEMENT_AGREEMENT)
  assert.equal(normalizeSurfaceAreaCleaningStandards(null).engagement_agreement, DEFAULT_ENGAGEMENT_AGREEMENT)
})

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
  assert.doesNotMatch(html, /Other costs/)
  assert.match(html, /20 m²/)
  assert.match(html, /\$50\.00 \/ m²/)
  assert.doesNotMatch(html, /labour days?\b/i)
  assert.match(html, />Fixed</)
  assert.doesNotMatch(html, /A labour day = 1 person onsite for 1 day/)
  assert.match(html, /Labour, as the fixed amount on this quote\./)
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
  assert.equal(content.ceiling_m2, undefined)
  assert.equal(content.ceiling_note, '')
  assert.doesNotMatch(html, /Ceiling is excluded/)
})

test('excluding the ceiling removes it from the priced area and states it on the quote', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-CEILING',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      rate_per_m2: 10,
      labour_days: 1,
      rate_per_labour_day: 0,
      exclude_ceiling: true,
      rooms: [
        { id: 'a', name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 },
      ],
    },
  })
  assert.equal(content.ceiling_m2, 12)
  assert.equal(content.estimated_m2, 45.6)
  assert.equal(content.area_amount, 456)
  assert.equal(content.rooms[0]?.area_m2, 45.6)
  assert.equal(content.ceiling_note, 'Ceiling is excluded. The ceiling is 12 m² and is not included in the square metres on this quote.')
  assert.ok(content.exclusions.includes('The ceiling.'))
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
  assert.match(html, /Ceiling is excluded/)
  assert.match(html, /The ceiling is 12 m²/)
  assert.match(html, /45\.6 m²/)
  assert.match(html, /<li>The ceiling\.<\/li>/)
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

test('a custom title prints, and an other line is a title, description, and price ex GST', () => {
  const hidden = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-OTHER',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      cleaning_kind: 'custom',
      custom_title: '   ',
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 1,
      rate_per_labour_day: 0,
      other_lines: [{ id: 'blank', title: '  ', description: 'Not printed', price: 80 }],
    },
  })
  assert.equal(hidden.title, 'Surface Area Cleaning')
  assert.equal(hidden.other_lines.length, 0)
  assert.equal(hidden.subtotal, 1000)

  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-OTHER',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: {
      ...emptySurfaceAreaCleaningCapture(),
      cleaning_kind: 'custom',
      custom_title: 'Forensic clean',
      estimated_m2: 20,
      rate_per_m2: 50,
      labour_days: 1,
      rate_per_labour_day: 0,
      other_lines: [
        { id: 'a', title: 'Odour treatment', description: 'Ozone in the living room.', price: 250 },
        { id: 'b', title: 'Skip bin', description: '', price: 180 },
        { id: 'c', title: '', description: 'Not printed', price: 80 },
      ],
    },
  })
  assert.equal(content.title, 'Forensic clean')
  assert.equal(
    surfaceAreaCleaningQuoteContent({
      reference: 'SACQ-ADD',
      clientName: 'Acme Pty Ltd',
      siteAddress: '1 Example Street',
      capture: {
        ...emptySurfaceAreaCleaningCapture(),
        cleaning_kind: 'surface',
        title_addition: '  kitchen and bathroom  ',
      },
    }).title,
    'Surface Area Cleaning - kitchen and bathroom',
  )
  assert.equal(
    surfaceAreaCleaningQuoteContent({
      reference: 'SACQ-ADD',
      clientName: 'Acme Pty Ltd',
      siteAddress: '1 Example Street',
      capture: {
        ...emptySurfaceAreaCleaningCapture(),
        cleaning_kind: 'squalor',
        title_addition: '- unit 2',
      },
    }).title,
    'Gross Filth and Squalor - unit 2',
  )
  assert.deepEqual(content.other_lines, [
    { label: 'Odour treatment', description: 'Ozone in the living room.', amount: 250 },
    { label: 'Skip bin', description: '', amount: 180 },
  ])
  assert.equal(content.subtotal, 1430)
  assert.equal(content.total, 1573)
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
  assert.match(html, /class="sow-doc-title">Forensic clean</)
  assert.match(html, /Other costs/)
  assert.match(html, />Title</)
  assert.match(html, />Description</)
  assert.match(html, /Price \(ex GST\)/)
  assert.ok(html.indexOf('Fixed Rate Quotations') < html.indexOf('Other costs'))
  assert.match(html, /Odour treatment/)
  assert.match(html, /Ozone in the living room\./)
  assert.match(html, /Skip bin/)
  assert.match(html, /\$250\.00/)
  assert.match(html, /\$180\.00/)
  assert.match(html, /Other costs subtotal \(ex GST\)/)
  assert.doesNotMatch(html, /Not printed/)
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
  assert.match(html, /Labour: \$3,000\.00 ex GST/)
  assert.match(html, /Deposit: \$2,200\.00/)
  assert.doesNotMatch(html, /Estimated contents/)
  assert.match(content.engagement_agreement, /\[name\]/)
})

test('surface cleaning photos print before the engagement agreement, and another quote photo does not', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: emptySurfaceAreaCleaningCapture(),
    standards: {
      ...defaultSurfaceAreaCleaningStandards(),
      engagement_agreement: DEFAULT_ENGAGEMENT_AGREEMENT,
    },
  })
  const surfacePhoto: Photo = {
    id: 'sacq-photo',
    job_id: 'job',
    file_url: 'https://example.com/living-room.jpg',
    caption: 'Living room',
    area_ref: SURFACE_AREA_APPENDIX_AREA_REF,
    category: 'before',
    uploaded_at: '2026-09-30T00:00:00.000Z',
  }
  const clearancePhoto: Photo = {
    ...surfacePhoto,
    id: 'ccq-photo',
    file_url: 'https://example.com/clearance-only.jpg',
    caption: 'Clearance only',
    area_ref: CONTENTS_CLEARANCE_APPENDIX_AREA_REF,
  }
  const html = buildPrintHTML(
    'surface_area_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [surfacePhoto, clearancePhoto],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  assert.match(html, /living-room\.jpg/)
  assert.match(html, /Living room/)
  assert.match(html, />Photos</)
  assert.match(html, /Engagement agreement/)
  assert.ok(html.indexOf('living-room.jpg') < html.indexOf('Engagement agreement'))
  assert.ok(html.indexOf('Engagement agreement') < html.indexOf('Acceptance'))
  assert.doesNotMatch(html, /clearance-only\.jpg/)
})

function room(id: string, name: string, l: number | null = 4, w: number | null = 3, h: number | null = 2.4): SurfaceAreaRoom {
  return { id, name, length_m: l, width_m: w, height_m: h, preset_id: null }
}

test('a room measured on the phone needs a name and three sizes in metres', () => {
  assert.deepEqual(parseRoomMeasure({ name: '  Main   bedroom ', length_m: '4.004', width_m: 3.6, height_m: '2.4' }), {
    id: null, name: 'Main bedroom', length_m: 4, width_m: 3.6, height_m: 2.4,
  })
  assert.equal((parseRoomMeasure({ id: 'room_1', name: 'Hall', length_m: 6, width_m: 1.2, height_m: 2.4 }) as { id: string }).id, 'room_1')
  assert.equal(parseRoomMeasure({ name: ' ', length_m: 4, width_m: 3, height_m: 2.4 }), 'Give the room a name.')
  assert.equal(parseRoomMeasure({ name: 'x'.repeat(61), length_m: 4, width_m: 3, height_m: 2.4 }), 'Keep the room name to 60 characters.')
  assert.equal(parseRoomMeasure({ name: 'Hall', length_m: '', width_m: 3, height_m: 2.4 }), 'Enter the length in metres.')
  assert.equal(parseRoomMeasure({ name: 'Hall', length_m: 4, width_m: 'wide', height_m: 2.4 }), 'Enter the width in metres.')
  assert.equal(parseRoomMeasure({ name: 'Hall', length_m: 4, width_m: 3 }), 'Enter the height in metres.')
  assert.match(String(parseRoomMeasure({ name: 'Hall', length_m: 0, width_m: 3, height_m: 2.4 })), /length must be more than 0/)
  assert.match(String(parseRoomMeasure({ name: 'Hall', length_m: 4, width_m: -3, height_m: 2.4 })), /width must be more than 0/)
  assert.match(String(parseRoomMeasure({ name: 'Hall', length_m: 4, width_m: 3, height_m: 100.01 })), /height must be more than 0 and no more than 100 m/)
  assert.match(String(parseRoomMeasure({ name: 'Hall', length_m: 0.004, width_m: 3, height_m: 2.4 })), /length must be more than 0/)
  assert.equal(parseRoomMeasure(null), 'Give the room a name.')
})

test('a measured room is added to the quote and the square metres follow', () => {
  const start = { ...emptySurfaceAreaCleaningCapture(), rate_per_m2: 12, labour_days: 2, estimated_m2: 80 }
  const first = applyRoomMeasure(start, { id: null, name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 })
  assert.ok(typeof first !== 'string')
  assert.equal(first.capture.rooms.length, 1)
  assert.equal(first.room.name, 'Bedroom')
  // Floor 12, ceiling 12, walls 2 × (4 + 3) × 2.4 = 33.6.
  assert.equal(first.capture.estimated_m2, 57.6)
  // Nothing else on the quote moves.
  assert.equal(first.capture.rate_per_m2, 12)
  assert.equal(first.capture.labour_days, 2)

  const second = applyRoomMeasure(first.capture, { id: null, name: 'Hall', length_m: 6, width_m: 1.2, height_m: 2.4 })
  assert.ok(typeof second !== 'string')
  assert.deepEqual(second.capture.rooms.map(r => r.name), ['Bedroom', 'Hall'])
  assert.notEqual(second.room.id, first.room.id)
  assert.equal(second.capture.estimated_m2, 106.56)
})

test('with the ceiling excluded, a measured room adds its floor and walls only', () => {
  const start = { ...emptySurfaceAreaCleaningCapture(), exclude_ceiling: true }
  const applied = applyRoomMeasure(start, { id: null, name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 })
  assert.ok(typeof applied !== 'string')
  assert.equal(applied.capture.estimated_m2, 45.6)
  assert.equal(applied.capture.exclude_ceiling, true)
})

test('measuring a room already on the quote replaces its name and size in place', () => {
  const bedroom = SURFACE_AREA_ROOM_PRESETS.find(preset => preset.id === 'bedroom')!
  const rooms = [...setPresetRoomCount([], bedroom, 2), room('r3', 'Hall', 6, 1.2, 2.4)]
  const start = { ...emptySurfaceAreaCleaningCapture(), rooms }
  const applied = applyRoomMeasure(start, { id: rooms[1].id, name: 'Back bedroom', length_m: 3.2, width_m: 2.9, height_m: 2.7 })
  assert.ok(typeof applied !== 'string')
  assert.deepEqual(applied.capture.rooms.map(r => r.name), ['Bedroom', 'Back bedroom', 'Hall'])
  assert.deepEqual(applied.capture.rooms.map(r => r.id), rooms.map(r => r.id))
  assert.equal(applied.capture.rooms[1].length_m, 3.2)
  assert.equal(applied.capture.rooms[1].height_m, 2.7)
  // An average room keeps its tick on the quote.
  assert.equal(presetRoomCount(applied.capture.rooms, 'bedroom'), 2)
  assert.equal(applied.capture.estimated_m2, roomsSurfaceTotal(applied.capture.rooms))
})

test('a measure for a room no longer on the quote is kept as a new room', () => {
  const start = { ...emptySurfaceAreaCleaningCapture(), rooms: [room('r1', 'Kitchen')] }
  const applied = applyRoomMeasure(start, { id: 'gone', name: 'Laundry', length_m: 2.2, width_m: 1.8, height_m: 2.4 })
  assert.ok(typeof applied !== 'string')
  assert.deepEqual(applied.capture.rooms.map(r => r.name), ['Kitchen', 'Laundry'])
  assert.notEqual(applied.room.id, 'gone')
})

test('the phone link stops adding rooms at 100, and can still resize one', () => {
  const rooms = Array.from({ length: 100 }, (_, i) => room(`r${i}`, `Room ${i + 1}`))
  const start = { ...emptySurfaceAreaCleaningCapture(), rooms }
  assert.equal(applyRoomMeasure(start, { id: null, name: 'One more', length_m: 4, width_m: 3, height_m: 2.4 }), 'This quote already has 100 rooms.')
  assert.ok(typeof applyRoomMeasure(start, { id: 'r5', name: 'Room 6', length_m: 5, width_m: 3, height_m: 2.4 }) !== 'string')
})

test('the phone is shown the rooms and their square metres, and nothing about price', () => {
  const capture = normalizeSurfaceAreaCleaningCapture({
    rate_per_m2: 14.5, rate_per_labour_day: 880, labour_days: 3, mobilisation_fee: 250, scope_of_work: 'Clean all surfaces.',
    rooms: [{ id: 'r1', name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 }, { id: 'r2', name: 'Hall', length_m: null, width_m: null, height_m: null }],
  })
  const view = roomMeasureView(capture)
  assert.deepEqual(view, {
    rooms: [
      { id: 'r1', name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4, area_m2: 57.6 },
      { id: 'r2', name: 'Hall', length_m: null, width_m: null, height_m: null, area_m2: null },
    ],
    exclude_ceiling: false,
    total_m2: 57.6,
  })
  assert.ok(!/14\.5|880|250|Clean all/.test(JSON.stringify(view)))
  assert.equal(roomMeasureView({ ...capture, exclude_ceiling: true }).rooms[0].area_m2, 45.6)
})

test('a room name tapped twice gets the next number', () => {
  assert.equal(nextRoomName('Bedroom', []), 'Bedroom')
  assert.equal(nextRoomName('Bedroom', ['bedroom ', 'Kitchen']), 'Bedroom 2')
  assert.equal(nextRoomName('Bedroom', ['Bedroom', 'Bedroom 2', 'Bedroom 4']), 'Bedroom 3')
})

test('rooms measured on the phone merge into an open quote without losing edits made there', () => {
  const base = [room('r1', 'Bedroom'), room('r2', 'Kitchen'), room('r3', 'Hall')]
  const local = [
    room('r1', 'Bedroom'),                 // untouched on the laptop
    room('r2', 'Kitchen', 5, 3.2, 2.4),    // edited on the laptop
    room('new', 'Study', null, null, null), // added on the laptop, not saved (r3 was removed there)
  ]
  const remote = [
    room('r1', 'Bedroom', 3.4, 3.1, 2.7),  // resized on the phone
    room('r2', 'Kitchen', 4.2, 3, 2.4),    // also resized on the phone
    room('r3', 'Hall'),
    room('p1', 'Laundry', 2.2, 1.8, 2.4),  // added on the phone
  ]
  assert.deepEqual(mergeMeasuredRooms(base, local, remote), [
    room('r1', 'Bedroom', 3.4, 3.1, 2.7),
    room('r2', 'Kitchen', 5, 3.2, 2.4),
    room('new', 'Study', null, null, null),
    room('p1', 'Laundry', 2.2, 1.8, 2.4),
  ])
})

test('merging is stable: an open quote with no edits ends up as the saved rooms, and merging again changes nothing', () => {
  const base = [room('r1', 'Bedroom')]
  const remote = [room('r1', 'Bedroom', 3.4, 3.1, 2.7), room('p1', 'Laundry', 2.2, 1.8, 2.4)]
  const once = mergeMeasuredRooms(base, base, remote)
  assert.deepEqual(once, remote)
  assert.deepEqual(mergeMeasuredRooms(remote, once, remote), remote)
  // A room saved without a preset id is the same room as one saved with a null preset id.
  const bare = [{ id: 'r1', name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 }]
  assert.deepEqual(mergeMeasuredRooms(bare, [room('r1', 'Bedroom')], remote), remote)
})
