import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ENGAGEMENT_AGREEMENT,
  fillEngagementAgreement,
  persistableEngagement,
  sharedEngagementAgreement,
  storedEngagementAgreement,
} from '@/lib/quoteEngagement'

test('the contents clearance agreement is kept when both quotes have text', () => {
  assert.equal(sharedEngagementAgreement('<p>Clearance terms</p>', '<p>Cleaning terms</p>'), '<p>Clearance terms</p>')
})

test('a surface cleaning agreement fills an empty contents clearance agreement', () => {
  assert.equal(sharedEngagementAgreement('<p></p>', '<p>Cleaning terms</p>'), '<p>Cleaning terms</p>')
})

test('an empty editor does not replace saved text', () => {
  assert.equal(sharedEngagementAgreement('', '<p>Kept</p>'), '<p>Kept</p>')
})

test('an empty saved agreement is replaced by the default', () => {
  assert.equal(storedEngagementAgreement('', DEFAULT_ENGAGEMENT_AGREEMENT), DEFAULT_ENGAGEMENT_AGREEMENT)
  assert.equal(storedEngagementAgreement('<p></p>', DEFAULT_ENGAGEMENT_AGREEMENT), DEFAULT_ENGAGEMENT_AGREEMENT)
  assert.equal(storedEngagementAgreement('<p>Kept for this company.</p>', DEFAULT_ENGAGEMENT_AGREEMENT), '<p>Kept for this company.</p>')
})

test('an empty editor is not persisted over the last saved agreement', () => {
  assert.equal(persistableEngagement('<p></p>', DEFAULT_ENGAGEMENT_AGREEMENT, DEFAULT_ENGAGEMENT_AGREEMENT), DEFAULT_ENGAGEMENT_AGREEMENT)
  assert.equal(persistableEngagement('', '<p>Kept.</p>', DEFAULT_ENGAGEMENT_AGREEMENT), '<p>Kept.</p>')
  assert.equal(persistableEngagement('<p>Edited.</p>', DEFAULT_ENGAGEMENT_AGREEMENT, DEFAULT_ENGAGEMENT_AGREEMENT), '<p>Edited.</p>')
})

test('brackets are filled from the quote, and a missing field is left out', () => {
  const filled = fillEngagementAgreement(
    '<p>For [name] at [address], [volume], total [total]. Call-out [mobilisation]. Surface [surface]. Keep [custom].</p>',
    {
      name: 'Acme & Co',
      address: '1 Example Street',
      volume: 18,
      total: 3630,
      mobilisation: 0,
    },
  )
  assert.match(filled, /Acme &amp; Co/)
  assert.match(filled, /1 Example Street/)
  assert.match(filled, /18 m³/)
  assert.match(filled, /\$3,630\.00/)
  assert.doesNotMatch(filled, /\[mobilisation\]/)
  assert.doesNotMatch(filled, /\[surface\]/)
  assert.doesNotMatch(filled, /Call-out/)
  assert.match(filled, /\[custom\]/)
})
