import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  biohazardCleaningFigures,
  biohazardCleaningQuoteContent,
  biohazardJobDefaults,
  defaultBiohazardCleaningClauses,
  emptyBiohazardCleaningCapture,
  normalizeBiohazardCleaningCapture,
  normalizeBiohazardCleaningClauses,
  type BiohazardCleaningCapture,
} from '@/lib/biohazardCleaningQuote'
import {
  acceptBiohazardModelAnswer,
  biohazardCheckContext,
  biohazardRuleFlags,
  mergeBiohazardCheck,
  type BiohazardCheckContext,
} from '@/lib/biohazardCleaningCheck'
import type { AssessmentData, Job } from '@/lib/types'

function job(assessment: Partial<AssessmentData> = {}, jobType: Job['job_type'] = 'trauma') {
  return {
    job_type: jobType,
    site_address: '1 Example Street',
    assessment_data: { areas: [], ...assessment } as unknown as AssessmentData,
  }
}

function filled(overrides: Partial<BiohazardCleaningCapture> = {}): BiohazardCleaningCapture {
  return {
    ...emptyBiohazardCleaningCapture(),
    biohazard_type: 'blood and bodily fluids',
    area_affected: 'main bedroom',
    description: 'Blood on the carpet and walls of the main bedroom.',
    objective: 'Return the main bedroom to a safe, clean condition.',
    estimated_m2: 20,
    rate_per_m2: 10,
    travel_km: 50,
    rate_per_km: 1,
    labour_days: 2,
    rate_per_labour_day: 600,
    mobilisation_fee: 100,
    extra_lines: [{ id: 'a', label: 'Clinical waste bins', quantity: 2, unit: 'bins', rate: 50 }],
    clauses: defaultBiohazardCleaningClauses('Engagement for [biohazard type] in the [area affected]. Total [total].'),
    ...overrides,
  }
}

test('surface, travel, call-out, labour, and other lines add up with GST', () => {
  const figures = biohazardCleaningFigures(filled())
  assert.equal(figures.area_amount, 200)
  assert.equal(figures.travel_amount, 50)
  assert.equal(figures.labour_amount, 1200)
  assert.equal(figures.subtotal, 1650)
  assert.equal(figures.gst, 165)
  assert.equal(figures.total, 1815)
  assert.deepEqual(figures.lines.map(line => line.label), ['Surface area', 'Travel', 'Mobilisation', 'Labour', 'Clinical waste bins'])
  assert.equal(biohazardCleaningFigures(filled({ mobilisation_waived: true })).mobilisation_fee, 0)
})

test('the job type and assessment fill the title, biohazard type, and area affected', () => {
  const defaults = biohazardJobDefaults(job({ areas: [{ name: 'Lounge', sqm: 0, hazard_level: 1, description: '' }] }, 'unattended_death'))
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-TEST',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture: { ...emptyBiohazardCleaningCapture(), clauses: defaultBiohazardCleaningClauses() },
    defaults,
  })
  assert.equal(content.title, 'Unattended Death Cleaning')
  assert.equal(content.biohazard_type, 'decomposition fluids')
  assert.equal(content.area_affected, 'Lounge')
  assert.match(content.scope_of_work[0], /containment around the Lounge/)
  assert.match(content.assumptions.join('\n'), /^Decomposition fluids has not spread beyond the Lounge/m)
})

test('the printed quote fills the placeholders and the engagement agreement', () => {
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-PRINT',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture: filled(),
    defaults: biohazardJobDefaults(job()),
  })
  const html = buildPrintHTML(
    'biohazard_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  assert.match(html, /class="sow-doc-title">Trauma Cleaning</)
  assert.match(html, /Scope of work/)
  assert.match(html, /Engagement for blood and bodily fluids in the main bedroom\. Total \$1,815\.00\./)
  assert.match(html, /Clinical waste bins/)
  assert.doesNotMatch(html, /\[biohazard type\]|\[area affected\]/)
})

test('a job copy of the clauses is kept as typed, and the template falls back to the shared engagement', () => {
  const saved = normalizeBiohazardCleaningCapture({ clauses: { scope_of_work: 'Only this.', engagement_agreement: '' } })
  assert.equal(saved.clauses?.scope_of_work, 'Only this.')
  assert.equal(saved.clauses?.engagement_agreement, '')
  assert.equal(normalizeBiohazardCleaningClauses(null, 'Shared text').engagement_agreement, 'Shared text')
})

const NO_ASSESSMENT: BiohazardCheckContext = biohazardCheckContext(job())

