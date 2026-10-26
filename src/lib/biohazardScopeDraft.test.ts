import assert from 'node:assert/strict'
import test from 'node:test'
import { BIOHAZARD_COMPLETION_REPORT_LINE, emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { biohazardCheckContext } from '@/lib/biohazardCleaningCheck'
import { acceptBiohazardScopeDraft, biohazardScopeDraftPayload } from '@/lib/biohazardScopeDraft'

function step(partial: Record<string, string>) {
  return {
    stage: 'cleaning',
    text: '',
    where: '',
    what: '',
    how: '',
    pass: '',
    ...partial,
  }
}

test('a draft keeps scope lines and leaves the hygienist, testing, and report to code', () => {
  const draft = acceptBiohazardScopeDraft({
    steps: [
      step({
        stage: 'containment',
        text: '1. Isolate the [area affected] with barriers.',
        where: '[area affected]',
        what: 'Isolate',
        how: 'barriers',
      }),
      step({
        stage: 'ppe',
        text: '- Wear PPE suited to [biohazard type].',
        where: '[biohazard type]',
        what: 'Wear PPE',
        how: 'PPE',
      }),
      step({
        stage: 'gross_removal',
        text: 'Engage a Certified Occupational Hygienist to prepare a RAP.',
        where: 'site',
        what: 'RAP',
        how: 'inspect',
      }),
      step({
        stage: 'gross_removal',
        text: 'Remove carpet in the [Main bedroom] to 300 mm beyond staining.',
        where: '[Main bedroom]',
        what: 'Remove carpet',
        how: '300 mm beyond staining',
      }),
      step({
        stage: 'verification',
        text: 'Verify by ATP testing.',
        where: 'surfaces',
        what: 'Verify',
        how: 'ATP',
        pass: 'ATP',
      }),
      step({
        stage: 'verification',
        text: 'Provide a completion report.',
        where: 'site',
        what: 'report',
        how: 'photos',
      }),
      step({
        stage: 'secondary',
        text: 'Treat the [secondary zone] for [secondary contamination].',
        where: '[secondary zone]',
        what: '[secondary contamination]',
        how: 'Treat',
      }),
    ],
  }, false)
  assert.deepEqual(draft?.scope.split('\n'), [
    'Isolate the [area affected] with barriers.',
    'Wear PPE suited to [biohazard type].',
    'Remove carpet in the Main bedroom to 300 mm beyond staining.',
    BIOHAZARD_COMPLETION_REPORT_LINE,
  ])
})

test('a draft with too few lines, or the wrong shape, is not used', () => {
  assert.equal(acceptBiohazardScopeDraft({ steps: [step({ text: 'One.' }), step({ text: 'Two.' })] }, true), null)
  assert.equal(acceptBiohazardScopeDraft({ lines: ['One.', 'Two.', 'Three.'] }, true), null)
  assert.equal(acceptBiohazardScopeDraft(null, true), null)
})

test('a step that does not quote how, or that only says an appropriate treatment, is listed as weak', () => {
  const draft = acceptBiohazardScopeDraft({
    steps: [
      step({
        stage: 'containment',
        text: 'Isolate the [area affected] with barriers.',
        where: '[area affected]',
        what: 'Isolate',
        how: 'barriers',
      }),
      step({
        stage: 'ppe',
        text: 'Wear PPE suited to [biohazard type], a P2 respirator fitted to AS/NZS 1715.',
        where: '[biohazard type]',
        what: 'Wear PPE',
        how: 'P2 respirator fitted to AS/NZS 1715',
      }),
      step({
        stage: 'deodorisation',
        text: 'Deodorise the [area affected] using an appropriate odour-neutralising treatment suited to those materials.',
        where: '[area affected]',
        what: 'Deodorise',
        how: 'an appropriate odour-neutralising treatment',
      }),
      step({
        stage: 'verification',
        text: 'Verify the [area affected] by visual inspection.',
        where: '[area affected]',
        what: 'Verify',
        how: 'visual inspection',
        pass: '',
      }),
    ],
  }, false)
  assert.deepEqual(draft?.weak.map(item => `${item.gap}`), ['how', 'pass'])
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
