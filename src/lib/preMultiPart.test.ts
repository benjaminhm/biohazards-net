import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssessmentData, Photo, PostRemediationEvaluationContent, PostRemediationEvaluationV2, PrePart } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'
import { makeBlankPreV2, quoteScopeSummary, resolvePreV2Parts } from '@/lib/postRemediationEvaluations'
import { prePartSources } from '@/lib/preVerifiedRecords'
import { partsReportOutline } from '@/lib/preReportOutline'
import { surveyAreasFromRectangles } from '@/lib/houseSurvey'

function part(patch: Partial<PrePart>): PrePart {
  return { enabled: true, works_rows: [], products_rows: [], waste: {}, ...patch }
}

function pre(parts: PostRemediationEvaluationV2['parts'], patch: Partial<PostRemediationEvaluationV2> = {}): PostRemediationEvaluationV2 {
  return { id: 'prev2_1', parts, created_at: '2026-11-05T00:00:00.000Z', updated_at: '2026-11-05T00:00:00.000Z', ...patch }
}

const TIP = 'Brisbane Transfer Station, 1 Tip Rd'

function job(patch: Partial<AssessmentData> = {}): AssessmentData {
  return {
    contents_clearance_quote: { estimated_m3: 30, rate_per_m3: 85, tip_address: 'Quote Tip Rd' },
    surface_area_cleaning_quote: { rooms: [{ id: 'r1', name: 'Kitchen', length_m: 9, width_m: 9, height_m: 3 }] },
    disposal_manifest_capture: {
      loads: [
        { date: '2026-11-03', facility: TIP, vehicles: [{ type: 'trailer', length_m: 2, width_m: 1.5, height_m: 1 }] },
        {
          date: '2026-11-04',
          facility: TIP,
          vehicles: [{ type: 'trailer', length_m: 2, width_m: 1.5, height_m: 1 }, { type: 'ute', length_m: 2, width_m: 1, height_m: 0.5 }],
        },
      ],
    },
    house_survey: {
      areas: surveyAreasFromRectangles([
        { name: 'Kitchen', length_m: 4, width_m: 3, height_m: 2.5 },
        { name: 'Bedroom', length_m: 3, width_m: 3, height_m: 2.5 },
      ]),
      price_per_m2: 12,
    },
    ...patch,
  } as unknown as AssessmentData
}

function html(content: PostRemediationEvaluationContent): string {
  return buildPrintHTML('report', content as unknown as Record<string, unknown>, [], [], null, 'job', 'http://localhost', undefined, {
    screenActionBar: false,
  })
}

function report(parts: PostRemediationEvaluationContent['parts'], patch: Partial<PostRemediationEvaluationContent> = {}): PostRemediationEvaluationContent {
  return {
    title: 'Completion Report',
    reference: 'RPT-1',
    source_quote_document_id: '',
    report_format: 'parts_v1',
    parts,
    scope_lines: [],
    include_photos: false,
    ...patch,
  }
}

test('sections are chosen by records, not quotes', () => {
  const blank = makeBlankPreV2(
    [{ id: 'ccq1', type: 'contents_clearance_quote', content: {}, created_at: '2026-11-01T00:00:00.000Z' }],
    job(),
  )
  assert.equal(blank.parts.b.enabled, true)
  assert.equal(blank.parts.b.source_quote_document_id, undefined)
  assert.equal(blank.parts.c.enabled, true)
  assert.equal(blank.parts.a.enabled, false)

  const noRecords = makeBlankPreV2(
    [{ id: 'ccq1', type: 'contents_clearance_quote', content: {}, created_at: '2026-11-01T00:00:00.000Z' }],
    job({ disposal_manifest_capture: { loads: [{}] }, house_survey: { areas: [{}] } } as unknown as AssessmentData),
  )
  assert.equal(noRecords.parts.b.enabled, false)
  assert.equal(noRecords.parts.c.enabled, false)
})

test('a section without its record is left out even when written and switched on', () => {
  const ad = job({ disposal_manifest_capture: undefined })
  const resolved = resolvePreV2Parts(pre({ a: part({ enabled: false }), b: part({ methodology: 'Removed contents.' }), c: part({}) }), ad)
  assert.deepEqual(resolved.map(p => p.key), ['c'])
})