test('the default scope with every field filled has no rule flags', () => {
  assert.deepEqual(biohazardRuleFlags(filled(), NO_ASSESSMENT), [])
})

test('rules find gaps against the assessment and the standard stages', () => {
  const context = biohazardCheckContext(job({
    areas: [
      { name: 'Main bedroom', sqm: 0, hazard_level: 1, description: '' },
      { name: 'Ensuite', sqm: 0, hazard_level: 1, description: '' },
    ],
    special_risks: { sharps: true, chemicals: false, structural_damage: false, infectious_disease: false, vermin: false, mold_spores: false },
  }))
  const clauses = defaultBiohazardCleaningClauses()
  const scope = clauses.scope_of_work.split('\n').filter(line => !/ATP/.test(line)).join('\n')
  const flags = biohazardRuleFlags(filled({ description: '', clauses: { ...clauses, scope_of_work: scope } }), context)
  const keys = flags.map(flag => `${flag.code}:${flag.subject}`)
  assert.ok(keys.includes('missing_field:description'))
  assert.ok(keys.includes('stage_missing:verification'))
  assert.ok(keys.includes('area_not_quoted:Ensuite'))
  assert.ok(!keys.includes('area_not_quoted:Main bedroom'))
  assert.ok(keys.includes('risk_not_covered:Sharps'))
})

test('rules find contradictions in the clauses', () => {
  const clauses = defaultBiohazardCleaningClauses()
  const flags = biohazardRuleFlags(filled({
    mobilisation_waived: true,
    clauses: {
      ...clauses,
      inclusions: `${clauses.inclusions}\nA call-out fee of $150 applies.\nSee [site plan].`,
      payment_terms: 'A deposit of 30% is due. GST is 10%.',
    },
  }), NO_ASSESSMENT)
  const keys = flags.map(flag => `${flag.code}:${flag.clause}`)
  assert.ok(keys.includes('callout_conflict:inclusions'))
  assert.ok(keys.includes('rate_mismatch:inclusions'))
  assert.ok(keys.includes('placeholder_unfilled:inclusions'))
  assert.ok(keys.includes('deposit_mismatch:payment_terms'))
  assert.ok(!keys.includes('gst_mismatch:payment_terms'))
})

test('the model clears a rule flag only with words that are in the quote', () => {
  const context = biohazardCheckContext(job({ areas: [{ name: 'Master bed', sqm: 0, hazard_level: 1, description: '' }] }))
  const capture = filled()
  const rules = biohazardRuleFlags(capture, context)
  assert.ok(rules.some(flag => flag.code === 'area_not_quoted' && flag.subject === 'Master bed'))
  const invented = acceptBiohazardModelAnswer(
    { flags: [], cleared: [{ code: 'area_not_quoted', subject: 'Master bed', evidence: 'master bedroom suite' }] },
    capture, context, rules,
  )
  assert.equal(invented.cleared.length, 0)
  const quoted = acceptBiohazardModelAnswer(
    { flags: [], cleared: [{ code: 'area_not_quoted', subject: 'Master bed', evidence: 'main bedroom' }] },
    capture, context, rules,
  )
  assert.equal(quoted.cleared.length, 1)
  assert.ok(!mergeBiohazardCheck(rules, quoted).flags.some(flag => flag.code === 'area_not_quoted'))
})

test('the model may add only listed codes and subjects, with real evidence', () => {
  const context = biohazardCheckContext(job({
    presenting_biohazard_ids: ['h1'],
    manual_biohazard_chips: [{ id: 'h1', label: 'Hepatitis B', category: 'biological' } as never],
  }))
  const capture = filled()
  const accepted = acceptBiohazardModelAnswer({
    flags: [
      { code: 'hazard_not_addressed', clause: 'scope_of_work', subject: 'Hepatitis B', evidence: '' },
      { code: 'hazard_not_addressed', clause: 'scope_of_work', subject: 'Anthrax', evidence: '' },
      { code: 'inclusion_exclusion_conflict', clause: 'exclusions', subject: '', evidence: 'Words that are not there' },
      { code: 'inclusion_exclusion_conflict', clause: 'exclusions', subject: '', evidence: 'Areas other than the main bedroom' },
      { code: 'rewrite', clause: 'exclusions', subject: '', evidence: 'x' },
    ],
    cleared: [],
  }, capture, context, [])
  assert.deepEqual(
    accepted.flags.map(flag => `${flag.code}:${flag.subject}`),
    ['hazard_not_addressed:Hepatitis B', 'inclusion_exclusion_conflict:'],
  )
})
