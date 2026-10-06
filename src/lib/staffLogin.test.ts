import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyStaffToken,
  consumeStaffLogin,
  isStaffEmailAllowlisted,
  issueStaffLogin,
  type StaffTokenRow,
  type StaffTokenStore,
} from '@/lib/staffLogin'

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
