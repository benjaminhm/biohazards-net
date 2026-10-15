import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STAFF_SESSION_DAYS,
  STAFF_SESSION_MAX_AGE,
  staffCookieHeader,
  staffSessionIsStale,
} from '@/lib/staffSession'

test('staff cookie stays signed in for 30 days on a home-screen web app', () => {
  const now = Date.UTC(2026, 9, 15, 0, 0, 0)
  const header = staffCookieHeader('tok.en.value', true, now)
  const expires = new Date(now + STAFF_SESSION_MAX_AGE * 1000).toUTCString()

  assert.equal(STAFF_SESSION_DAYS, 30)
  assert.equal(STAFF_SESSION_MAX_AGE, 30 * 24 * 60 * 60)
  assert.ok(header.startsWith('bh_staff=tok.en.value'))
  assert.ok(header.includes('HttpOnly'))
  assert.ok(header.includes('Secure'))
  assert.ok(header.includes('SameSite=Lax'))
  assert.ok(header.includes(`Max-Age=${STAFF_SESSION_MAX_AGE}`))
  assert.ok(header.includes(`Expires=${expires}`))
  assert.equal(header.includes('Domain='), false)
  assert.equal(expires.includes('('), false)
})

test('localhost cookie omits Secure so dev http still stores it', () => {
  const header = staffCookieHeader('tok', false, Date.UTC(2026, 9, 15))
  assert.equal(header.includes('Secure'), false)
  assert.ok(header.includes('Expires='))
})

test('a session older than an hour is renewed', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0)
  const fresh = Math.floor(now / 1000) - 60
  const stale = Math.floor(now / 1000) - 60 * 60
  assert.equal(staffSessionIsStale(fresh, now), false)
  assert.equal(staffSessionIsStale(stale, now), true)
  assert.equal(staffSessionIsStale(0, now), true)
})
