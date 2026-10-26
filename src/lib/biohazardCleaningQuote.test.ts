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
    biohazard_types: ['blood and bodily fluids'],
    areas_affected: ['main bedroom'],
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
  assert.deepEqual(figures.lines.map(line => line.label), ['Primary zone', 'Travel', 'Mobilisation', 'Labour', 'Clinical waste bins'])
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
  assert.match(content.scope_of_work[0], /containment around the primary decontamination zone, the Lounge/)
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

test('several biohazard types and primary areas are joined into the clauses', () => {
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-LIST',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture: filled({
      biohazard_types: ['blood', 'faeces', ' Blood ', 'decomposition fluids'],
      areas_affected: ['kitchen', 'laundry', 'toilet'],
    }),
    defaults: biohazardJobDefaults(job()),
  })
  assert.equal(content.biohazard_type, 'blood, faeces and decomposition fluids')
  assert.equal(content.area_affected, 'kitchen, laundry and toilet')
  assert.match(content.scope_of_work.join('\n'), /PPE suited to blood, faeces and decomposition fluids/)
})

test('a quote saved with one biohazard type and one area still opens', () => {
  const saved = normalizeBiohazardCleaningCapture({ biohazard_type: 'blood', area_affected: 'main bedroom', objective: 'Make it safe ' })
  assert.deepEqual(saved.biohazard_types, ['blood'])
  assert.deepEqual(saved.areas_affected, ['main bedroom'])
  assert.equal(saved.objective, 'Make it safe ')
  assert.equal(normalizeBiohazardCleaningCapture({}).biohazard_types, null)
})

test('COH verification is ATP testing and laboratory testing, each with its own line', () => {
  const capture = filled({
    coh_rap: true,
    coh_rap_fee: 900,
    atp_testing: true,
    atp_tests: 6,
    atp_rate: 25,
    lab_testing: true,
    lab_tests: 3,
    lab_rate: 80,
  })
  const figures = biohazardCleaningFigures(capture)
  assert.equal(figures.subtotal, 1650 + 900 + 150 + 240)
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-COH',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture,
    defaults: biohazardJobDefaults(job()),
  })
  assert.match(content.scope_of_work[0], /Certified Occupational Hygienist .*Remediation Action Plan/)
  assert.match(content.scope_of_work[content.scope_of_work.length - 1], /verifies the decontamination by ATP surface testing and by laboratory testing/)
  assert.equal(content.scope_of_work.filter(line => /ATP|laborator/i.test(line)).length, 1)
  assert.deepEqual(
    content.extra_lines.map(line => `${line.label}:${line.quantity}:${line.amount}`),
    [
      'Certified Occupational Hygienist: Remediation Action Plan:1:900',
      'ATP verification testing:6:150',
      'Laboratory testing:3:240',
      'Clinical waste bins:2:100',
    ],
  )
  assert.deepEqual(biohazardRuleFlags(capture, biohazardCheckContext(job())), [])
  const blank = biohazardRuleFlags(filled({
    coh_rap: true,
    atp_testing: true,
    atp_tests: 4,
    lab_testing: true,
  }), biohazardCheckContext(job()))
  assert.deepEqual(blank.map(flag => flag.subject).sort(), ['atp_tests', 'coh_rap_fee', 'lab_tests'])
  const onlyAtp = biohazardRuleFlags(filled({ atp_testing: true, atp_tests: 4, atp_rate: 25 }), biohazardCheckContext(job()))
  assert.ok(onlyAtp.some(flag => flag.subject === 'lab_testing'))
})

test('unticked, neither the hygienist nor ATP testing is on the quote', () => {
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-NONE',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture: filled({ coh_rap_fee: 900, atp_tests: 6, atp_rate: 25 }),
    defaults: biohazardJobDefaults(job()),
  })
  assert.doesNotMatch(content.scope_of_work.join('\n'), /Occupational Hygienist|ATP|laborator/i)
  assert.ok(!content.extra_lines.some(line => /Hygienist|ATP|Laboratory/.test(line.label)))
})

test('without a secondary zone, its line and its clause lines stay off the quote', () => {
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-ONE',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture: filled(),
    defaults: biohazardJobDefaults(job()),
  })
  assert.equal(content.has_secondary, false)
  assert.ok(!biohazardCleaningFigures(filled()).lines.some(line => line.kind === 'secondary'))
  assert.doesNotMatch([...content.scope_of_work, ...content.inclusions].join('\n'), /secondary zone/i)
})

test('a secondary zone is priced at its own rate and printed beside the primary zone', () => {
  const capture = filled({
    secondary_zone: 'hallway and lounge',
    secondary_contaminations: ['odour', 'flies'],
    secondary_objective: 'Remove the odour and the flies.',
    secondary_m2: 40,
    secondary_rate_per_m2: 5,
  })
  const figures = biohazardCleaningFigures(capture)
  assert.equal(figures.secondary_amount, 200)
  assert.equal(figures.subtotal, 1850)
  assert.deepEqual(figures.lines.slice(0, 2).map(line => line.label), ['Primary zone', 'Secondary zone'])
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-TWO',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture,
    defaults: biohazardJobDefaults(job()),
  })
  assert.equal(content.secondary_contamination, 'odour and flies')
  assert.match(content.scope_of_work.join('\n'), /Treat the secondary zone, the hallway and lounge, for odour and flies/)
  assert.match(content.inclusions.join('\n'), /Treatment of odour and flies in the secondary zone/)
  const html = buildPrintHTML(
    'biohazard_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [], [], null, 'job', 'http://localhost', undefined, { screenActionBar: false },
  )
  assert.match(html, /Primary decontamination zone/)
  assert.match(html, /Secondary contamination/)
  assert.match(html, /Secondary zone objective/)
  assert.match(html, /Remove the odour and the flies/)
  assert.doesNotMatch(html, /\[secondary zone\]|\[secondary contamination\]/)
})

test('the check flags a secondary zone without square metres, and square metres without a zone', () => {
  const context = biohazardCheckContext(job())
  const noMetres = biohazardRuleFlags(filled({ secondary_zone: 'hallway' }), context).map(flag => `${flag.code}:${flag.subject}`)
  assert.ok(noMetres.includes('surface_incomplete:secondary'))
  assert.ok(noMetres.includes('missing_field:secondary_contamination'))
  assert.ok(noMetres.includes('missing_field:secondary_objective'))
  const noName = biohazardRuleFlags(filled({ secondary_m2: 30 }), context).map(flag => `${flag.code}:${flag.subject}`)
  assert.ok(noName.includes('missing_field:secondary_zone'))
  assert.deepEqual(biohazardRuleFlags(filled({
    secondary_zone: 'hallway',
    secondary_contaminations: ['odour'],
    secondary_objective: 'Clear the odour.',
    secondary_m2: 30,
    secondary_rate_per_m2: 5,
  }), context), [])
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
  const scope = clauses.scope_of_work.split('\n').filter(line => !/^Verify/.test(line)).join('\n')
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
      { code: 'inclusion_exclusion_conflict', clause: 'exclusions', subject: '', evidence: 'Areas outside the zones on this quote' },
      { code: 'rewrite', clause: 'exclusions', subject: '', evidence: 'x' },
    ],
    cleared: [],
  }, capture, context, [])
  assert.deepEqual(
    accepted.flags.map(flag => `${flag.code}:${flag.subject}`),
    ['hazard_not_addressed:Hepatitis B', 'inclusion_exclusion_conflict:'],
  )
})
