import assert from 'node:assert/strict'
import test from 'node:test'
import { contentsClearanceQuoteContent, defaultContentsClearanceStandards, emptyContentsClearanceCapture, normalizeContentsClearanceCapture } from '@/lib/contentsClearanceQuote'
import { defaultSurfaceAreaCleaningStandards, emptySurfaceAreaCleaningCapture, surfaceAreaCleaningQuoteContent } from '@/lib/surfaceAreaCleaningQuote'
import { biohazardCleaningQuoteContent, defaultBiohazardCleaningClauses, emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { withJobOnlyLines } from '@/lib/quoteJobClauses'

test('job-only lines follow the standard lines and blanks are dropped', () => {
  assert.equal(withJobOnlyLines('A\nB\n', '\n  C  \n\nD'), 'A\nB\nC\nD')
  assert.equal(withJobOnlyLines('A', ''), 'A')
  assert.equal(withJobOnlyLines('', 'C'), 'C')
})

test('a new contents clearance capture has no job-only clauses, and saved ones load', () => {
  const empty = emptyContentsClearanceCapture()
  assert.equal(empty.job_inclusions, '')
  assert.equal(normalizeContentsClearanceCapture({ job_exclusions: 'Piano removal.' }).job_exclusions, 'Piano removal.')
})

test('contents clearance prints job-only items as extra dot points', () => {
  const standards = defaultContentsClearanceStandards()
  const content = contentsClearanceQuoteContent({
    reference: 'Q1',
    clientName: 'Client',
    siteAddress: '1 Main St',
    capture: { ...emptyContentsClearanceCapture(), job_inclusions: 'Removal of the shed contents.', job_exclusions: 'Piano removal.\nPool fence.', job_assumptions: 'Driveway access.' },
    standards,
  })
  const standardInclusions = standards.inclusions.split('\n')
  assert.deepEqual(content.inclusions, [...standardInclusions, 'Removal of the shed contents.'])
  assert.deepEqual(content.exclusions.slice(-2), ['Piano removal.', 'Pool fence.'])
  assert.equal(content.assumptions.at(-1), 'Driveway access.')
  assert.equal(standards.inclusions.includes('shed'), false)
})

test('surface area cleaning prints job-only items after the standard ones', () => {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'Q2',
    clientName: 'Client',
    siteAddress: '1 Main St',
    capture: { ...emptySurfaceAreaCleaningCapture(), job_inclusions: 'Garage floor.', job_exclusions: 'Carpet.', job_assumptions: 'Water on site.' },
    standards: defaultSurfaceAreaCleaningStandards(),
  })
  assert.equal(content.inclusions.at(-1), 'Garage floor.')
  assert.equal(content.exclusions.at(-1), 'Carpet.')
  assert.equal(content.assumptions.at(-1), 'Water on site.')
})

test('biohazard cleaning prints job-only items after the job clauses', () => {
  const content = biohazardCleaningQuoteContent({
    reference: 'Q3',
    clientName: 'Client',
    siteAddress: '1 Main St',
    capture: {
      ...emptyBiohazardCleaningCapture(),
      clauses: defaultBiohazardCleaningClauses(),
      job_inclusions: 'Mattress disposal.',
      job_exclusions: 'Roof cavity.',
      job_assumptions: 'Power on site.',
    },
  })
  assert.equal(content.inclusions.at(-1), 'Mattress disposal.')
  assert.equal(content.exclusions.at(-1), 'Roof cavity.')
  assert.equal(content.assumptions.at(-1), 'Power on site.')
})