test('Biohazard Cleaning: record when it exists, nothing when an area-priced BCQ has no record, the quote path when fixed price', () => {
  const priced = { estimated_m2: 10, rate_per_m2: 40, rooms: [{ id: 'z', name: 'bedroom' }] }
  assert.equal(prePartSources(job({ biohazard_cleaning_quote: priced } as unknown as AssessmentData)).a, null)
  const withRecord = job({ biohazard_cleaning_quote: priced, biohazard_cleaning_record: { primary_m2: 8, atp_tests: 2 } } as unknown as AssessmentData)
  assert.equal(prePartSources(withRecord).a, 'record')
  const [a] = resolvePreV2Parts(pre({ a: part({}), b: part({ enabled: false }), c: part({ enabled: false }) }), withRecord)
  assert.deepEqual(a.measured_rows, [
    { label: 'Primary zone: bedroom', value: '8 m²' },
    { label: 'ATP tests done', value: '2' },
  ])

  const fixed = job({ biohazard_cleaning_quote: { fixed_price: 2000 } } as unknown as AssessmentData)
  assert.equal(prePartSources(fixed).a, 'fixed_price')
  const blank = makeBlankPreV2(
    [{ id: 'bcq1', type: 'biohazard_cleaning_quote', content: { title: 'Biohazard Cleaning Quote', reference: 'BCQ-1' }, created_at: '2026-11-01T00:00:00.000Z' }],
    fixed,
  )
  assert.equal(blank.parts.a.enabled, true)
  assert.equal(blank.parts.a.source_quote_document_id, 'bcq1')
})

test('printed report numbers sections in order with no gaps, no letters, no Part, and no quote figures', () => {
  const ad = job()
  const parts = resolvePreV2Parts(
    pre({
      a: part({ enabled: false }),
      b: part({ methodology: 'Bagged and loaded contents.', waste: { volume: 'Estimated 30 cubic metres; actual measured volume to be confirmed', containment: 'Sealed bags' } }),
      c: part({ outcome_verification: 'All rooms wiped down.' }),
    }),
    ad,
  )
  const out = html(report(parts, {
    executive_summary: 'Whole job summary.',
    site_conditions: ['Strong odour.'],
    recommendations: ['Replace carpet.'],
    limitations: 'Roof cavity not accessed.',
  }))

  const order = [
    '01 · Executive Summary',
    '02 · Site Conditions on Attendance',
    '03 · Contents Clearance',
    '3.1 · Methodology',
    '3.2 · Waste Management &amp; Disposal',
    '04 · Surface Area Cleaning',
    '4.1 · Works Undertaken',
    '4.2 · Outcome &amp; Verification',
    '05 · Recommendations',
    '06 · Limitations &amp; Scope Notice',
  ].map(h => out.indexOf(h))
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `headings out of order: ${order}`)

  assert.match(out, /Volume removed[\s\S]*?7 m³ over 2 loads/)
  assert.match(out, /Load 2[\s\S]*?4 Nov 2026 · Trailer, Ute/)
  assert.ok(out.includes(TIP))
  assert.match(out, /Kitchen[\s\S]*?59 m²/)
  assert.match(out, /Bedroom[\s\S]*?48 m²/)
  assert.match(out, /Total surface area cleaned[\s\S]*?107 m²/)
  assert.ok(out.includes('Sealed bags'))

  assert.equal(/\bPart\b/.test(out), false)
  assert.equal(/>[ABC]\d? · /.test(out), false)
  for (const banned of ['Quoted', 'Estimated', 'estimated', 'Reporting against', 'Linked quote', '30 m³', '30 cubic', 'Quote Tip Rd']) {
    assert.equal(out.includes(banned), false, banned)
  }
  assert.equal(/\$\s?\d/.test(out), false)
})

test('numbering starts at 01 with whatever whole-job section comes first', () => {
  const parts = resolvePreV2Parts(pre({ a: part({ enabled: false }), b: part({ enabled: false }), c: part({}) }), job())
  const o = partsReportOutline(report(parts, { site_conditions: ['Clutter.'], compliance: 'Done to standard.' }))
  assert.equal(o.executive_summary, undefined)
  assert.equal(o.site_conditions, '01')
  assert.deepEqual(o.parts.map(p => [p.n, p.part.title, p.subs.map(s => `${s.n} ${s.title}`)]), [
    ['02', 'Surface Area Cleaning', ['2.1 Works Undertaken']],
  ])
  assert.equal(o.compliance, '03')
})

test('an older saved report with quote fields prints without them', () => {
  const legacy = [{
    key: 'b',
    letter: 'B',
    title: 'Contents Clearance',
    source_quote_label: 'Contents Clearance Quote',
    source_quote_reference: 'CCQ-9',
    quoted_volume_m3: 30,
    actual_volume_m3: '14 m³',
    methodology: 'Removed contents.',
  }] as unknown as PostRemediationEvaluationContent['parts']
  const out = html(report(legacy))
  assert.match(out, /01 · Contents Clearance/)
  assert.match(out, /1\.1 · Methodology/)
  for (const banned of ['CCQ-9', 'Reporting against', 'Linked quotes', 'Quoted volume', 'B · ']) assert.equal(out.includes(banned), false, banned)
})

