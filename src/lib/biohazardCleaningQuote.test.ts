import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  BIOHAZARD_COH_INCLUSION_LINES,
  biohazardCleaningFigures,
  biohazardCleaningQuoteContent,
  biohazardJobDefaults,
  defaultBiohazardCleaningClauses,
  emptyBiohazardCleaningCapture,
  applyRememberedBiohazardClauses,
  normalizeBiohazardCleaningCapture,
  normalizeBiohazardCleaningClauses,
  rememberedBiohazardClauses,
  withRememberedBiohazardClauses,
  type BiohazardCleaningCapture,
} from '@/lib/biohazardCleaningQuote'
import {
  acceptBiohazardModelAnswer,
  biohazardCheckContext,
  biohazardFlagText,
  biohazardRuleFlags,
  mergeBiohazardCheck,
  type BiohazardCheckContext,
} from '@/lib/biohazardCleaningCheck'
import { biohazardQuoteZones, depositFromTotal } from '@/lib/biohazardQuoteLayout'
import { DEFAULT_ENGAGEMENT_AGREEMENT } from '@/lib/quoteEngagement'
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
  assert.match(content.scope_of_work[0], /Isolate the primary zone, with containment/)
  assert.match(content.assumptions.join('\n'), /^Decomposition fluids has not spread beyond the primary zone/m)
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
  assert.match(content.scope_of_work[0], /Certified Occupational Hygienist .*written instructions/)
  assert.match(content.scope_of_work[content.scope_of_work.length - 2], /verifies the decontamination by ATP surface testing and by laboratory testing.*pass limits the hygienist sets/)
  assert.match(content.scope_of_work[content.scope_of_work.length - 1], /^Provide records of the works/)
  assert.equal(content.scope_of_work.filter(line => /ATP|laborator/i.test(line)).length, 1)
  assert.deepEqual(content.inclusions.slice(-3), [...BIOHAZARD_COH_INCLUSION_LINES])
  assert.deepEqual(
    content.extra_lines.map(line => `${line.label}:${line.quantity}:${line.amount}`),
    [
      'Certified Occupational Hygienist: site inspection and written method:1:900',
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
  assert.doesNotMatch(content.inclusions.join('\n'), /Hygienist|COH|Remediation Action Plan|written instructions|retested/i)
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
  assert.match(content.scope_of_work.join('\n'), /Treat the secondary zone, for odour and flies/)
  assert.match(content.inclusions.join('\n'), /Treatment of odour and flies in the secondary zone/)
  const html = buildPrintHTML(
    'biohazard_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [], [], null, 'job', 'http://localhost', undefined, { screenActionBar: false },
  )
  assert.match(html, /Primary decontamination zone/)
  assert.match(html, /Contaminant/)
  assert.match(html, /Secondary zone/)
  assert.match(html, /Remove the odour and the flies/)
  assert.doesNotMatch(html, /\[secondary zone\]|\[secondary contamination\]/)
})

test('Areas other than the primary zone prints as areas outside the zones, and is not a contradiction', () => {
  const clauses = {
    ...defaultBiohazardCleaningClauses(),
    exclusions: 'Repairs.\nAreas other than the [area affected].\nContents removal, other than materials affected by [biohazard type].',
  }
  const capture = filled({
    areas_affected: ['Laundry', 'kitchen', 'toilet'],
    secondary_zone: 'Living room',
    secondary_contaminations: ['odour'],
    secondary_objective: 'Clear the odour.',
    secondary_m2: 20,
    secondary_rate_per_m2: 5,
    clauses,
  })
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-EX',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture,
    defaults: biohazardJobDefaults(job()),
  })
  assert.match(content.exclusions.join('\n'), /Areas outside the zones on this quote/)
  assert.doesNotMatch(content.exclusions.join('\n'), /Areas other than the Laundry/)
  assert.match(content.exclusions.join('\n'), /Contents removal, other than materials affected by blood and bodily fluids/)
  const accepted = acceptBiohazardModelAnswer({
    flags: [{
      code: 'inclusion_exclusion_conflict',
      clause: 'exclusions',
      subject: '',
      evidence: 'Areas other than the Laundry, kitchen and toilet.',
    }],
    cleared: [],
  }, capture, biohazardCheckContext(job()), [])
  assert.deepEqual(accepted.flags, [])
})

