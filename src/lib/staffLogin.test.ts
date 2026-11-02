import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyStaffToken,
  consumeStaffLogin,
  isStaffEmailAllowlisted,
  issueStaffLogin,
  type StaffIdentityLookup,
  type StaffTokenRow,
  type StaffTokenStore,
} from '@/lib/staffLogin'
import { decideStaffAccess, staffHomePath } from '@/lib/staffDesk'
import { browserOrigin, isSecureStaffRequest, magicLinkOrigin } from '@/lib/staffSession'

function memoryStore(): StaffTokenStore & { rows: StaffTokenRow[] } {
  const rows: StaffTokenRow[] = []
  return {
    rows,
    async countRecent(email, ip, sinceIso) {
      const since = new Date(sinceIso).getTime()
      return {
        byEmail: rows.filter(r => r.email === email).length,
        byIp: ip ? rows.filter(() => since <= Date.now()).length : 0,
      }
    },
    async insert(row) {
      rows.push({
        id: `row-${rows.length + 1}`,
        email: row.email,
        token_hash: row.token_hash,
        expires_at: row.expires_at,
        consumed_at: null,
      })
      return true
    },
    async findByHash(hash) {
      return rows.find(r => r.token_hash === hash) ?? null
    },
    async burnIfFresh(id) {
      const row = rows.find(r => r.id === id)
      if (!row || row.consumed_at) return false
      row.consumed_at = new Date().toISOString()
      return true
    },
  }
}

test('allowlist matches the configured address only, ignoring case', () => {
  assert.equal(isStaffEmailAllowlisted('Owner@Example.com', 'owner@example.com'), true)
  assert.equal(isStaffEmailAllowlisted('other@example.com', 'owner@example.com'), false)
  assert.equal(isStaffEmailAllowlisted('owner@example.com', ''), false)
  assert.equal(isStaffEmailAllowlisted('owner@example.com', '   '), false)
  assert.equal(
    isStaffEmailAllowlisted('Second@Other.com', 'owner@example.com, second@other.com'),
    true
  )
  assert.equal(
    isStaffEmailAllowlisted('nope@other.com', 'owner@example.com, second@other.com'),
    false
  )
})

test('a token is classified before it is burned', () => {
  const fresh: StaffTokenRow = {
    id: '1',
    email: 'owner@example.com',
    token_hash: 'ab',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null,
  }
  assert.equal(classifyStaffToken(fresh), 'ok')
  assert.equal(classifyStaffToken({ ...fresh, consumed_at: new Date().toISOString() }), 'used')
  assert.equal(
    classifyStaffToken({ ...fresh, expires_at: new Date(Date.now() - 1000).toISOString() }),
    'expired'
  )
  assert.equal(classifyStaffToken(null), 'missing')
})

test('only the allowlisted address is issued, and consuming burns the link', async () => {
  process.env.STAFF_LOGIN_EMAIL = 'owner@example.com'
  process.env.STAFF_USER_ID = 'user_owner'
  const store = memoryStore()

  const ignored = await issueStaffLogin(store, 'someone@else.com', '1.1.1.1', 'test')
  assert.equal(ignored.status, 'ignored')
  assert.equal(store.rows.length, 0)

  const issued = await issueStaffLogin(store, 'Owner@Example.com', '1.1.1.1', 'test')
  assert.equal(issued.status, 'issued')
  assert.equal(store.rows.length, 1)
  if (issued.status !== 'issued') return

  const first = await consumeStaffLogin(store, issued.token)
  assert.equal(first.ok, true)
  if (first.ok) {
    assert.equal(first.userId, 'user_owner')
    assert.equal(first.email, 'owner@example.com')
  }
  assert.ok(store.rows[0]?.consumed_at)

  const second = await consumeStaffLogin(store, issued.token)
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.reason, 'used')
})

