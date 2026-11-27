import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultSurfaceAreaCleaningStandards,
  normalizeSurfaceAreaCleaningCapture,
} from '@/lib/surfaceAreaCleaningQuote'
import {
  SURFACE_AREA_DRAFT_STAGES,
  acceptSurfaceAreaScopeDraft,
  hasSurfaceAreaScopeInputs,
  surfaceAreaScopeDraftPayload,
  surfaceAreaScopeDraftSchema,
} from '@/lib/surfaceAreaScopeDraft'

test('surface area scope draft schema is strict and requires grounding fields', () => {
  const schema = surfaceAreaScopeDraftSchema()
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['steps'])
  const item = schema.properties.steps.items
  assert.equal(item.additionalProperties, false)
  assert.deepEqual(item.properties.stage.enum, [...SURFACE_AREA_DRAFT_STAGES])
  assert.deepEqual(item.properties.addresses.enum, ['presentation', 'objective', 'both'])
  assert.deepEqual(item.required, ['stage', 'text', 'addresses', 'basis', 'where', 'what', 'how', 'pass'])
})

test('surface area scope draft payload relies on presentation and objective and omits prices and PII', () => {
  const capture = normalizeSurfaceAreaCleaningCapture({
    cleaning_kind: 'squalor',
    job_address: '26 Pectoral Place, Banksia Beach QLD',
    rate_per_m2: 37,
    rate_per_labour_day: 600,
    labour_days: 3,
    exclude_ceiling: true,
    presentation: 'Squalor noted under hoarding situation with cockroach and rodent faeces.',
    objective: 'Remediate gross filth and reduce odours to make the property safe for restoration works.',
    rooms: [
      { id: '1', name: 'Kitchen', length_m: 4, width_m: 3.2, height_m: 2.4 },
      { id: '2', name: 'Living', length_m: 5, width_m: 4, height_m: 2.4 },
    ],
  })
  assert.equal(hasSurfaceAreaScopeInputs(capture), true)
  assert.equal(hasSurfaceAreaScopeInputs(normalizeSurfaceAreaCleaningCapture({})), false)

  const payload = surfaceAreaScopeDraftPayload(capture, defaultSurfaceAreaCleaningStandards())
  assert.equal(payload.presentation, capture.presentation)
  assert.equal(payload.objective, capture.objective)
  assert.equal(payload.ceilings_excluded, true)
  assert.match(payload.surfaces_included, /ceilings are excluded/)
  assert.deepEqual(payload.rooms, ['Kitchen', 'Living'])
  assert.ok(payload.exclusions.some(line => /ceiling/i.test(line)))
  const serialized = JSON.stringify(payload)
  assert.doesNotMatch(serialized, /Pectoral Place|37|600/)
})

test('acceptSurfaceAreaScopeDraft keeps auditable steps and filters disallowed or ceiling-excluded lines', () => {
  const parsed = {
    steps: [
      {
        stage: 'setup',
        text: 'Establish site containment and wear P2 respirators to AS/NZS 1715, coveralls, and nitrile gloves across the Kitchen and Living areas.',
        addresses: 'presentation',
        basis: 'squalor and rodent faeces',
        where: 'Kitchen and Living areas',
        what: 'site containment',
        how: 'P2 respirators to AS/NZS 1715, coveralls, and nitrile gloves',
        pass: '',
      },
      {
        stage: 'cleaning',
        text: 'HEPA vacuum loose insect and rodent debris from Kitchen and Living floors and walls, then scrub with an enzymatic detergent to remove sebum and gross filth.',
        addresses: 'both',
        basis: 'cockroach and rodent faeces, sebum, and gross filth',
        where: 'Kitchen and Living floors and walls',
        what: 'sebum and gross filth',
        how: 'scrub with an enzymatic detergent',
        pass: '',
      },
      {
        stage: 'cleaning',
        text: 'Wash Kitchen ceilings with alkaline detergent to remove fly spotting.',
        addresses: 'presentation',
        basis: 'flies spreading contamination to ceiling',
        where: 'Kitchen ceilings',
        what: 'fly spotting',
        how: 'alkaline detergent',
        pass: '',
      },
      {
        stage: 'disinfection',
        text: 'Apply a TGA-registered hospital-grade disinfectant to all cleaned floors and walls across the Kitchen and Living rooms.',
        addresses: 'both',
        basis: 'prepare surfaces for restoration works',
        where: 'cleaned floors and walls across the Kitchen and Living rooms',
        what: 'cleaned floors and walls',
        how: 'TGA-registered hospital-grade disinfectant',
        pass: '',
      },
      {
        stage: 'deodorisation',
        text: 'Perform thermal fogging with an odour counteractant across the Kitchen and Living rooms to reduce residual squalor and decomposition odours.',
        addresses: 'objective',
        basis: 'reduce odours post hoarding and unattended death',
        where: 'Kitchen and Living rooms',
        what: 'residual squalor and decomposition odours',
        how: 'thermal fogging with an odour counteractant',
        pass: '',
      },
      {
        stage: 'verification',
        text: 'Conduct a final visual and olfactory inspection of Kitchen and Living floors and walls to confirm no visible residue or staining and no detectable odour from treated surfaces.',
        addresses: 'objective',
        basis: 'property ready for restoration works',
        where: 'Kitchen and Living floors and walls',
        what: 'treated surfaces',
        how: 'visual and olfactory inspection',
        pass: 'no visible residue or staining and no detectable odour',
      },
      {
        stage: 'verification',
        text: 'Arrange ATP testing with a Certified Occupational Hygienist for $1,500.',
        addresses: 'objective',
        basis: 'verification',
        where: 'site',
        what: 'ATP testing',
        how: 'ATP testing',
        pass: '',
      },
    ],
  }

  const draft = acceptSurfaceAreaScopeDraft(parsed, { excludeCeiling: true })
  assert.ok(draft)
  const lines = draft.scope.split('\n')
  assert.equal(lines.length, 5)
  assert.equal(draft.weak.length, 0)
  assert.deepEqual(
    draft.dropped.map(item => item.reason),
    ['ceiling_excluded', 'service'],
  )
  assert.doesNotMatch(draft.scope, /ceilings|ATP|Hygienist|\$1,500/)
})

test('acceptSurfaceAreaScopeDraft flags vague methods and missing pass criteria as weak', () => {
  const parsed = {
    steps: [
      {
        stage: 'cleaning',
        text: 'Clean the Bedroom floors and walls using appropriate products.',
        addresses: 'presentation',
        basis: 'squalor',
        where: 'Bedroom floors and walls',
        what: 'Bedroom floors and walls',
        how: 'appropriate products',
        pass: '',
      },
      {
        stage: 'disinfection',
        text: 'Disinfect Bedroom walls and floors with a TGA-registered hospital-grade disinfectant.',
        addresses: 'both',
        basis: 'squalor remediation',
        where: 'Bedroom walls and floors',
        what: 'Bedroom walls and floors',
        how: 'TGA-registered hospital-grade disinfectant',
        pass: '',
      },
      {
        stage: 'verification',
        text: 'Inspect the Bedroom walls and floors by visual check when finished.',
        addresses: 'objective',
        basis: 'restoration readiness',
        where: 'Bedroom walls and floors',
        what: 'Bedroom walls and floors',
        how: 'visual check',
        pass: '',
      },
    ],
  }

  const draft = acceptSurfaceAreaScopeDraft(parsed)
  assert.ok(draft)
  assert.deepEqual(
    draft.weak.map(item => item.gap),
    ['how', 'pass'],
  )
})