test('listed other zones go in the exclusions as non-affected, and stay off the scope', () => {
  const none = biohazardCleaningQuoteContent({
    reference: 'BCQ-NONE',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture: filled(),
    defaults: biohazardJobDefaults(job()),
  })
  assert.equal(none.other_zones, '')
  assert.doesNotMatch(none.exclusions.join('\n'), /non-affected/)
  const capture = filled({ other_zones: ['garage', 'study'] })
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-OTHER',
    clientName: 'Acme',
    siteAddress: '1 Example Street',
    capture,
    defaults: biohazardJobDefaults(job()),
  })
  assert.equal(content.other_zones, 'garage and study')
  assert.match(content.exclusions.join('\n'), /The garage and study, inspected and considered non-affected/)
  assert.doesNotMatch(content.scope_of_work.join('\n'), /garage|study/)
  const html = buildPrintHTML(
    'biohazard_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [], [], null, 'job', 'http://localhost', undefined, { screenActionBar: false },
  )
  assert.match(html, /inspected and considered non-affected/)
  const context = biohazardCheckContext(job({
    areas: [
      { name: 'Main bedroom', sqm: 0, hazard_level: 1, description: '' },
      { name: 'Garage', sqm: 0, hazard_level: 1, description: '' },
    ],
  }))
  const keys = biohazardRuleFlags(filled({ other_zones: ['Garage'] }), context).map(flag => `${flag.code}:${flag.subject}`)
  assert.ok(!keys.includes('area_not_quoted:Garage'))
  assert.ok(!keys.includes('area_not_quoted:Main bedroom'))
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

test('the last unattended death quote is remembered for the next one, and other kinds are not', () => {
  const clauses = {
    ...defaultBiohazardCleaningClauses('Engagement for [biohazard type].'),
    inclusions: 'Removal of [biohazard type] from the [area affected].',
    exclusions: 'Contents.',
    assumptions: 'Power and water are on.',
  }
  const standards = withRememberedBiohazardClauses(
    { scope_of_work: 'Company scope.', by_kind: { trauma: { inclusions: 'T', exclusions: 'T', assumptions: 'T', engagement_agreement: 'T' } } },
    'unattended_death',
    clauses,
    'job-1',
    '2026-10-26T00:00:00.000Z',
  )
  assert.equal(standards.scope_of_work, 'Company scope.')
  const remembered = rememberedBiohazardClauses(standards, 'unattended_death')
  assert.equal(remembered?.inclusions, 'Removal of [biohazard type] from the [area affected].')
  assert.equal(remembered?.job_id, 'job-1')
  assert.equal(rememberedBiohazardClauses(standards, 'trauma')?.inclusions, 'T')
  assert.equal(rememberedBiohazardClauses(standards, 'sewage'), null)

  const next = applyRememberedBiohazardClauses(defaultBiohazardCleaningClauses('Company engagement.'), remembered!)
  assert.equal(next.scope_of_work, defaultBiohazardCleaningClauses().scope_of_work)
  assert.equal(next.engagement_agreement, 'Engagement for [biohazard type].')
  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-NEXT',
    clientName: 'Acme',
    siteAddress: '2 Other Street',
    capture: filled({ cleaning_kind: 'unattended_death', biohazard_types: ['decomposition fluids'], areas_affected: ['lounge'], clauses: next }),
    defaults: biohazardJobDefaults(job()),
  })
  assert.deepEqual(content.inclusions, ['Removal of decomposition fluids from the primary zone.'])
  assert.equal(normalizeBiohazardCleaningCapture({ clauses_from_kind: 'unattended_death' }).clauses_from_kind, 'unattended_death')
  assert.equal(normalizeBiohazardCleaningCapture({ clauses_from_kind: 'made_up' }).clauses_from_kind, null)
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

