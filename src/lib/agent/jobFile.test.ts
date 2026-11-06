import './testEnv'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSnapshot,
  changesSince,
  isFinancialKey,
  redactFinancials,
  snapshotHashes,
  SNAPSHOT_LIMITS,
  truncateText,
  type SnapshotRaw,
} from './jobSnapshot'
import { checkPatch } from './patchCheck'
import { buildPatchDraft, TARGET } from './patchDraft'
import { documentConflicts } from './conflicts'
import { jobHealth } from './jobHealth'
import { checkStatus, nextStatus } from './statusRules'
import { blocked, staffOnlyBlock } from './permissions'
import { isFlagSeverity } from './flags'
import { preparePatches } from './subagents/runner'
import { DOC_AGENTS, docAgentId } from './subagents/registry'
import { ToolError } from './loop'

function raw(over: Partial<SnapshotRaw> = {}, ad: Record<string, unknown> = {}): SnapshotRaw {
  return {
    job: { id: 'j1', job_code: '6743', status: 'underway', client_name: 'Smith', updated_at: '2026-11-01T00:00:00Z', assessment_data: ad },
    documents: [], photos: [], notes: [], calls: [], xero: null, drafts: [], flags: [], acceptances: [],
    ...over,
  }
}

test('snapshot: shape, server_time, transcripts truncated with a marker, total bounded', () => {
  const long = 'x'.repeat(SNAPSHOT_LIMITS.transcript + 500)
  const big = { rows: Array.from({ length: 4000 }, (_, i) => ({ i, text: 'lorem ipsum dolor sit amet' })) }
  const snap = buildSnapshot(raw({
    calls: [{ id: 'c1', created_at: '2026-11-01', provider: 'twilio', caller_number: '+61', status: 'filed', transcript_clean: long, extraction: { summary: 'Wants a quote' } }],
    documents: Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, type: 'quote', content: big, created_at: '2026-11-01', released_to_portal_at: null })),
  }, { house_survey: big, statement_of_accounts: big }), { serverTime: '2026-11-06T00:00:00Z' })
  for (const k of ['server_time', 'job', 'captures', 'documents', 'photos', 'progress_notes', 'calls_and_enquiries', 'xero', 'pending_drafts', 'flags', 'conflicts', 'health']) {
    assert.ok(k in snap, k)
  }
  assert.equal(snap.server_time, '2026-11-06T00:00:00Z')
  assert.match(snap.calls_and_enquiries[0].transcript_clean, /\[truncated, 500 more characters\]$/)
  assert.equal(snap.calls_and_enquiries[0].summary, 'Wants a quote')
  assert.equal((snap.captures.house_survey as { truncated?: boolean }).truncated, true)
  assert.ok(JSON.stringify(snap).length <= SNAPSHOT_LIMITS.total)
  assert.equal(truncateText('short', 10), 'short')
})

test('snapshot: team leads get no dollar figures', () => {
  assert.equal(isFinancialKey('invoice1_amount'), true)
  assert.equal(isFinancialKey('price_per_m2'), true)
  assert.equal(isFinancialKey('invoice1_callout'), true)
  assert.equal(isFinancialKey('labour_days'), false)
  assert.equal(isFinancialKey('site_address'), false)
  assert.deepEqual(redactFinancials({ a: 1, total: 5, rows: [{ price: 2, label: 'x' }] }), { a: 1, rows: [{ label: 'x' }] })
  const r = raw({
    documents: [{ id: 'd1', type: 'contents_clearance_quote', content: { total: 1200, reference: 'CCQ-1' }, created_at: '2026-01-01', released_to_portal_at: null }],
    acceptances: [{ document_id: 'd1', quote_total: 1000, accepted_at: '2026-01-02' }],
    xero: { xero_status: 'AUTHORISED', total: 1200 },
  }, { statement_of_accounts: { invoice1_amount: 1650, survey_areas: [] } })
  const lead = buildSnapshot(r, { role: 'team_lead' })
  const text = JSON.stringify(lead)
  assert.ok(!text.includes('1650') && !text.includes('1200') && !text.includes('1000'), text)
  assert.equal(lead.financials, 'omitted for this role')
  const admin = JSON.stringify(buildSnapshot(r, { role: 'admin' }))
  assert.ok(admin.includes('1650') && admin.includes('1200'))
})

