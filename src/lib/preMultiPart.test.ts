import assert from 'node:assert/strict'
import test from 'node:test'
import type { PostRemediationEvaluationContent, PostRemediationEvaluationV2, PrePart } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'
import { makeBlankPreV2, quoteScopeSummary, resolvePreV2Parts } from '@/lib/postRemediationEvaluations'

function part(patch: Partial<PrePart>): PrePart {
  return { enabled: true, works_rows: [], products_rows: [], waste: {}, ...patch }
}

function pre(parts: PostRemediationEvaluationV2['parts']): PostRemediationEvaluationV2 {
  return { id: 'prev2_1', parts, created_at: '2026-11-05T00:00:00.000Z', updated_at: '2026-11-05T00:00:00.000Z' }
}

test('part letters are fixed: without Part B the report has Part A and Part C', () => {
  const resolved = resolvePreV2Parts(
    pre({
      a: part({ methodology: 'Zoned and treated the bedroom.' }),
      b: part({ enabled: false, methodology: 'Should not print.' }),
      c: part({ outcome_verification: 'All rooms wiped down.' }),
    }),
  )
  assert.deepEqual(resolved.map(p => p.letter), ['A', 'C'])
  assert.deepEqual(resolved.map(p => p.title), ['Biohazard Cleaning', 'Surface Area Cleaning'])
})

test('enabled parts with nothing written are left out', () => {
  const resolved = resolvePreV2Parts(
    pre({ a: part({}), b: part({ actual_volume_m3: '12 m³' }), c: part({ works_rows: [{ stage_name: ' ', description: '' }] }) }),
  )
  assert.deepEqual(resolved.map(p => p.letter), ['B'])
})

test('Part B carries the quoted volume from the linked CCQ', () => {
  const resolved = resolvePreV2Parts(
    pre({ a: part({ enabled: false }), b: part({ actual_volume_m3: '14 m³' }), c: part({ enabled: false }) }),
    { b: { estimated_m3: 12, total: 4800 } },
  )
  assert.equal(resolved[0].quoted_volume_m3, 12)
  assert.equal(resolved[0].actual_volume_m3, '14 m³')
})

test('new multi-part PRE links a part only when there is exactly one quote of that type', () => {
  const blank = makeBlankPreV2([
    { id: 'bcq1', type: 'biohazard_cleaning_quote', content: { title: 'Biohazard Cleaning Quote', reference: 'BCQ-1' }, created_at: '2026-11-01T00:00:00.000Z' },
    { id: 'sacq1', type: 'surface_area_cleaning_quote', content: {}, created_at: '2026-11-01T00:00:00.000Z' },
    { id: 'sacq2', type: 'surface_area_cleaning_quote', content: {}, created_at: '2026-11-02T00:00:00.000Z' },
  ])
  assert.equal(blank.parts.a.enabled, true)
  assert.equal(blank.parts.a.source_quote_document_id, 'bcq1')
  assert.equal(blank.parts.a.source_quote_reference, 'BCQ-1')
  assert.equal(blank.parts.b.enabled, false)
  assert.equal(blank.parts.c.enabled, true)
  assert.equal(blank.parts.c.source_quote_document_id, undefined)
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
  assert.equal(summary?.estimated_m3, 12)
  for (const money of ['rate_per_m3', 'subtotal', 'gst', 'total']) assert.equal(money in (summary ?? {}), false)
})

test('printed multi-part report shows parts in A then C order with their sections', () => {
  const content: PostRemediationEvaluationContent = {
    title: 'Completion Report',
    reference: 'RPT-1',
    source_quote_document_id: '',
    report_format: 'parts_v1',
    executive_summary: 'Whole job summary.',
    parts: resolvePreV2Parts(
      pre({
        a: part({ source_quote_document_id: 'bcq1', source_quote_label: 'Biohazard Cleaning Quote', methodology: 'Zone A method.' }),
        b: part({ enabled: false }),
        c: part({ works_rows: [{ stage_name: 'Kitchen', description: 'Wiped all surfaces.' }] }),
      }),
    ),
    scope_lines: [],
    include_photos: false,
  }
  const html = buildPrintHTML('report', content as unknown as Record<string, unknown>, [], [], null, 'job', 'http://localhost', undefined, {
    screenActionBar: false,
  })
  const a = html.indexOf('Part A · Biohazard Cleaning')
  const c = html.indexOf('Part C · Surface Area Cleaning')
  assert.ok(a > 0 && c > a)
  assert.equal(html.includes('Part B'), false)
  assert.match(html, /A2 · Methodology/)
  assert.match(html, /C1 · Works Undertaken/)
  assert.match(html, /Whole job summary/)
  assert.equal(/\$\s?\d/.test(html), false)
})