test('the model may flag a scope step a hygienist could not audit, quoting the step', () => {
  const capture = filled({ coh_rap: true, coh_rap_fee: 900 })
  const accepted = acceptBiohazardModelAnswer({
    flags: [
      { code: 'scope_not_auditable', clause: 'scope_of_work', subject: 'how', evidence: 'where odour remains after cleaning' },
      { code: 'scope_not_auditable', clause: 'scope_of_work', subject: 'where', evidence: 'where odour remains after cleaning' },
      { code: 'scope_not_auditable', clause: 'scope_of_work', subject: 'how', evidence: 'Words that are not there' },
      { code: 'scope_not_auditable', clause: 'scope_of_work', subject: 'vague', evidence: 'where odour remains after cleaning' },
      { code: 'scope_not_auditable', clause: 'scope_of_work', subject: 'how', evidence: 'inspects the site and issues written instructions' },
      { code: 'scope_not_auditable', clause: 'scope_of_work', subject: 'pass', evidence: 'no visible residue or staining on the treated surfaces, and no odour from them' },
    ],
    cleared: [],
  }, capture, NO_ASSESSMENT, [])
  assert.deepEqual(accepted.flags.map(flag => flag.subject), ['how', 'where'])
  assert.match(biohazardFlagText(accepted.flags[0]), /could not tell how: the method, product, or standard/)
})

const BCQ_355F_SCOPE = `Isolate the primary decontamination zone, the [area affected], with containment barriers and signage, and control access to the work area. Set up a decontamination point at the zone exit.
Technicians wear PPE suited to [biohazard type]: disposable coveralls, nitrile gloves (double gloved), eye protection, and a P2 respirator or better, fitted to AS/NZS 1715.
Remove gross [biohazard type] from the tiled floors, tiled skirting boards, and gyprock plasterboard walls in the [area affected]. Remove all porous materials visibly affected by [biohazard type] to at least 300 mm beyond the visible staining, including any affected gyprock plasterboard. Bag and seal all removed material as clinical waste.
Clean all non-porous surfaces in the [area affected], including tiled floors and tiled skirting boards, with a detergent solution, working top to bottom and clean to dirty, to remove all organic residue.
Disinfect all cleaned non-porous surfaces in the [area affected] with a TGA-registered hospital-grade disinfectant, applied at the contact time stated on the label. Record the product name and batch number.
Seal any semi-porous surfaces in the [area affected], such as exposed substrate or grout lines, with an encapsulant where staining or odour remains after cleaning and disinfection.
Verify the primary zone clean by visual inspection of all treated surfaces in the [area affected]: no visible residue or staining on the tiled floors, tiled skirting boards, or remaining wall surfaces, and no detectable odour from them.
Transport and dispose of all [biohazard type] waste, including bagged porous materials and clinical waste, at a licensed facility under AS/NZS 3816 and the applicable state EPA rules. Retain all disposal certificates.
Deodorise the [area affected] after cleaning. First confirm the contamination source has been fully removed, then apply thermal fogging with an odour counteractant to the Kitchen, Laundry, and Toilet. Seal any remaining semi-porous surfaces such as grout or exposed substrate that continue to hold odour with an encapsulant.
Treat the secondary zone, the [secondary zone], for [secondary contamination]. Remove all dead flies from surfaces, floors, window sills, and ledges throughout the [secondary zone] by HEPA-vacuum and wipe-down. Clean and sanitise all surfaces in the [secondary zone] that flies may have contacted, using a TGA-registered hospital-grade disinfectant at the label contact time.
Deodorise the [secondary zone] to remove odours and VOCs affecting paint and carpet. Run hydroxyl/ozon2 generators throughout the [secondary zone] for sufficient dwell time to neutralise VOCs. Where carpet retains odour after hydroxyl/ozon2 treatment, apply a topical odour counteractant by spray application.
Provide a completion report: photos before, during, and after the works, disinfectant records, waste disposal certificates, and test results where testing is on this quote.`