function photo(id: string, patch: Partial<Photo> = {}): Photo {
  return {
    id,
    job_id: 'job',
    file_url: `https://cdn.test/${id}.jpg`,
    caption: `Caption ${id}`,
    area_ref: '',
    category: 'after',
    capture_phase: 'progress',
    uploaded_at: '2026-11-05T00:00:00.000Z',
    ...patch,
  }
}

const withPhotos = (content: PostRemediationEvaluationContent, photos: Photo[]) =>
  buildPrintHTML('report', content as unknown as Record<string, unknown>, photos, [], null, 'job', 'http://localhost', undefined, {
    screenActionBar: false,
  })

test('Before and After Remediation are numbered after the parts and before Recommendations', () => {
  const parts = resolvePreV2Parts(pre({ a: part({ enabled: false }), b: part({ enabled: false }), c: part({}) }), job())
  const photos = [photo('b1', { category: 'before', capture_phase: 'assessment' }), photo('a1')]
  const base = { executive_summary: 'Summary.', recommendations: ['Replace carpet.'], include_photos: true }

  const none = partsReportOutline(report(parts, base), photos)
  assert.deepEqual([none.executive_summary, none.parts[0].n, none.before_photos, none.after_photos, none.recommendations], ['01', '02', undefined, undefined, '03'])

  const both = partsReportOutline(report(parts, { ...base, before_photo_ids: ['b1'], after_photo_ids: ['a1'] }), photos)
  assert.deepEqual([both.parts[0].n, both.before_photos, both.after_photos, both.recommendations], ['02', '03', '04', '05'])

  const afterOnly = partsReportOutline(report(parts, { ...base, before_photo_ids: ['gone'], after_photo_ids: ['a1'] }), photos)
  assert.deepEqual([afterOnly.before_photos, afterOnly.after_photos, afterOnly.recommendations], [undefined, '03', '04'])

  const off = partsReportOutline(report(parts, { ...base, include_photos: false, before_photo_ids: ['b1'] }), photos)
  assert.equal(off.before_photos, undefined)
})

test('printed report shows Before and After Remediation photos in the chosen order instead of the appendix', () => {
  const parts = resolvePreV2Parts(pre({ a: part({ enabled: false }), b: part({ enabled: false }), c: part({}) }), job())
  const photos = [
    photo('b1', { category: 'before', capture_phase: 'assessment' }),
    photo('b2', { category: 'before', capture_phase: 'assessment', include_in_composed_reports: false }),
    photo('a1'),
    photo('a2'),
    photo('extra'),
  ]
  const out = withPhotos(report(parts, {
    include_photos: true,
    recommendations: ['Replace carpet.'],
    before_photo_ids: ['b2', 'b1'],
    after_photo_ids: ['a2', 'a1'],
  }), photos)
  const at = (s: string) => out.indexOf(s)
  const order = ['02 · Before Remediation', 'b2.jpg', 'b1.jpg', '03 · After Remediation', 'a2.jpg', 'a1.jpg', '04 · Recommendations'].map(at)
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `out of order: ${order}`)
  assert.ok(out.includes('Caption a2'))
  assert.equal(out.includes('Photo Documentation'), false)
  assert.equal(out.includes('extra.jpg'), false)
})

test('a report without before or after photos keeps the photo appendix', () => {
  const parts = resolvePreV2Parts(pre({ a: part({ enabled: false }), b: part({ enabled: false }), c: part({}) }), job())
  const out = withPhotos(report(parts, { include_photos: true, recommendations: ['Replace carpet.'] }), [photo('a1'), photo('hidden', { include_in_composed_reports: false })])
  assert.ok(out.includes('Photo Documentation'))
  assert.ok(out.includes('a1.jpg'))
  assert.equal(out.includes('hidden.jpg'), false)
  assert.equal(out.includes('Before Remediation') || out.includes('After Remediation'), false)
  assert.match(out, /02 · Recommendations/)
})

test('quote scope summary includes the tip address and no money', () => {
  const summary = quoteScopeSummary({
    title: 'Contents Clearance Quote',
    tip_address: '1 Tip Rd, Brisbane',
    estimated_m3: 12,
    rate_per_m3: 85,
    subtotal: 1020,
    gst: 102,
    total: 1122,
    inclusions: ['Loading and transport'],
  })
  assert.equal(summary?.tip_address, '1 Tip Rd, Brisbane')
  for (const money of ['rate_per_m3', 'subtotal', 'gst', 'total']) assert.equal(money in (summary ?? {}), false)
})
