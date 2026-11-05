import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isApproveAllPhrase,
  isDraftableField,
  isOverwrite,
  normalizeFieldValue,
  parseJobMention,
  rebuildHistory,
  voiceApprovable,
  type ChatRow,
} from './workspaceText'
import {
  applyPatch,
  buildPatchDraft,
  describePatch,
  flattenPatch,
  isCaptureKey,
  mergePatchDrafts,
  parseTarget,
  patchIsCurrent,
  patchLines,
  photoPatch,
} from './patchDraft'
import { buildStatementDraft } from './statementDraft'
import type { AssessmentData } from '@/lib/types'

let n = 0
function row(speaker: ChatRow['speaker'], text: string, author = ''): ChatRow {
  n++
  return { id: String(n), thread_id: 'u1', job_id: null, speaker, author, content: { text }, created_at: new Date(n * 1000).toISOString() }
}

test('rebuildHistory alternates roles, merges runs and folds system lines into user turns', () => {
  const h = rebuildHistory([
    row('head_agent', 'hello'),
    row('user', 'what needs me'),
    row('head_agent', '#3452 · Annerley'),
    row('system', 'Ben changed site address: a → b', 'Ben'),
    row('user', 'open 3452'),
  ])
  assert.deepEqual(h.map(m => m.role), ['user', 'assistant', 'user'])
  assert.equal(h[0].content, 'what needs me')
  assert.match(String(h[2].content), /^\[Log · Ben\] Ben changed site address/)
  assert.match(String(h[2].content), /open 3452$/)
})

test('rebuildHistory drops a trailing assistant turn and empty lines', () => {
  const h = rebuildHistory([row('user', 'hi'), row('file_agent', ''), row('file_agent', 'done')])
  assert.deepEqual(h, [{ role: 'user', content: 'hi' }])
})

test('parseJobMention', () => {
  assert.deepEqual(parseJobMention('@3456 approve the address'), { code: '3456', rest: 'approve the address' })
  assert.deepEqual(parseJobMention('  @6358'), { code: '6358', rest: '' })
  assert.deepEqual(parseJobMention('@3456: hi'), { code: '3456', rest: 'hi' })
  assert.equal(parseJobMention('email bob@example.com'), null)
})

test('isOverwrite only when something is already on file', () => {
  assert.equal(isOverwrite(null), false)
  assert.equal(isOverwrite('  '), false)
  assert.equal(isOverwrite('4/12 King St'), true)
})

test('voice approve all only for empty-field fills', () => {
  assert.equal(voiceApprovable([{ kind: 'field', before: '' }, { kind: 'field', before: null }]), true)
  assert.equal(voiceApprovable([{ kind: 'field', before: 'x' }]), false)
  assert.equal(voiceApprovable([{ kind: 'document', before: null }]), false)
  assert.equal(voiceApprovable([]), false)
  assert.equal(isApproveAllPhrase('Approve all.'), true)
  assert.equal(isApproveAllPhrase('accept them all'), true)
  assert.equal(isApproveAllPhrase('approve all the photos on 3452'), false)
})

test('allowlists: job fields, capture keys, photo fields', () => {
  for (const f of ['client_name', 'job_type', 'client_phones', 'site_lat', 'schedule_note', 'insurance_claim_ref']) assert.equal(isDraftableField(f), true, f)
  for (const f of ['id', 'org_id', 'job_code', 'inbound_email_token', 'created_at', 'updated_at', 'archived_at', 'client_account_id', 'trading_name', 'assessment_data', 'status']) {
    assert.equal(isDraftableField(f), false, f)
  }
  assert.equal(isCaptureKey('statement_of_accounts'), true)
  assert.equal(isCaptureKey('house_survey'), true)
  assert.equal(isCaptureKey('org_id'), false)
  assert.throws(() => photoPatch({ file_url: 'x' }))
  assert.throws(() => photoPatch({ category: 'random' }))
  assert.deepEqual(photoPatch({ area_ref: 'Kitchen', include_in_composed_reports: false }), { area_ref: 'Kitchen', include_in_composed_reports: false })
})

test('normalizeFieldValue checks types', () => {
  assert.equal(normalizeFieldValue('job_type', 'hoarding'), 'hoarding')
  assert.throws(() => normalizeFieldValue('job_type', 'garden'))
  assert.throws(() => normalizeFieldValue('urgency', 'asap'))
  assert.equal(normalizeFieldValue('site_lat', '-27.5'), -27.5)
  assert.deepEqual(normalizeFieldValue('client_phones', [{ number: '0412 345 678' }]), [{ label: 'Other', number: '0412 345 678' }])
  assert.equal(normalizeFieldValue('scheduled_at', ''), null)
})

