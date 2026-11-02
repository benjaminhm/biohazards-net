import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDaysYmd,
  awayFromSite,
  bonusCents,
  bonusOutcome,
  callbackStillOpen,
  DEFAULT_RATES,
  haversineMetres,
  missingForClose,
  photoFlagReasons,
  stepIsComplete,
  stepUnlocked,
  type StepState,
} from '@/lib/jobRecords'

function step(partial: Partial<StepState> & Pick<StepState, 'step_type' | 'title'>): StepState {
  return {
    required: true,
    min_photos: 1,
    checklist_items: [],
    ticks: [],
    note_text: '',
    test_text: '',
    chemical_id: null,
    dwell_minutes: null,
    dwell_started_at: null,
    photo_count: 0,
    completed_at: null,
    ...partial,
  }
}

test('200 m from the site is flagged, closer is not', () => {
  const site = { lat: -27.47, lng: 153.02 }
  const near = haversineMetres(site.lat, site.lng, -27.4701, 153.0201)
  assert.ok(near < 200)
  assert.equal(awayFromSite(-27.4701, 153.0201, site.lat, site.lng), false)
  assert.equal(awayFromSite(-27.48, 153.02, site.lat, site.lng), true)
})

test('a photo is flagged for clock skew or distance', () => {
  const server = new Date('2026-11-01T04:00:00.000Z')
  const reasons = photoFlagReasons({
    deviceTime: new Date('2026-11-01T00:00:00.000Z'),
    serverTime: server,
    lat: -27.5,
    lng: 153.02,
    siteLat: -27.47,
    siteLng: 153.02,
  })
  assert.equal(reasons.length, 2)
  const clean = photoFlagReasons({
    deviceTime: new Date('2026-11-01T04:30:00.000Z'),
    serverTime: server,
    lat: -27.4701,
    lng: 153.0201,
    siteLat: -27.47,
    siteLng: 153.02,
  })
  assert.deepEqual(clean, [])
})

test('required steps stay locked until the one before them is done', () => {
  const steps = [
    step({ title: 'Before', step_type: 'photo', min_photos: 1, photo_count: 0 }),
    step({ title: 'After', step_type: 'photo', min_photos: 1, photo_count: 2 }),
  ]
  assert.equal(stepUnlocked(steps, 1), false)
  steps[0].photo_count = 1
  assert.equal(stepIsComplete(steps[0]), true)
  assert.equal(stepUnlocked(steps, 1), true)
})

test('a chemical step waits out the dwell time', () => {
  const started = Date.parse('2026-11-01T04:00:00.000Z')
  const chemical = step({
    title: 'Disinfect',
    step_type: 'chemical',
    photo_count: 1,
    chemical_id: 'c1',
    dwell_minutes: 10,
    dwell_started_at: new Date(started).toISOString(),
  })
  assert.equal(stepIsComplete(chemical, started + 9 * 60_000), false)
  assert.equal(stepIsComplete(chemical, started + 10 * 60_000), true)
})

test('close-out lists uploads and unfinished required steps', () => {
  const steps = [
    step({ title: 'Before photos', step_type: 'photo', min_photos: 2, photo_count: 1 }),
    step({ title: 'Skip me', step_type: 'note', required: false }),
  ]
  const missing = missingForClose(steps, 2)
  assert.deepEqual(missing, ['2 photos still uploading', 'Before photos'])
})

test('bonus rates and the 14-day gate', () => {
  assert.equal(bonusCents({
    jobType: 'hoarding',
    quotedM3: 4,
    quotedM2: null,
    rates: DEFAULT_RATES,
    upliftPercent: 10,
    isLead: true,
  }), 4400)
  assert.equal(bonusCents({
    jobType: 'squalor',
    quotedM3: null,
    quotedM2: 10,
    rates: DEFAULT_RATES,
    upliftPercent: 0,
    isLead: false,
  }), 2500)

  const closed = '2026-11-01T01:00:00.000Z'
  const pending = bonusOutcome({
    recordsComplete: true,
    recordsMissing: '',
    callbackRequired: false,
    callbackReason: null,
    closedAt: closed,
    bonusCents: 10000,
    now: new Date('2026-11-10T00:00:00.000Z'),
  })
  assert.equal(pending.status, 'pending')
  assert.equal(callbackStillOpen(closed, new Date('2026-11-14T10:00:00.000Z')), true)
  const earned = bonusOutcome({
    recordsComplete: true,
    recordsMissing: '',
    callbackRequired: false,
    callbackReason: null,
    closedAt: closed,
    bonusCents: 10000,
    now: new Date('2026-11-15T00:00:00.000Z'),
  })
  assert.equal(earned.status, 'earned')
  assert.equal(earned.cents, 10000)
  assert.equal(addDaysYmd('2026-11-01', 14), '2026-11-15')
})
