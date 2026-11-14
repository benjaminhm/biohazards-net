import test from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentData, Photo } from './types'
import { photoMeta, photosFor, selectedPhotos, selectionIds, usedPhotoIds } from './photoSelection'
import { chosenPhotoIds, photosForComposedReports } from './photosForComposedReports'

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return { id, job_id: 'j', file_url: `https://x/${id}.jpg`, caption: '', area_ref: '', category: 'untagged', uploaded_at: '2026-11-14T00:00:00.000Z', ...extra }
}

const photos = [photo('a', { area_ref: 'Kitchen' }), photo('b'), photo('c', { area_ref: 'Kitchen' })]
const kitchen = (list: readonly Photo[]) => list.filter(p => p.area_ref === 'Kitchen')

test('a list keeps its order and skips photos no longer on the job', () => {
  assert.deepEqual(selectedPhotos(['c', 'gone', 'a', 'c'], photos).map(p => p.id), ['c', 'a'])
})

test('no list falls back to the old rule; an empty list means none', () => {
  assert.deepEqual(photosFor(undefined, photos, kitchen).map(p => p.id), ['a', 'c'])
  assert.deepEqual(photosFor(null, photos, kitchen).map(p => p.id), ['a', 'c'])
  assert.deepEqual(photosFor([], photos, kitchen), [])
  assert.deepEqual(photosFor(['b'], photos, kitchen).map(p => p.id), ['b'])
  assert.deepEqual(selectionIds(undefined, photos, kitchen), ['a', 'c'])
})

test('used ids gather every document list and sorted disposal photos', () => {
  const data = {
    areas: [{ name: 'Kitchen', photo_ids: ['a'], during_photo_ids: ['b'], after_photo_ids: ['x1'] }],
    contents_clearance_quote: { photo_ids: ['x2'] },
    outcome_quotes: [{ photo_ids: ['x3'] }],
    pre_multi_part: [{ before_photo_ids: ['x4'], after_photo_ids: ['x5'] }],
    post_remediation_evaluations: [{ report_image_ids: ['x6'] }],
    fast_quote: { enabled: true, photo_ids: ['x7'] },
    outcome_quote_capture: { photo_ids: ['x8'] },
  } as unknown as AssessmentData
  const used = usedPhotoIds(data, [photo('d', { cdr_load: 2 }), photo('e', { cdr_load: 0 })])
  assert.deepEqual([...used].sort(), ['a', 'b', 'd', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'])
})

test('a photo switched off for reports still prints where a document chose it', () => {
  const list = [photo('a', { include_in_composed_reports: false }), photo('b', { include_in_composed_reports: false }), photo('c')]
  const areas = [{ name: 'Kitchen', sqm: 0, hazard_level: 1, description: '', after_photo_ids: ['b'] }]
  const chosen = chosenPhotoIds({ photo_ids: ['a'] }, areas)
  assert.deepEqual(photosForComposedReports(list, chosen).map(p => p.id), ['a', 'b', 'c'])
  assert.deepEqual(photosForComposedReports(list).map(p => p.id), ['c'])
  assert.deepEqual([...chosenPhotoIds({ report_image_ids: ['a'] })], [])
  assert.deepEqual([...chosenPhotoIds({ report_image_ids: ['a'], report_images_chosen: true })], ['a'])
})

test('the footer shows camera time in Brisbane, the place, and who loaded it', () => {
  const meta = photoMeta(photo('a', {
    taken_at: '2026-11-13T22:10:00.000Z',
    location_lat: -27.47,
    location_lng: 153.02,
    uploaded_by_name: 'Ben (U-3F9A2C)',
  }))
  assert.equal(meta.when, '14 Nov 2026, 8:10 am')
  assert.equal(meta.whenIsUpload, false)
  assert.equal(meta.place, '-27.47000, 153.02000')
  assert.ok(meta.mapUrl?.includes('-27.47,153.02'))
  assert.equal(meta.by, 'Ben (U-3F9A2C)')
})

test('with no camera time the footer says when it was loaded', () => {
  const meta = photoMeta(photo('a', { location_label: '12 Smith St, Ipswich' }))
  assert.equal(meta.when, '14 Nov 2026, 10:00 am')
  assert.equal(meta.whenIsUpload, true)
  assert.equal(meta.place, '12 Smith St, Ipswich')
  assert.equal(meta.mapUrl, null)
})
