import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRADING_NAME_IDS,
  TRADING_NAME_OPTIONS,
  applyTradingBrand,
  isTradingNameId,
  tradingAuthReplyEmail,
  tradingNameLabel,
} from '@/lib/tradingNames'
import { PORTAL_TERMS } from '@/lib/portal/terms'
import type { CompanyProfile } from '@/lib/types'

const company: CompanyProfile = {
  id: 'c1',
  name: 'Settings Name',
  abn: '12 345 678 901',
  phone: '07 0000 0000',
  email: 'settings@example.com',
  address: '1 Example St',
  licence: '',
  tagline: '',
  logo_url: 'https://cdn.example/logo.png',
  subdomain: null,
  custom_domain: null,
  updated_at: '',
}

test('every id has exactly one option', () => {
  assert.deepEqual(TRADING_NAME_OPTIONS.map(o => o.id), [...TRADING_NAME_IDS])
})

test('each trading name has its own staff shorthand', () => {
  assert.deepEqual(
    TRADING_NAME_OPTIONS.map(o => [o.id, o.short]),
    [
      ['brisbane_biohazard_cleaning', 'BCQ'],
      ['forensic_cleaning_qld', 'FCQ'],
      ['hoarding_cleaning_qld', 'HCQ'],
    ],
  )
})

test('brisbane_biohazard_cleaning id is kept and displays as Biohazard Cleaning QLD', () => {
  assert.ok(isTradingNameId('brisbane_biohazard_cleaning'))
  assert.equal(tradingNameLabel('brisbane_biohazard_cleaning'), 'Biohazard Cleaning QLD')
  assert.equal(applyTradingBrand(company, 'brisbane_biohazard_cleaning')?.name, 'Biohazard Cleaning QLD')
})

test('hoarding_cleaning_qld uses a wordmark and Settings email', () => {
  assert.ok(isTradingNameId('hoarding_cleaning_qld'))
  assert.equal(tradingNameLabel('hoarding_cleaning_qld'), 'Hoarding Cleaning QLD')
  const branded = applyTradingBrand(company, 'hoarding_cleaning_qld')
  assert.equal(branded?.name, 'Hoarding Cleaning QLD')
  assert.equal(branded?.email, 'settings@example.com')
  assert.equal(branded?.logo_url, null)
  assert.equal(tradingAuthReplyEmail('hoarding_cleaning_qld', company.email), 'settings@example.com')
})

test('portal terms exist for every trading name', () => {
  for (const id of TRADING_NAME_IDS) assert.ok(PORTAL_TERMS[id], id)
  assert.match(PORTAL_TERMS.hoarding_cleaning_qld.title, /^Hoarding Cleaning QLD/)
})