test('flattenPatch rejects ids, prototype keys and dotted keys; arrays are leaves', () => {
  assert.deepEqual(flattenPatch({ a: { b: 1, c: [1, 2] }, d: 'x' }), { 'a.b': 1, 'a.c': [1, 2], d: 'x' })
  assert.throws(() => flattenPatch({ id: 'x' }))
  assert.throws(() => flattenPatch({ inner: { org_id: 'x' } }))
  assert.throws(() => flattenPatch(JSON.parse('{"__proto__": {"x": 1}}')))
  assert.throws(() => flattenPatch({ 'a.b': 1 }))
  assert.throws(() => flattenPatch([1, 2]))
})

test('patch drafts: unchanged paths skipped, merge keeps first before, stale when changed, apply keeps the rest', () => {
  const current = { invoice1_amount: 1500, deposit_taken: false, nested: { note: 'old' } }
  const d1 = buildPatchDraft(current, { invoice1_amount: 1650, deposit_taken: false })
  assert.deepEqual(d1, { before: { invoice1_amount: 1500 }, proposed: { invoice1_amount: 1650 } })
  const d2 = buildPatchDraft({ ...current, invoice1_amount: 1600 }, { invoice1_amount: 1700, nested: { note: 'new' } })
  const merged = mergePatchDrafts(d1, d2)
  assert.deepEqual(merged.before, { invoice1_amount: 1500, 'nested.note': 'old' })
  assert.deepEqual(merged.proposed, { invoice1_amount: 1700, 'nested.note': 'new' })
  assert.equal(patchIsCurrent(current, merged.before), true)
  assert.equal(patchIsCurrent({ ...current, invoice1_amount: 1550 }, merged.before), false)
  const next = applyPatch(current, merged.proposed)
  assert.deepEqual(next, { invoice1_amount: 1700, deposit_taken: false, nested: { note: 'new' } })
  assert.deepEqual(current.nested, { note: 'old' })
  assert.deepEqual(applyPatch(null, { x: 1 }, () => ({ y: 2 })), { y: 2, x: 1 })
})

test('patch rendering: readable paths, overwrite flag, room lists', () => {
  const lines = patchLines(
    { invoice2_m3: null, 'objective.text': 'old words' },
    { invoice2_m3: 12.5, 'objective.text': 'new words', survey_areas: [{ label: 'Kitchen', sqm: 12, total: 330 }] },
  )
  assert.deepEqual(lines.map(l => [l.path, l.before, l.after, l.overwrite]), [
    ['invoice2 m3', '(empty)', '12.5', false],
    ['objective › text', 'old words', 'new words', true],
    ['survey areas', '(empty)', 'Kitchen 12 m²', false],
  ])
  assert.match(describePatch('Statement of Accounts', { before: { a: 1 }, proposed: { a: 2 } }), /^Statement of Accounts: a: 1 → 2$/)
  assert.deepEqual(parseTarget('capture:house_survey'), { type: 'capture', ref: 'house_survey' })
  assert.equal(parseTarget('biohazard_cleaning_quote'), null)
})

function surveyRoom(title: string, l: number, w: number, h: number) {
  const leg = (len: number, i: number) => ({ id: `${title}${i}`, turn: 'right' as const, length_m: len })
  return { id: title, title, description: '', start_note: '', height_m: h, legs: [l, w, l, w].map(leg), adjustments: [] }
}

test('draft_statement: survey rooms and quantities only, no typed dollar fields', () => {
  const ad = {
    house_survey: { price_per_m2: 10, areas: [surveyRoom('Kitchen', 4, 3, 2.4)] },
    statement_of_accounts: { invoice1_amount: 1500, deposit_taken: true, deposit_amount: 500 },
  } as unknown as AssessmentData
  const r = buildStatementDraft(ad)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(Object.keys(r.proposed), ['survey_areas'])
  const room = r.proposed.survey_areas?.[0]
  assert.equal(room?.label, 'Kitchen')
  assert.ok((room?.sqm ?? 0) > 0)
  assert.deepEqual(r.before, { survey_areas: null })
  const applied = applyPatch((ad as unknown as Record<string, unknown>).statement_of_accounts, r.proposed as Record<string, unknown>)
  assert.equal(applied.invoice1_amount, 1500)
  assert.equal(applied.deposit_amount, 500)
  const again = buildStatementDraft({ ...ad, statement_of_accounts: applied } as unknown as AssessmentData)
  assert.equal(again.ok, false)
  assert.equal(buildStatementDraft({} as AssessmentData).ok, false)
})
