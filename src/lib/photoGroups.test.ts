import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupPhotosByRoomAndStage } from './photoGroups'
import type { Area, Photo } from './types'

const photo = (id: string, category: string, area_ref = ''): Photo =>
  ({ id, job_id: 'j', file_url: `${id}.jpg`, category, area_ref, caption: '', uploaded_at: '' }) as unknown as Photo
const area = (name: string, extra: Partial<Area> = {}): Area => ({ name, sqm: 0, hazard_level: 1, description: '', ...extra })
const ids = (list: Photo[]) => list.map(p => p.id)

test('rooms without lists keep the area and stage rule', () => {
  const groups = groupPhotosByRoomAndStage([photo('a', 'before', 'Kitchen'), photo('b', 'after', 'Kitchen')], [area('Kitchen')])
  assert.deepEqual(ids(groups[0].stages.before), ['a'])
  assert.deepEqual(ids(groups[0].stages.after), ['b'])
})

test('untagged folder photos print only when chosen', () => {
  const photos = [photo('u1', 'untagged'), photo('u2', 'untagged', 'Kitchen')]
  assert.deepEqual(groupPhotosByRoomAndStage(photos, [area('Kitchen')])[0].photos, [])
  const groups = groupPhotosByRoomAndStage(photos, [area('Kitchen', { photo_ids: ['u1'] })])
  assert.deepEqual(ids(groups[0].stages.assessment), ['u1'])
  assert.equal(groups.length, 1)
})

test('a chosen list replaces the old rule for its stages only, in chosen order', () => {
  const photos = [photo('a', 'before', 'Kitchen'), photo('b', 'during', 'Kitchen'), photo('c', 'untagged'), photo('d', 'untagged')]
  const groups = groupPhotosByRoomAndStage(photos, [area('Kitchen', { photo_ids: ['d', 'c'], after_photo_ids: [] })])
  const k = groups[0]
  assert.deepEqual(ids(k.stages.assessment), ['d', 'c'])
  assert.deepEqual(k.stages.before, [])
  assert.deepEqual(ids(k.stages.during), ['b'])
  assert.deepEqual(k.stages.after, [])
  assert.equal(k.stages.assessment[0].category, 'assessment')
})

test('a photo chosen in one room is not also placed by its old area', () => {
  const photos = [photo('a', 'after', 'Kitchen')]
  const groups = groupPhotosByRoomAndStage(photos, [area('Kitchen'), area('Lounge', { after_photo_ids: ['a'] })])
  assert.deepEqual(groups.find(g => g.room === 'Kitchen')!.photos, [])
  assert.deepEqual(ids(groups.find(g => g.room === 'Lounge')!.stages.after), ['a'])
})
