import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMenuArchive, archivedMenuKeys, menuItemKey, parseMenuKeys, splitArchived } from './menuArchive'

test('archived keys are read from org features, ignoring other flags and false values', () => {
  const keys = archivedMenuKeys({
    case_studies_tab: true,
    'menu_archived:section:legal': true,
    'menu_archived:tab:timeline': true,
    'menu_archived:section:plan': false,
  })
  assert.deepEqual([...keys].sort(), ['section:legal', 'tab:timeline'])
  assert.equal(archivedMenuKeys(null).size, 0)
})

test('split keeps menu order and only hides the matching kind', () => {
  const archived = new Set([menuItemKey('section', 'legal'), menuItemKey('tab', 'plan')])
  const { shown, archived: hidden } = splitArchived(
    [{ id: 'initial_contact' }, { id: 'legal' }, { id: 'plan' }, { id: 'review' }],
    'section',
    archived,
  )
  assert.deepEqual(shown.map(s => s.id), ['initial_contact', 'plan', 'review'])
  assert.deepEqual(hidden.map(s => s.id), ['legal'])
})

test('archive then restore leaves the other features as they were', () => {
  const start = { case_studies_tab: true }
  const archived = applyMenuArchive(start, ['section:legal', 'tab:timeline'], true)
  assert.deepEqual(archivedMenuKeys(archived), new Set(['section:legal', 'tab:timeline']))
  const restored = applyMenuArchive(archived, ['section:legal'], false)
  assert.deepEqual(restored, { case_studies_tab: true, 'menu_archived:tab:timeline': true })
  assert.deepEqual(start, { case_studies_tab: true })
})

test('request keys must be a non-empty list of section or tab ids', () => {
  assert.deepEqual(parseMenuKeys(['section:legal', 'section:legal', 'tab:docs']), ['section:legal', 'tab:docs'])
  assert.equal(parseMenuKeys([]), null)
  assert.equal(parseMenuKeys('section:legal'), null)
  assert.equal(parseMenuKeys(['case_studies_tab']), null)
  assert.equal(parseMenuKeys(['section:Legal; drop']), null)
})
