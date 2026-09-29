import assert from 'node:assert/strict'
import test from 'node:test'
import { sharedEngagementAgreement } from '@/lib/quoteEngagement'

test('the contents clearance agreement is kept when both quotes have text', () => {
  assert.equal(sharedEngagementAgreement('<p>Clearance terms</p>', '<p>Cleaning terms</p>'), '<p>Clearance terms</p>')
})

test('a surface cleaning agreement fills an empty contents clearance agreement', () => {
  assert.equal(sharedEngagementAgreement('<p></p>', '<p>Cleaning terms</p>'), '<p>Cleaning terms</p>')
})

test('an empty editor does not replace saved text', () => {
  assert.equal(sharedEngagementAgreement('', '<p>Kept</p>'), '<p>Kept</p>')
})