function quote355F(): BiohazardCleaningCapture {
  return {
    ...emptyBiohazardCleaningCapture(),
    cleaning_kind: 'unattended_death',
    biohazard_types: ['decomposition fluids'],
    areas_affected: ['Laundry', 'kitchen', 'toilet'],
    description: 'Tenant of property located deceased in the kitchen at the entryway to the laundry. Decomposition fluids have migrated from that location into the laundry, and toilet. Structural elements affected are tiled floors, tiled skirting board, gyprock plasterboard walls.',
    objective: 'To remove fuild contamination, malodours from structural and non-strucutral elements to remediate and make safe the property to enable structural ',
    estimated_m2: 103.48,
    rate_per_m2: 39,
    rooms: [
      { id: '1', name: 'Kitchen', length_m: 4, width_m: 3.2, height_m: 2.4 },
      { id: '2', name: 'Laundry', length_m: 2.2, width_m: 1.8, height_m: 2.4 },
      { id: '3', name: 'Toilet', length_m: 1.8, width_m: 0.9, height_m: 2.4 },
    ],
    secondary_zone: 'Living room, staircase, hallway, bedroom, bathroom, master bedroom, walk-in warddrobe.',
    secondary_contaminations: ['odour', 'flies'],
    secondary_objective: 'Remove  dead flys, clean and sanitise all surfaces potentially and assumes to have be contaminated by flies, and remove odours (VOCs) affecting paint and carpet.',
    secondary_m2: 361.36,
    secondary_rate_per_m2: 15,
    secondary_rooms: [
      { id: '4', name: 'Living', length_m: 5, width_m: 4, height_m: 2.4 },
      { id: '5', name: 'Main bedroom', length_m: 4, width_m: 3.6, height_m: 2.4 },
      { id: '6', name: 'Bedroom', length_m: 3.5, width_m: 3, height_m: 2.4 },
      { id: '7', name: 'Hall', length_m: 6, width_m: 1.2, height_m: 2.4 },
      { id: '8', name: 'Bathroom', length_m: 2.2, width_m: 1.8, height_m: 2.4 },
      { id: '9', name: 'Garage', length_m: 6, width_m: 3, height_m: 2.7 },
    ],
    travel_km: 27.3,
    rate_per_km: 2,
    labour_days: 5,
    rate_per_labour_day: 650,
    mobilisation_fee: 1000,
    atp_testing: true,
    atp_tests: 1,
    atp_rate: 1500,
    lab_testing: true,
    lab_tests: 3,
    lab_rate: 150,
    clauses: {
      ...defaultBiohazardCleaningClauses(DEFAULT_ENGAGEMENT_AGREEMENT),
      scope_of_work: BCQ_355F_SCOPE,
      inclusions: 'Biohazard cleaning of the [area affected], as set out in the scope of work.\nSurface cleaning of the estimated area at the rate per square metre on this quote.\nTravel at the rate per kilometre on this quote.\nLabour for the labour days on this quote, as a fixed amount.',
      exclusions: 'Repairs, rebuilding, and restoration, including replacing removed materials.\nAreas other than the [area affected].\nContents removal, other than materials affected by [biohazard type].\nHazardous building materials, such as asbestos.',
    },
  }
}

