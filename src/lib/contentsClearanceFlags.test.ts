import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptModelFlags,
  clearanceClauseFlags,
  CLEARANCE_FLAG_RESPONSE_SCHEMA,
  mergeClearanceFlags,
} from '@/lib/contentsClearanceFlags'
import {
  contentsClearanceFigures,
  defaultContentsClearanceStandards,
  type ContentsClearanceStandards,
} from '@/lib/contentsClearanceQuote'

const RATES = { ratePerM3: 100, ratePerKm: 2, ratePerLabourDay: 600, m3PerLabourDay: 6 }

function figures(manDays: number, m3 = 18) {
  return contentsClearanceFigures(m3, 0, RATES, { maximumManDays: manDays })
}

test('honest clauses leave the labour days as the number on the quote', () => {
  const flags = clearanceClauseFlags(figures(6), defaultContentsClearanceStandards())
  assert.equal(flags.some(flag => flag.code === 'labour_tracks_volume'), false)
  assert.equal(flags.some(flag => flag.code === 'man_day_wording'), false)
  assert.equal(flags.some(flag => flag.code === 'gst_mismatch'), false)
  assert.equal(flags.some(flag => flag.code === 'deposit_mismatch'), false)
})

test('a clause that still ties labour days to the volume is flagged', () => {
  const standards: ContentsClearanceStandards = {
    ...defaultContentsClearanceStandards(),
    inclusions: 'Labour at one labour day for every 6 cubic metres, at the standard rate per person per day.',
    assumptions: 'Cubic metres are an estimate. The measured volume replaces the estimate, and labour days are that volume divided by 6, rounded to a whole day.',
    payment_terms: 'The balance is the measured cubic metres and the labour days that follow the measured volume. A deposit of 50% is requested. GST is 10%.',
  }
  const flags = clearanceClauseFlags(figures(6), standards)
  const labour = flags.filter(flag => flag.code === 'labour_tracks_volume').map(flag => flag.clause)
  assert.deepEqual(labour, ['inclusions', 'assumptions', 'payment_terms'])
})

test('man day, a wrong rate, deposit, and GST are flagged on the clause that says them', () => {
  const standards: ContentsClearanceStandards = {
    ...defaultContentsClearanceStandards(),
    inclusions: 'Labour is one man day for every 6 cubic metres at $550 per person per day.',
    assumptions: 'The measured volume replaces the estimate.',
    payment_terms: 'A deposit of 25% is required. GST is 15%.',
    engagement_agreement: '<p>The crew attends as agreed.</p>',
  }
  const flags = clearanceClauseFlags(figures(6), standards)
  assert.ok(flags.some(flag => flag.code === 'man_day_wording' && flag.clause === 'inclusions'))
  assert.ok(flags.some(flag => flag.code === 'rate_mismatch' && flag.clause === 'inclusions'))
  assert.ok(flags.some(flag => flag.code === 'deposit_mismatch' && flag.clause === 'payment_terms'))
  assert.ok(flags.some(flag => flag.code === 'gst_mismatch' && flag.clause === 'payment_terms'))
  assert.equal(flags.some(flag => flag.clause === 'engagement_agreement'), false)
})

test('a rate that is already on the quote is not a mismatch', () => {
  const standards: ContentsClearanceStandards = {
    ...defaultContentsClearanceStandards(),
    inclusions: 'Labour is $600 per person per day.',
    assumptions: 'Cubic metres are an estimate.',
    payment_terms: 'A deposit of 50% is requested. GST is 10%.',
  }
  const flags = clearanceClauseFlags(figures(6), standards)
  assert.equal(flags.some(flag => flag.code === 'rate_mismatch'), false)
  assert.equal(flags.some(flag => flag.code === 'deposit_mismatch'), false)
  assert.equal(flags.some(flag => flag.code === 'gst_mismatch'), false)
  assert.equal(flags.some(flag => flag.code === 'labour_tracks_volume'), false)
})

test('the model may only return a code and a clause, and only when the figures still disagree', () => {
  const standards: ContentsClearanceStandards = {
    ...defaultContentsClearanceStandards(),
    assumptions: 'Cubic metres are an estimate. The measured volume replaces the estimate, and labour days are that volume divided by 6, rounded to a whole day.',
  }
  const raw = {
    flags: [
      { code: 'labour_tracks_volume', clause: 'assumptions', detail: 'Rewrite this clause.' },
      { code: 'labour_tracks_volume', clause: 'exclusions' },
      { code: 'man_day_wording', clause: 'assumptions' },
      { code: 'not_a_code', clause: 'assumptions' },
      { code: 'rate_mismatch', clause: 'payment_terms' },
    ],
  }
  const matched = acceptModelFlags(raw, figures(3), standards)
  assert.deepEqual(matched, [])
  const disagreed = acceptModelFlags(raw, figures(6), standards)
  assert.deepEqual(disagreed, [{ code: 'labour_tracks_volume', clause: 'assumptions' }])
  const schemaProps = CLEARANCE_FLAG_RESPONSE_SCHEMA.properties.flags.items.properties
  assert.deepEqual(Object.keys(schemaProps), ['code', 'clause'])
  assert.equal(mergeClearanceFlags(
    [{ code: 'labour_tracks_volume', clause: 'assumptions' }],
    disagreed,
  ).length, 1)
})
