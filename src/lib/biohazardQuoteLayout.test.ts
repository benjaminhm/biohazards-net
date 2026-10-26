import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adaptBiohazardEngagement,
  formatBcqClientLine,
  groupBiohazardScope,
  parseNamedList,
  renumberEngagementClauses,
  tidyBiohazardAddress,
  tidyBiohazardPrintText,
  withoutDuplicateEncapsulant,
} from '@/lib/biohazardQuoteLayout'

test('client line is name, role, and organisation, once', () => {
  assert.equal(
    formatBcqClientLine({
      clientName: 'Jemma Archibald (Property Manager)',
      contactRole: '',
      organization: 'Ray White Waterford',
    }),
    'Jemma Archibald, Property Manager, Ray White Waterford',
  )
})

test('addresses lose a trailing comma', () => {
  assert.equal(tidyBiohazardAddress('7/2 Bishop Street, Eagleby QLD 4207,'), '7/2 Bishop Street, Eagleby QLD 4207')
})

test('print tidy fixes the usual typos and finishes the truncated objective', () => {
  assert.equal(
    tidyBiohazardPrintText('To remove fuild contamination from non-strucutral elements to enable structural '),
    'To remove fluid contamination from non-structural elements to enable structural repairs.',
  )
  assert.match(tidyBiohazardPrintText('assumes to have be contaminated. hydroxyl/ozon2. walk-in warddrobe. dead flys.'), /assumed to have been/)
  assert.match(tidyBiohazardPrintText('hydroxyl/ozon2'), /hydroxyl\/ozone/)
})

test('named lists have no trailing punctuation', () => {
  assert.deepEqual(
    parseNamedList('Living room, staircase, hallway, walk-in warddrobe.'),
    ['Living room', 'staircase', 'hallway', 'walk-in wardrobe'],
  )
})

test('a second encapsulant step in the primary zone is dropped', () => {
  const kept = withoutDuplicateEncapsulant([
    'Seal grout with an encapsulant after cleaning.',
    'Deodorise the primary zone. Seal remaining surfaces with an encapsulant.',
  ])
  assert.deepEqual(kept, ['Deodorise the primary zone. Seal remaining surfaces with an encapsulant.'])
})

test('scope steps group under the six phase headings', () => {
  const groups = groupBiohazardScope([
    'Isolate the primary zone with containment and PPE.',
    'Remove, clean, and disinfect the primary zone.',
    'Treat the secondary zone for flies and odour.',
    'Transport and dispose of clinical waste.',
    'Hold point, clearance: ATP testing.',
    'Provide a completion report: photos and waste disposal certificates.',
  ])
  assert.deepEqual(groups.map(group => group.title), [
    '1. Site setup and PPE',
    '2. Primary zone — decontamination',
    '3. Secondary zone — odour and insects',
    '4. Waste transport and disposal',
    '5. Clearance testing',
    '6. Completion records',
  ])
})

test('engagement clauses renumber after an empty 3.1 is dropped', () => {
  const text = renumberEngagementClauses('3.2 Travel is estimated at 10 km.\n3.3 Surface cleaning is estimated at 20 m².')
  assert.match(text, /3\.1 Travel/)
  assert.match(text, /3\.2 Surface/)
})

test('a property manager sees agent signing ticks, not probate wording', () => {
  const text = adaptBiohazardEngagement(
    '1.1 Works.\n1.2 Executor or administrator. Estate only.\n1.3 Signing personally. Estate only.\n1.4 Access.\n2.1 Works.\n2.2 Before the works start, list retained items.\n3.1 Contents are gone.\n3.2 Travel is estimated at 10 km.\nSigning capacity (tick one):\n☐ Executor, probate not yet granted\n\nSignatory: ________________\n',
    'agent',
    { has_secondary: false, secondary_m2: 0, secondary_rate_per_m2: 0, secondary_amount: 0 },
  )
  assert.match(text, /☐ Agent for owner \(authority held\)/)
  assert.match(text, /☐ Owner/)
  assert.doesNotMatch(text, /Executor or administrator|probate|retained items/)
  assert.match(text, /1\.2 Access/)
})