test('changes since: exact diff against stored hashes', () => {
  const before = raw({
    documents: [{ id: 'd1', type: 'house_survey', content: { a: 1 }, created_at: '2026-01-01', released_to_portal_at: null }],
    notes: [{ id: 'n1', room: '', body: 'one', created_by_first_name: 'Ben', created_at: '2026-01-01' }],
  }, { house_survey: { areas: [] }, sow_capture: { x: 1 } })
  const hashes = snapshotHashes(before)
  const same = changesSince({ since: '2026-11-01T00:00:00Z', raw: before, previous: hashes })
  assert.equal(same.precision, 'exact')
  assert.equal(same.nothing_changed, true)

  const after = raw({
    job: { ...before.job, client_name: 'Jones', assessment_data: { house_survey: { areas: [{ id: 'a1' }] }, sow_capture: { x: 1 } } },
    documents: [
      { id: 'd1', type: 'house_survey', content: { a: 2 }, created_at: '2026-01-01', released_to_portal_at: null },
      { id: 'd2', type: 'report', content: {}, created_at: '2026-11-02', released_to_portal_at: null },
    ],
    notes: [],
  })
  const d = changesSince({ since: '2026-11-01T00:00:00Z', raw: after, previous: hashes })
  assert.equal(d.nothing_changed, false)
  assert.deepEqual(d.job_fields, { client_name: 'Jones' })
  assert.deepEqual(Object.keys(d.captures.changed), ['house_survey'])
  assert.deepEqual((d.documents.added as { id: string }[]).map(x => x.id), ['d2'])
  assert.deepEqual((d.documents.changed as { id: string }[]).map(x => x.id), ['d1'])
  assert.deepEqual(d.progress_notes.removed, ['n1'])
})

test('changes since: coarse fallback by timestamps and logged capture edits', () => {
  const r = raw({
    job: { id: 'j1', status: 'underway', updated_at: '2026-11-03T00:00:00Z', assessment_data: { house_survey: { a: 1 }, statement_of_accounts: { b: 1 } } },
    notes: [{ id: 'n2', room: '', body: 'new', created_by_first_name: 'Ben', created_at: '2026-11-02T00:00:00Z' }],
  })
  const d = changesSince({ since: '2026-11-01T00:00:00Z', raw: r, previous: null, touchedCaptures: ['statement_of_accounts'] })
  assert.equal(d.precision, 'coarse')
  assert.deepEqual(Object.keys(d.captures.changed), ['statement_of_accounts'])
  assert.equal(d.progress_notes.added.length, 1)
  assert.match((d as { note: string }).note, /others may have changed/)
})

test('batch patches: all-or-nothing, merged into one card per capture', () => {
  const def = DOC_AGENTS.statement_of_accounts
  const ad = { statement_of_accounts: { invoice1_amount: 1000 } }
  const good = preparePatches(def, ad, [
    { key: 'statement_of_accounts', patch: { invoice1_amount: 1650 } },
    { patch: { invoice1_callout: 200 } },
  ])
  assert.equal(good.ok, true)
  assert.equal(good.ok && good.drafts.length, 1)
  assert.deepEqual(good.ok && Object.keys(good.drafts[0].draft.proposed).sort(), ['invoice1_amount', 'invoice1_callout'])

  const bad = preparePatches(def, ad, [
    { patch: { invoice1_amount: 1650 } },
    { patch: { invoice1_amount: 'lots' } },
  ])
  assert.equal(bad.ok, false)
  assert.ok(!bad.ok && bad.reasons.some(r => /Change 2/.test(r)))

  assert.throws(() => preparePatches(def, ad, [{ patch: { invoice1_amount: 1 } }, { key: 'house_survey', patch: { price_per_m2: 5 } }]), (err: unknown) => {
    assert.ok(err instanceof ToolError)
    const b = JSON.parse(err.message)
    assert.equal(b.blocked_action, 'draft_patch:house_survey')
    assert.equal(b.handled_by, 'Survey agent')
    return true
  })
})