test('a technician email signs in as that person', async () => {
  process.env.STAFF_LOGIN_EMAIL = 'owner@example.com'
  process.env.STAFF_USER_ID = 'user_owner'
  const store = memoryStore()
  const lookup: StaffIdentityLookup = async email => (
    email === 'tech@example.com' ? { userId: 'person:tech' } : null
  )

  const ignored = await issueStaffLogin(store, 'nobody@example.com', '', 'test', lookup)
  assert.equal(ignored.status, 'ignored')

  const issued = await issueStaffLogin(store, 'Tech@Example.com', '', 'test', lookup)
  assert.equal(issued.status, 'issued')
  if (issued.status !== 'issued') return

  const consumed = await consumeStaffLogin(store, issued.token, lookup)
  assert.equal(consumed.ok, true)
  if (consumed.ok) {
    assert.equal(consumed.userId, 'person:tech')
    assert.equal(consumed.email, 'tech@example.com')
  }
})

test('the owner allowlist is not resolved through the technician lookup', async () => {
  process.env.STAFF_LOGIN_EMAIL = 'owner@example.com'
  process.env.STAFF_USER_ID = 'user_owner'
  const store = memoryStore()
  const lookup: StaffIdentityLookup = async () => {
    throw new Error('lookup should not run for the owner')
  }

  const issued = await issueStaffLogin(store, 'owner@example.com', '', 'test', lookup)
  assert.equal(issued.status, 'issued')
  if (issued.status !== 'issued') return

  const consumed = await consumeStaffLogin(store, issued.token, lookup)
  assert.equal(consumed.ok, true)
  if (consumed.ok) assert.equal(consumed.userId, 'user_owner')
})

test('a technician stays on the phone screen', () => {
  assert.equal(decideStaffAccess('member', '/tech'), 'allow')
  assert.equal(decideStaffAccess('member', '/api/me'), 'allow')
  assert.equal(decideStaffAccess('member', '/api/tech/jobs'), 'allow')
  assert.equal(decideStaffAccess('member', '/jobs'), 'redirect')
  assert.equal(decideStaffAccess('member', '/api/jobs'), 'forbid')
  assert.equal(decideStaffAccess('admin', '/jobs'), 'allow')
  assert.equal(decideStaffAccess('manager', '/records'), 'allow')
  assert.equal(decideStaffAccess(null, '/'), 'signed-out')
})

test('one login host, and the email role picks the first screen', () => {
  assert.equal(
    magicLinkOrigin('https://app.biohazards.net/api/auth/request', 'app.biohazards.net', 'https'),
    'https://login.biohazards.net',
  )
  assert.equal(
    magicLinkOrigin('https://login.biohazards.net/api/auth/request', 'login.biohazards.net', 'https'),
    'https://login.biohazards.net',
  )
  assert.equal(
    magicLinkOrigin('http://0.0.0.0:3000/api/auth/request', '192.168.1.4:3000', null),
    'http://192.168.1.4:3000',
  )
  assert.equal(staffHomePath('admin'), '/')
  assert.equal(staffHomePath('manager'), '/')
  assert.equal(staffHomePath('member'), '/tech')
})

test('a phone on the LAN stays on http and keeps a non-secure cookie', () => {
  assert.equal(browserOrigin('http://0.0.0.0:3000/records', '192.168.1.4:3000', null), 'http://192.168.1.4:3000')
  const lan = new Request('http://0.0.0.0:3000/', { headers: { host: '192.168.1.4:3000' } })
  assert.equal(isSecureStaffRequest(lan), false)
  const prod = new Request('https://app.biohazards.net/', { headers: { host: 'app.biohazards.net' } })
  assert.equal(isSecureStaffRequest(prod), true)
})

test('an expired link is rejected and left unburned', async () => {
  process.env.STAFF_LOGIN_EMAIL = 'owner@example.com'
  process.env.STAFF_USER_ID = 'user_owner'
  const store = memoryStore()
  const issued = await issueStaffLogin(store, 'owner@example.com', '', 'test')
  assert.equal(issued.status, 'issued')
  store.rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString()
  if (issued.status !== 'issued') return

  const result = await consumeStaffLogin(store, issued.token)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'expired')
  assert.equal(store.rows[0]?.consumed_at, null)
})
