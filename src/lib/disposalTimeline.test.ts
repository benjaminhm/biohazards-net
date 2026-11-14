import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentData, CdrPhotoRead, DisposalLoad, Job } from '@/lib/types'
import { disposalRecordSummary, emptyDisposalManifestCapture, mergedDisposalManifestCapture } from '@/lib/disposalManifest'
import {
  compactLoadNumbers,
  eventsOf,
  formatEventWhen,
  loadIssues,
  localStamp,
  parseCdrPhotoRead,
  setContainerPreset,
  suggestCdrTags,
  syncCaptureWithPhotos,
  timelineSnapshot,
  unverifiedCount,
  verifyLoad,
  type CdrPhoto,
} from '@/lib/disposalTimeline'
import { composeDocumentContent } from '@/lib/composeDocument'
import { buildPrintHTML } from '@/lib/printDocument'

const SITE = { site_address: '12 Smith St, Chermside', site_lat: -27.385, site_lng: 153.03 }
const TIP = { lat: -27.37, lng: 153.09 }

/** Brisbane is UTC+10, so 8:10 am on 14 Nov is 22:10 UTC on 13 Nov. */
function at(hhmm: string, day = 14): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 10, day, h - 10, m)).toISOString()
}

function photo(id: string, time: string | null, where: 'site' | 'tip' | 'none', more: Partial<CdrPhoto> = {}): CdrPhoto {
  return {
    id,
    file_url: `https://cdn.example/${id}.jpg`,
    caption: '',
    taken_at: time ? at(time) : null,
    location_lat: where === 'site' ? SITE.site_lat : where === 'tip' ? TIP.lat : null,
    location_lng: where === 'site' ? SITE.site_lng : where === 'tip' ? TIP.lng : null,
    cdr_load: 0,
    cdr_role: null,
    cdr_read: null,
    ...more,
  }
}

function read(more: Partial<CdrPhotoRead>): CdrPhotoRead {
  return { role: 'load', container: '', contents_type: '', description: '', weight_kg: null, fee: null, facility: '', read_at: '', ...more }
}

function tags(map: Map<string, { load: number | null; role: string | null }>): string {
  return [...map.entries()].map(([id, t]) => `${id}=${t.load ?? '-'}${t.role ? `:${t.role}` : ''}`).join(' ')
}

test('camera time is shown in local time', () => {
  assert.equal(localStamp(at('08:10')), '2026-11-14T08:10')
  assert.equal(formatEventWhen('2026-11-14T08:10'), '14 Nov 2026, 8:10 am')
  assert.equal(formatEventWhen('2026-11-14T12:05'), '14 Nov 2026, 12:05 pm')
  assert.equal(formatEventWhen('2026-11-14'), '14 Nov 2026')
  assert.equal(localStamp(null), '')
})

test('photos at the site then away from it are one load, and coming back starts the next', () => {
  const suggested = suggestCdrTags([
    photo('a', '08:10', 'site'),
    photo('b', '08:14', 'site'),
    photo('c', '08:55', 'tip'),
    photo('d', '09:05', 'tip'),
    photo('e', '09:50', 'site'),
    photo('f', '10:30', 'tip'),
  ], SITE)
  assert.equal(tags(suggested), 'a=1:load b=1:load c=1:dropoff d=1:dropoff e=2:load f=2:dropoff')
  assert.equal(suggested.get('a')?.basis, 'gps')
})

test('a photo read as a docket is the docket, and a photo of something else is left out', () => {
  const suggested = suggestCdrTags([
    photo('a', '08:10', 'site'),
    photo('b', '08:55', 'tip'),
    photo('c', '09:05', 'tip', { cdr_read: read({ role: 'docket', weight_kg: 480, fee: 96 }) }),
    photo('d', '09:06', 'tip', { cdr_read: read({ role: 'other' }) }),
  ], SITE)
  assert.equal(tags(suggested), 'a=1:load b=1:dropoff c=1:docket d=-')
})

