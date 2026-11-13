import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRADING_NAME_IDS,
  TRADING_NAME_OPTIONS,
  applyTradingBrand,
  isTradingNameId,
  tradingAuthReplyEmail,
  tradingNameLabel,
  tradingNameShortList,
  tradingSendingEmail,
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
  assert.equal(new Set(TRADING_NAME_IDS).size, TRADING_NAME_IDS.length)
})

test('the ids already stored on jobs and accounts are all still accepted', () => {
  for (const id of ['brisbane_biohazard_cleaning', 'forensic_cleaning_qld', 'hoarding_cleaning_qld']) {
    assert.ok(isTradingNameId(id), id)
  }
  assert.equal(isTradingNameId('mackay_biohazard_cleaning'), false)
  assert.equal(isTradingNameId(''), false)
  assert.equal(isTradingNameId(null), false)
})

test('the shorthand list names every brand', () => {
  assert.equal(tradingNameShortList(), 'BCQ, FCQ or HCQ')
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

test('BCQ and FCQ use their own inbox, not the Settings email, and BCQ keeps the Settings logo', () => {
  const bcq = applyTradingBrand(company, 'brisbane_biohazard_cleaning')
  assert.equal(bcq?.email, 'admin@biohazardcleaningqld.com.au')
  assert.equal(bcq?.logo_url, 'https://cdn.example/logo.png')
  assert.equal(tradingAuthReplyEmail('brisbane_biohazard_cleaning', company.email), 'admin@biohazardcleaningqld.com.au')
  assert.equal(applyTradingBrand(company, 'forensic_cleaning_qld')?.email, 'admin@forensiccleaningqld.com.au')
})

test('mail is only sent from a brand address whose domain is verified', () => {
  assert.equal(tradingSendingEmail('forensic_cleaning_qld'), 'admin@forensiccleaningqld.com.au')
  assert.equal(tradingSendingEmail('brisbane_biohazard_cleaning'), null)
  assert.equal(tradingSendingEmail('hoarding_cleaning_qld'), null)
})

test('hoarding_cleaning_qld id is kept, displays as Hoarding Clearance QLD, and uses a wordmark and its own inbox', () => {
  assert.ok(isTradingNameId('hoarding_cleaning_qld'))
  assert.equal(tradingNameLabel('hoarding_cleaning_qld'), 'Hoarding Clearance QLD')
  const branded = applyTradingBrand(company, 'hoarding_cleaning_qld')
  assert.equal(branded?.name, 'Hoarding Clearance QLD')
  assert.equal(branded?.email, 'admin@hoardingclearanceqld.com.au')
  assert.equal(branded?.logo_url, null)
  assert.equal(tradingAuthReplyEmail('hoarding_cleaning_qld', company.email), 'admin@hoardingclearanceqld.com.au')
})

test('portal terms exist for every trading name', () => {
  for (const id of TRADING_NAME_IDS) assert.ok(PORTAL_TERMS[id], id)
  assert.match(PORTAL_TERMS.hoarding_cleaning_qld.title, /^Hoarding Clearance QLD/)
})
