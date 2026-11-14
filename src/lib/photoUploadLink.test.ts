import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUploadTokenShape, newUploadToken, uploadLinkState, uploadLinkUrl } from './photoUploadLink'

test('tokens are long, random and url-safe', () => {
  const a = newUploadToken()
  const b = newUploadToken()
  assert.notEqual(a, b)
  assert.ok(isUploadTokenShape(a))
  assert.equal(isUploadTokenShape('short'), false)
  assert.equal(isUploadTokenShape('../../etc/passwd-aaaaaaaaaaaaaaaaaaaaaaaaaa'), false)
})

test('a link is open until it expires or is stopped', () => {
  const now = Date.parse('2026-11-14T09:00:00Z')
  assert.equal(uploadLinkState({ expires_at: '2026-11-14T10:00:00Z', revoked_at: null }, now), 'open')
  assert.equal(uploadLinkState({ expires_at: '2026-11-14T08:59:59Z', revoked_at: null }, now), 'expired')
  assert.equal(uploadLinkState({ expires_at: '2026-11-14T10:00:00Z', revoked_at: '2026-11-14T08:30:00Z' }, now), 'stopped')
  assert.equal(uploadLinkState({ expires_at: 'nonsense', revoked_at: null }, now), 'expired')
})

test('the live app links to the photo host; elsewhere stays on the same origin', () => {
  assert.equal(uploadLinkUrl('tok', 'https://app.biohazards.net'), 'https://photo.biohazards.net/drop/tok')
  assert.equal(uploadLinkUrl('tok', 'http://localhost:3000/'), 'http://localhost:3000/photo/drop/tok')
})