test('with no GPS the time gaps stand in, and the suggestion says so', () => {
  const suggested = suggestCdrTags([
    photo('a', '08:00', 'none'),
    photo('b', '08:05', 'none'),
    photo('c', '08:40', 'none'),
    photo('d', '10:00', 'none'),
  ], SITE)
  assert.equal(tags(suggested), 'a=1:load b=1:load c=1:dropoff d=2:load')
  assert.equal(suggested.get('c')?.basis, 'time')
})

test('a photo with no camera time is left for staff to place', () => {
  const suggested = suggestCdrTags([photo('a', '08:00', 'site'), photo('b', null, 'site')], SITE)
  assert.equal(suggested.has('b'), false)
})

test('two containers filled at the site before one tip run are two loads', () => {
  const suggested = suggestCdrTags([
    photo('ute', '08:00', 'site', { cdr_read: read({ container: 'ute' }) }),
    photo('trailer', '08:05', 'site', { cdr_read: read({ container: 'trailer' }) }),
    photo('tip', '08:50', 'tip'),
  ], SITE)
  assert.equal(tags(suggested), 'ute=1:load trailer=2:load tip=2:dropoff')
})

test('new photos number on from the loads already sorted, and join a load taken at the same stop', () => {
  const suggested = suggestCdrTags([
    photo('old', '08:10', 'site', { cdr_load: 1, cdr_role: 'load' }),
    photo('same-stop', '08:12', 'site'),
    photo('later', '13:00', 'site'),
  ], SITE)
  assert.equal(tags(suggested), 'same-stop=1:load later=2:load')
})

test('the camera tag on a photo decides its role', () => {
  const suggested = suggestCdrTags([
    photo('a', '08:10', 'none', { cdr_role: 'load' }),
    photo('b', '08:12', 'none', { cdr_role: 'docket' }),
  ], SITE)
  assert.equal(tags(suggested), 'a=1:load b=1:docket')
})

test('load numbers close up in order', () => {
  const compact = compactLoadNumbers(new Map([
    ['a', { load: 2, role: 'load' as const }],
    ['b', { load: 5, role: 'load' as const }],
    ['c', { load: null, role: null }],
    ['d', { load: 0, role: null }],
  ]))
  assert.equal(tags(compact), 'a=1:load b=2:load c=- d=0')
})

test('an image read keeps only what it can be trusted for', () => {
  assert.equal(parseCdrPhotoRead({ role: 'nonsense' }), null)
  const docket = parseCdrPhotoRead({ role: 'docket', weight_kg: '480', fee: '$96.50', facility: ' Nudgee RRC ', container: 'spaceship' })
  assert.deepEqual(
    { weight: docket?.weight_kg, fee: docket?.fee, facility: docket?.facility, container: docket?.container },
    { weight: 480, fee: 96.5, facility: 'Nudgee RRC', container: '' },
  )
  assert.equal(parseCdrPhotoRead({ role: 'load', weight_kg: 480 })?.weight_kg, null)
})

function trailerRun(): CdrPhoto[] {
  return [
    photo('load', '08:10', 'site', { cdr_load: 1, cdr_role: 'load', cdr_read: read({ container: 'trailer', contents_type: 'general', description: 'Mixed household contents' }) }),
    photo('tip', '08:55', 'tip', { cdr_load: 1, cdr_role: 'dropoff' }),
    photo('docket', '09:05', 'tip', { cdr_load: 1, cdr_role: 'docket', cdr_read: read({ role: 'docket', weight_kg: 480, fee: 96, facility: 'Nudgee Resource Recovery Centre' }) }),
  ]
}

function trailerCapture() {
  return setContainerPreset(
    { ...emptyDisposalManifestCapture(), loads: [], cost_per_m3: 100 },
    'trailer',
    { size: '8×5 trailer', length_m: 2.4, width_m: 1.5, height_m: 1 },
  )
}

