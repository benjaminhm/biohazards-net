import assert from 'node:assert/strict'
import test from 'node:test'
import { BIOHAZARD_COMPLETION_REPORT_LINE, emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { biohazardCheckContext } from '@/lib/biohazardCleaningCheck'
import { acceptBiohazardScopeDraft, biohazardScopeDraftPayload } from '@/lib/biohazardScopeDraft'

test('a draft keeps scope lines and leaves the hygienist, testing, and report to code', () => {
  const scope = acceptBiohazardScopeDraft({
    lines: [
      '1. Isolate the [area affected] with barriers.',
      '- Wear PPE suited to [biohazard type].',
      '',
      'Engage a Certified Occupational Hygienist to prepare a RAP.',
      'Remove carpet in the [Main bedroom] to 300 mm beyond staining.',
      'Verify by ATP testing.',
      'Provide a completion report.',
      'Treat the [secondary zone] for [secondary contamination].',
    ],
  }, false)
  assert.deepEqual(scope?.split('\n'), [
    'Isolate the [area affected] with barriers.',
    'Wear PPE suited to [biohazard type].',
    'Remove carpet in the Main bedroom to 300 mm beyond staining.',
    BIOHAZARD_COMPLETION_REPORT_LINE,
  ])
})

test('a draft with too few lines, or the wrong shape, is not used', () => {
  assert.equal(acceptBiohazardScopeDraft({ lines: ['One.', 'Two.'] }, true), null)
  assert.equal(acceptBiohazardScopeDraft({ scope: 'text' }, true), null)
  assert.equal(acceptBiohazardScopeDraft(null, true), null)
})

test('the draft payload leaves the secondary zone out when it is not in use', () => {
  const capture = { ...emptyBiohazardCleaningCapture(), biohazard_types: ['blood'], areas_affected: ['Lounge'] }
  const context = biohazardCheckContext({ job_type: null, assessment_data: null, site_address: '' } as never)
  const payload = biohazardScopeDraftPayload(capture, context)
  assert.deepEqual(payload.details.biohazard_types, ['blood'])
  assert.equal(payload.details.secondary_zone_in_use, false)
  assert.ok(!payload.placeholders.some(name => name.startsWith('secondary')))
  assert.ok(!payload.house_scope.some(line => /completion report|Hygienist/i.test(line)))
})