test('BCQ-20261026-355F keeps the total and deposit, and prints matching zone rooms', () => {
  const capture = quote355F()
  const figures = biohazardCleaningFigures(capture)
  assert.equal(figures.estimated_m2, 103.48)
  assert.equal(figures.secondary_m2, 361.36)
  assert.equal(figures.subtotal, 15710.72)
  assert.equal(figures.gst, 1571.07)
  assert.equal(figures.total, 17281.79)
  assert.deepEqual(depositFromTotal(figures.total), { deposit: 8640.90, balance: 8640.89 })

  const zones = biohazardQuoteZones(capture, figures)
  assert.equal(zones.primary.rooms_label, 'Kitchen, Laundry and Toilet')
  assert.equal(zones.secondary?.rooms_label, 'Living, Main bedroom, Bedroom, Hall, Bathroom and Garage')
  assert.deepEqual(
    zones.mismatches.map(flag => `${flag.issue}:${flag.room}`).sort(),
    ['listed_not_measured:staircase', 'listed_not_measured:walk-in wardrobe', 'measured_not_listed:Garage'].sort(),
  )
  const flags = biohazardRuleFlags(capture, biohazardCheckContext(job())).map(flag => `${flag.code}:${flag.subject}`)
  assert.ok(flags.includes('zone_room_unmeasured:staircase'))
  assert.ok(flags.includes('zone_room_unmeasured:walk-in wardrobe'))
  assert.ok(flags.includes('measured_room_not_in_zone:Garage'))

  const content = biohazardCleaningQuoteContent({
    reference: 'BCQ-20261026-355F',
    clientName: 'Jemma Archibald (Property Manager)',
    siteAddress: '7/2 Bishop Street, Eagleby QLD 4207,',
    capture,
  })
  assert.equal(content.total, 17281.79)
  assert.equal(content.area_affected, 'Kitchen, Laundry and Toilet')
  assert.equal(content.secondary_zone, 'Living, Main bedroom, Bedroom, Hall, Bathroom and Garage')
  assert.equal(content.job_address, '7/2 Bishop Street, Eagleby QLD 4207')
  assert.equal(content.scope_of_work.filter(line => /encapsul/i.test(line) && !/secondary zone/i.test(line)).length, 2)

  const html = buildPrintHTML(
    'biohazard_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [],
    [],
    { name: 'Forensic Cleaning QLD' } as never,
    '355fd28f-83d5-4a27-90c5-91ccaa1cf673',
    'http://localhost',
    {
      client_name: 'Jemma Archibald (Property Manager)',
      client_organization_name: 'Ray White Waterford',
      client_contact_role: '',
      client_phone: '+61480473391',
      site_address: '7/2 Bishop Street, Eagleby QLD 4207,',
    },
    { screenActionBar: false },
  )
  assert.match(html, /Jemma Archibald, Property Manager, Ray White Waterford/)
  assert.match(html, /bcq-nowrap">\+61480473391/)
  assert.match(html, /Quote summary/)
  assert.match(html, /Kitchen, Laundry and Toilet · 103\.48 m²/)
  assert.match(html, /Living, Main bedroom, Bedroom, Hall, Bathroom and Garage · 361\.36 m²/)
  assert.match(html, /\$17,281\.79/)
  assert.match(html, /\$8,640\.90/)
  assert.match(html, /Odour and insect treatment of the secondary zone/)
  assert.match(html, /Secondary zone square metres on this quote are an estimate/)
  assert.match(html, /Estimated secondary surface: 361\.36 m² at \$15\.00 ex GST = \$5,420\.40/)
  assert.match(html, /☐ Agent for owner \(authority held\)/)
  assert.match(html, /☐ Owner/)
  assert.doesNotMatch(html, /Executor, probate|Administrator, letters granted/)
  assert.doesNotMatch(html, /3\.1 Contents/)
  assert.match(html, /3\.1 Travel is estimated/)
  assert.match(html, /Measured items \(estimated\)/)
  assert.match(html, /Fixed items/)
  assert.match(html, />Totals</)
  assert.match(html, /m² = floor \+ walls \+ ceiling/)
  assert.match(html, />Travel</)
  assert.equal((html.match(/This figure is an estimate/g) ?? []).length, 1)
  assert.match(html, /to enable structural repairs/)
  assert.match(html, /assumed to have been/)
  assert.match(html, /hydroxyl\/ozone/)
  assert.doesNotMatch(html, /fuild|strucutral|warddrobe|flys|ozon2|assumes to have be/)
  assert.equal((html.match(/encapsulant/gi) ?? []).length, 1)
  assert.match(html, /1\. Site setup and PPE/)
  assert.match(html, /2\. Primary zone/)
  assert.match(html, /3\. Secondary zone/)
  assert.match(html, /6\. Completion records/)
  assert.match(html, /Forensic Cleaning QLD — Confidential · BCQ-20261026-355F · Page/)
  assert.match(html, /bcq-sign/)
})