test('tagged photos become a load with a timeline, and what the photos say fills the rest', () => {
  const { capture, changed } = syncCaptureWithPhotos(trailerCapture(), trailerRun(), SITE)
  assert.equal(changed, true)
  assert.equal(capture.loads.length, 1)
  const load = capture.loads[0]

  assert.deepEqual(eventsOf(load).map(e => `${e.role}@${e.at}`), [
    'load@2026-11-14T08:10',
    'dropoff@2026-11-14T08:55',
    'docket@2026-11-14T09:05',
  ])
  assert.equal(eventsOf(load)[0].place, '12 Smith St, Chermside')
  assert.equal(eventsOf(load)[0].description, 'Mixed household contents')

  // The older load fields mirror the timeline.
  assert.equal(load.vehicles[0].type, 'trailer')
  assert.equal(load.vehicles[0].photo_id, 'load')
  assert.equal(load.docket_photo_id, 'docket')
  assert.deepEqual(load.facility_photos.map(p => p.id), ['tip'])
  assert.equal(load.date, '2026-11-14')
  assert.equal(load.dump_date, '2026-11-14')
  assert.equal(load.dump_time, '09:05')
  assert.equal(load.dump_lat, TIP.lat)

  // Read from the photos, and flagged until someone checks them.
  assert.equal(load.vehicles[0].contents_type, 'general')
  assert.equal(load.weight_kg, 480)
  assert.equal(load.dump_fee, 96)
  assert.equal(load.facility, 'Nudgee Resource Recovery Centre')
  assert.deepEqual([...(load.suggested ?? [])].sort(), ['container', 'contents', 'dump_fee', 'facility', 'weight_kg'])
  assert.equal(unverifiedCount(load), 6)
  assert.deepEqual(loadIssues(load), [])

  // Billing is the container volume at the rate, as before.
  const record = disposalRecordSummary(capture, null)
  assert.equal(record.volume_m3, 3.6)
  assert.equal(record.summary.quantity_ex, 360)
})

test('the timeline survives a save and a reload', () => {
  const { capture } = syncCaptureWithPhotos(trailerCapture(), trailerRun(), SITE)
  const reloaded = mergedDisposalManifestCapture({ disposal_manifest_capture: JSON.parse(JSON.stringify(capture)) } as AssessmentData)
  assert.deepEqual(reloaded.loads[0].events, capture.loads[0].events)
  assert.equal(reloaded.containers?.trailer?.length_m, 2.4)
  assert.equal(syncCaptureWithPhotos(reloaded, trailerRun(), SITE).changed, false)
})

test('verifying a load turns its suggestions into values, and typed values stay when loads are renumbered', () => {
  const first = syncCaptureWithPhotos(trailerCapture(), trailerRun(), SITE).capture
  const verified = { ...first, loads: first.loads.map(l => ({ ...verifyLoad(l, '2026-11-15T00:00:00.000Z'), weight_kg: 500 })) }
  assert.equal(unverifiedCount(verified.loads[0]), 0)

  // An earlier load is tagged afterwards, so this one becomes load 2.
  const renumbered = [
    photo('early', '06:30', 'site', { cdr_load: 1, cdr_role: 'load' }),
    ...trailerRun().map(p => ({ ...p, cdr_load: 2 })),
  ]
  const next = syncCaptureWithPhotos(verified, renumbered, SITE)
  assert.equal(next.reopened, 0)
  assert.deepEqual(next.capture.loads.map(l => [l.cdr_number, l.weight_kg, Boolean(l.verified_at)]), [[1, null, false], [2, 500, true]])

  // A new photo on a verified load opens it for checking again.
  const added = syncCaptureWithPhotos(next.capture, [...renumbered, photo('tip2', '08:57', 'tip', { cdr_load: 2, cdr_role: 'dropoff' })], SITE)
  assert.equal(added.reopened, 1)
  assert.equal(added.capture.loads[1].verified_at, null)
  assert.equal(added.capture.loads[1].weight_kg, 500)
})

test('a load whose photos were all moved away goes, unless something was typed on it', () => {
  const run = trailerRun()
  const first = syncCaptureWithPhotos(trailerCapture(), [...run, photo('x', '13:00', 'site', { cdr_load: 2, cdr_role: 'load' })], SITE).capture
  assert.equal(first.loads.length, 2)
  const merged = syncCaptureWithPhotos(first, [...run, photo('x', '13:00', 'site', { cdr_load: 1, cdr_role: 'load' })], SITE).capture
  assert.equal(merged.loads.length, 1)

  const typed = { ...first, loads: first.loads.map((l, i) => (i === 1 ? { ...l, notes: 'Second run, no docket given' } : l)) }
  const kept = syncCaptureWithPhotos(typed, [...run, photo('x', '13:00', 'site', { cdr_load: 1, cdr_role: 'load' })], SITE).capture
  assert.equal(kept.loads.length, 2)
  assert.deepEqual(kept.loads[0].events, [])
})

