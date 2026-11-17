import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultClientVisible, groupPosts, isClientVisible, jobPhotoPath, type FeedPhotoFields } from './feed'
import { parseTrackingIdentity, displayMobile } from './identity'

function photo(id: string, at: string, over: Partial<FeedPhotoFields> = {}): FeedPhotoFields {
  return {
    id,
    file_url: `https://x.supabase.co/storage/v1/object/public/job-photos/job/${id}.jpg`,
    area_ref: 'Kitchen',
    category: 'during',
    capture_phase: 'progress',
    taken_at: at,
    uploaded_at: at,
    client_visible: null,
    client_caption: '',
    cdr_load: null,
    ...over,
  }
}

test('progress, during and after show by default; assessment and disposal photos do not', () => {
  assert.equal(defaultClientVisible(photo('a', '2026-11-16T00:00:00Z')), true)
  assert.equal(defaultClientVisible(photo('b', '2026-11-16T00:00:00Z', { category: 'after', capture_phase: 'assessment' })), true)
  assert.equal(defaultClientVisible(photo('c', '2026-11-16T00:00:00Z', { category: 'untagged', capture_phase: 'assessment' })), false)
  assert.equal(defaultClientVisible(photo('d', '2026-11-16T00:00:00Z', { cdr_load: 1 })), false)
})

test('staff override wins either way', () => {
  assert.equal(isClientVisible(photo('a', '2026-11-16T00:00:00Z', { client_visible: false })), false)
  assert.equal(isClientVisible(photo('b', '2026-11-16T00:00:00Z', { category: 'before', capture_phase: 'assessment', client_visible: true })), true)
})

test('same area within 30 minutes of the last photo is one post, oldest first', () => {
  const posts = groupPosts([
    photo('c', '2026-11-16T01:10:00Z'),
    photo('a', '2026-11-16T00:00:00Z'),
    photo('b', '2026-11-16T00:25:00Z', { area_ref: ' kitchen ', client_caption: 'Benches done' }),
    photo('d', '2026-11-16T01:20:00Z', { area_ref: 'Bathroom' }),
    photo('e', '2026-11-16T01:30:00Z', { area_ref: 'Bathroom', taken_at: null }),
  ])
  assert.deepEqual(posts.map(p => p.photos.map(x => x.id)), [['a', 'b'], ['c'], ['d', 'e']])
  assert.equal(posts[0].id, 'a')
  assert.equal(posts[0].caption, 'Benches done')
})

test('bucket path from the public URL', () => {
  assert.equal(jobPhotoPath('https://x.supabase.co/storage/v1/object/public/job-photos/j1/p_1.jpg'), 'j1/p_1.jpg')
  assert.equal(jobPhotoPath('https://elsewhere.com/a.jpg'), null)
})

test('sign-in identity: Australian mobile or email', () => {
  assert.deepEqual(parseTrackingIdentity('0412 345 678'), { kind: 'mobile', value: '+61412345678' })
  assert.deepEqual(parseTrackingIdentity(' Jo@Example.com '), { kind: 'email', value: 'jo@example.com' })
  assert.equal(parseTrackingIdentity('07 3000 0000'), null)
  assert.equal(displayMobile('+61412345678'), '0412 345 678')
})