test('validate_patch and approval share checkPatch', () => {
  const current = { invoice1_amount: 1000 }
  const draft = buildPatchDraft(current, { invoice1_amount: 1650 })
  const input = { target_path: TARGET.capture('statement_of_accounts'), created_by: docAgentId('statement_of_accounts'), before: draft.before, proposed: draft.proposed, current }
  assert.deepEqual(checkPatch(input), { ok: true, reasons: [], stale: false })
  const viaValidate = preparePatches(DOC_AGENTS.statement_of_accounts, { statement_of_accounts: current }, [{ patch: { invoice1_amount: 1650 } }])
  assert.equal(viaValidate.ok, checkPatch(input).ok)

  const stale = checkPatch({ ...input, current: { invoice1_amount: 999 } })
  assert.equal(stale.ok, false)
  assert.equal(stale.stale, true)
  const foreign = checkPatch({ ...input, target_path: TARGET.capture('house_survey'), created_by: docAgentId('statement_of_accounts'), current: null, before: {} })
  assert.ok(foreign.reasons.some(r => /may only change statement_of_accounts/.test(r)))
  const typed = checkPatch({ ...input, proposed: { invoice1_amount: '1650' } })
  assert.ok(typed.reasons.some(r => /must be a number/.test(r)))
  const unknownField = checkPatch({ ...input, proposed: { made_up: 1 }, before: { made_up: null } })
  assert.equal(unknownField.ok, false)
  assert.equal(checkPatch({ ...input, target_path: TARGET.photo('p1'), current: {}, before: {} }).ok, false)
})

test('conflicts: duplicate references and two of a one-per-job document', () => {
  const c = documentConflicts([
    { id: 'a', type: 'biohazard_cleaning_quote', content: { reference: 'Q-100' } },
    { id: 'b', type: 'contents_clearance_quote', content: { reference: 'q-100' } },
    { id: 'c', type: 'house_survey', content: {} },
    { id: 'd', type: 'house_survey', content: {} },
    { id: 'e', type: 'biohazard_cleaning_quote', content: { reference: 'Q-101' } },
  ])
  assert.deepEqual(c.map(x => x.code).sort(), ['duplicate_document:house_survey', 'duplicate_reference:Q-100'])
  assert.deepEqual(c.find(x => x.code.startsWith('duplicate_reference'))?.document_ids, ['a', 'b'])
  assert.equal(documentConflicts([{ id: 'x', type: 'biohazard_cleaning_quote', content: {} }, { id: 'y', type: 'biohazard_cleaning_quote', content: {} }]).length, 0)
})

test('health: status expectations, next status, incomplete captures, conflicts', () => {
  const issues = jobHealth({
    status: 'completed',
    assessment: { statement_of_accounts: { invoice1_amount: null } } as never,
    documents: [{ id: 'q', type: 'biohazard_cleaning_quote', content: {}, created_at: '' }],
    acceptances: [],
  })
  const byCode = new Map(issues.map(i => [i.code, i]))
  assert.match(byCode.get('status_expects:completed')!.message, /quote acceptance/)
  assert.match(byCode.get('status_expects:completed')!.message, /completion report/)
  assert.match(byCode.get('blocks_next:report_sent')!.message, /Statement of Accounts/)
  assert.match(byCode.get('incomplete:statement_of_accounts')!.message, /invoice1 amount/)
  assert.equal(nextStatus('paid'), null)
})

test('status changes: warn on missing, block paid without a statement or Xero invoice', () => {
  const none = { documentTypes: new Set<string>(), acceptances: 0, xeroInvoice: false }
  assert.deepEqual(checkStatus('lead', none), { missing: [], blocked: null })
  assert.deepEqual(checkStatus('quoted', none).missing, ['a saved quote'])
  assert.ok(checkStatus('paid', none).blocked)
  assert.equal(checkStatus('paid', { ...none, xeroInvoice: true }).blocked, null)
  assert.equal(checkStatus('paid', { ...none, documentTypes: new Set(['statement_of_accounts']) }).blocked, null)
})

test('flags and permission errors', () => {
  assert.equal(isFlagSeverity('urgent'), true)
  assert.equal(isFlagSeverity('critical'), false)
  assert.throws(() => blocked({ blocked_action: 'send_email', required_permission: 'staff_send', handled_by: 'staff', message: 'no' }), (err: unknown) => {
    assert.ok(err instanceof ToolError)
    assert.deepEqual(Object.keys(JSON.parse(err.message)).sort(), ['blocked_action', 'handled_by', 'message', 'required_permission'])
    return true
  })
  assert.match(staffOnlyBlock('send_email').message, /Staff send emails from the job file/)
})