test('a skip is a load: the docket fee is its hire cost and it has no tip', () => {
  const photos = [
    photo('skip', '08:10', 'site', { cdr_load: 1, cdr_role: 'load', cdr_read: read({ container: 'skip' }) }),
    photo('invoice', '16:00', 'none', { cdr_load: 1, cdr_role: 'docket', cdr_read: read({ role: 'docket', fee: 350, facility: 'Bins R Us' }) }),
  ]
  const capture = setContainerPreset({ ...emptyDisposalManifestCapture(), loads: [], cost_per_m3: 100 }, 'skip', { size: '6 m³ skip', length_m: 3, width_m: 2, height_m: 1 })
  const load = syncCaptureWithPhotos(capture, photos, SITE).capture.loads[0]
  assert.equal(load.vehicles[0].type, 'skip')
  assert.equal(load.vehicles[0].skip_cost, 350)
  assert.equal(load.dump_fee, null)
  assert.equal(load.facility, '')
  assert.deepEqual(loadIssues(load), [])
  assert.deepEqual(timelineSnapshot(load).map(e => e.title), ['Skip filled', 'Docket'])
})

test('the composed record prints the timeline, keeps costs off it, and leaves out what staff hide', () => {
  const capture = syncCaptureWithPhotos(trailerCapture(), trailerRun(), SITE).capture
  const hidden: DisposalLoad = {
    ...capture.loads[0],
    events: capture.loads[0].events?.map(e => (e.role === 'docket' ? { ...e, show_to_client: false } : e)),
  }
  const job = {
    id: 'job-1',
    ...SITE,
    assessment_data: { disposal_manifest_capture: { ...capture, loads: [hidden] } },
  } as unknown as Job
  const composed = composeDocumentContent('waste_disposal_manifest', job)
  const html = buildPrintHTML('waste_disposal_manifest', composed.content as unknown as Record<string, unknown>, [], [], null, 'job-1', 'https://app.example')

  assert.match(html, /14 Nov 2026, 8:10 am/)
  assert.match(html, /Trailer loaded/)
  assert.match(html, /Mixed household contents/)
  assert.match(html, /Load tipped/)
  assert.match(html, /cdn\.example\/tip\.jpg/)
  assert.doesNotMatch(html, /cdn\.example\/docket\.jpg/)
  assert.doesNotMatch(html, /\$96/)
  assert.match(html, /3\.60 m³/)
})

test('a record entered the older way reads as a timeline without being changed', () => {
  const capture = mergedDisposalManifestCapture({
    disposal_manifest_capture: {
      loads: [{
        id: 'old', date: '2026-11-01', dump_date: '2026-11-01', dump_time: '10:15', facility: 'Nudgee tip',
        vehicles: [{ id: 'v', type: 'ute', photo_id: 'p1', photo_url: 'https://cdn.example/p1.jpg' }],
        docket_photo_id: 'p2', docket_photo_url: 'https://cdn.example/p2.jpg',
      }],
    },
  } as unknown as AssessmentData)
  const load = capture.loads[0]
  assert.equal(load.events, undefined)
  assert.deepEqual(eventsOf(load).map(e => `${e.role}@${e.at}`), ['load@2026-11-01', 'docket@2026-11-01T10:15'])
  assert.deepEqual(timelineSnapshot(load), [])
  // Tagged photos are added beside it, and it is left as it was.
  const next = syncCaptureWithPhotos(capture, trailerRun(), SITE).capture
  assert.deepEqual(next.loads.map(l => l.id === 'old' ? 'old' : 'new'), ['old', 'new'])
  assert.deepEqual(next.loads[0], load)
})
