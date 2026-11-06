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
import { cdrVolumeM3, statementFlags, statementInputsDraft, statementPatchProblem, surveyAndDisposalSummary } from './statementDraft'
import { composeStatementForJob } from './statementGenerate'
import {
  describeNewJob,
  findDuplicates,
  newJobLines,
  newJobRow,
  normalizeNewJob,
  similarName,
  streetKey,
  type DuplicateCandidate,
} from './newJobDraft'
import { emptyStatementCapture } from '@/lib/statementOfAccounts'
import { formatToTwilioE164 } from '@/lib/phone'
import type { AssessmentData, Job } from '@/lib/types'

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

test('draft_statement_inputs: a model 1 capture becomes model 2 with its inputs carried', () => {
  const ad = {
    house_survey: { price_per_m2: 10, areas: [surveyRoom('Kitchen', 4, 3, 2.4)] },
    statement_of_accounts: { invoice1_amount: 1500, deposit_taken: true, deposit_amount: 500, original_invoice_number: 'INV-7' },
  } as unknown as AssessmentData
  const d = statementInputsDraft(ad, { deposit_date: '2026-11-02' })!
  assert.deepEqual(d.proposed, { deposit_date: '2026-11-02', model_version: 2, invoice_number: 'INV-7' })
  const applied = applyPatch((ad as unknown as Record<string, unknown>).statement_of_accounts, d.proposed as Record<string, unknown>)
  assert.equal(applied.invoice1_amount, 1500)
  assert.equal(statementInputsDraft({ ...ad, statement_of_accounts: applied } as unknown as AssessmentData, { deposit_date: '2026-11-02' }), null)
  const cleared = statementInputsDraft({ ...ad, statement_of_accounts: applied } as unknown as AssessmentData, { deposit_amount: null })!
  assert.deepEqual(cleared.proposed, { deposit_amount: null, deposit_taken: false })
})

// ── Head agent: new job drafts ────────────────────────────────────────────────

const existing: DuplicateCandidate[] = [
  { id: 'a', job_code: '3452', client_name: 'John Smith', client_phone: '+61412345678', client_phones: [], client_email: '', site_address: '12 Smith Street, Annerley QLD 4103', status: 'lead' },
  { id: 'b', job_code: '3456', client_name: 'Mary Jones', client_phone: '', client_phones: [{ label: 'Work', number: '0498 765 432' }], client_email: 'Mary@Example.com', site_address: 'Unit 3/40 Long Rd, Sunnybank', status: 'quoted' },
  { id: 'c', job_code: '2455', client_name: 'Alan Brown', client_phone: '+61400000001', client_phones: [], client_email: '', site_address: '7 Park Ave, Toowong', status: 'scheduled' },
]

/** libphonenumber-js loads without its metadata under tsx (see calls.test.ts). */
const phoneSkip = formatToTwilioE164('0412 345 678') ? false : 'phone metadata does not load under tsx'

test('new job: input is cleaned and checked', () => {
  const p = normalizeNewJob({ client_name: '  Jane Doe ', client_email: 'JANE@x.com', urgency: 'URGENT' })
  assert.equal(p.client_name, 'Jane Doe')
  assert.equal(p.client_email, 'jane@x.com')
  assert.equal(p.urgency, 'urgent')
  assert.equal(normalizeNewJob({}).urgency, 'standard')
  assert.throws(() => normalizeNewJob({ client_phone: '123' }), /not a valid phone/)
  assert.throws(() => normalizeNewJob({ client_email: 'nope' }), /not a valid email/)
  assert.throws(() => normalizeNewJob({ urgency: 'asap' }))
})

test('new job: duplicates by email, similar name and street; strongest first', () => {
  const byEmail = findDuplicates(normalizeNewJob({ client_email: 'mary@example.com' }), existing)
  assert.deepEqual(byEmail.map(d => [d.job_code, d.reasons]), [['3456', ['same email']]])
  const byName = findDuplicates(normalizeNewJob({ client_name: 'Smith, John' }), existing)
  assert.deepEqual(byName.map(d => d.job_code), ['3452'])
  const byStreet = findDuplicates(normalizeNewJob({ site_address: '12 Smith St Annerley' }), existing)
  assert.deepEqual(byStreet.map(d => [d.job_code, d.reasons]), [['3452', ['same site address']]])
  const strongestFirst = findDuplicates(normalizeNewJob({ client_name: 'Alan Brown', site_address: '12 Smith Street' }), existing)
  assert.deepEqual(strongestFirst.map(d => d.job_code), ['3452', '2455'])
  assert.deepEqual(findDuplicates(normalizeNewJob({ client_name: 'John', site_address: '12 Other St, Annerley' }), existing), [])
  assert.equal(streetKey('Unit 3/40 Long Road, Sunnybank QLD'), '3/40 long rd')
  assert.equal(similarName('Mrs Mary Anne Jones', 'Mary Jones'), true)
  assert.equal(similarName('Mary', 'Mary Jones'), false)
})

test('new job: duplicates by E.164 phone, including other phones', { skip: phoneSkip }, () => {
  const p = normalizeNewJob({ client_phone: '0412 345 678' })
  assert.equal(p.client_phone, '+61412345678')
  assert.deepEqual(findDuplicates(p, existing).map(d => [d.job_code, d.reasons]), [['3452', ['same phone']]])
  assert.deepEqual(findDuplicates(normalizeNewJob({ client_phone: '+61 498 765 432' }), existing).map(d => d.job_code), ['3456'])
})

test('new job: approve payload matches a call-created lead', () => {
  const p = normalizeNewJob({ client_name: 'Jane Doe', client_email: 'jane@x.com', site_address: '1 Test St', job_description: 'Unattended death clean-up' })
  assert.deepEqual(newJobRow(p, '4821', 'org-1'), {
    job_code: '4821', client_name: 'Jane Doe', client_phone: '', client_email: 'jane@x.com', site_address: '1 Test St',
    job_description: 'Unattended death clean-up', job_type: 'other', urgency: 'standard', status: 'lead', notes: '',
    assessment_data: null, org_id: 'org-1',
  })
  assert.equal(describeNewJob(p), 'Create a new job: Jane Doe · 1 Test St')
  assert.deepEqual(newJobLines(p).map(l => l.label), ['Client', 'Email', 'Site', 'Description'])
  assert.equal(describeNewJob(normalizeNewJob({})), 'Create a new job (empty)')
})

// ── Statement: CDR facts, dollar patches, generate ────────────────────────────

const cdr = {
  loads: [
    { vehicles: [{ type: 'trailer', length_m: 2, width_m: 1.5, height_m: 1 }], weight_kg: 420, dump_fee: 180 },
    { vehicles: [{ type: 'skip', length_m: 3, width_m: 2, height_m: 1, skip_cost: 400 }] },
  ],
  cost_per_m3: 100,
  prepaid_m3: 2,
}

test('file agent survey and disposal: summaries only, no waste charges', () => {
  const ad = { disposal_manifest_capture: cdr, statement_of_accounts: {} } as unknown as AssessmentData
  assert.equal(cdrVolumeM3(ad), 9)
  const view = surveyAndDisposalSummary(ad)
  assert.equal(view.cdr_summary.total_ex_gst, 900)
  assert.deepEqual(view.statement.lines_ex_gst, [{ label: 'Contents removal', amount_ex: 900 }])
  for (const marker of ['skip_cost', 'dump_fee', 'prepaid', 'invoice2']) assert.ok(!JSON.stringify(view).includes(marker), marker)
})

test('statement patches: the staff inputs only, checked for shape', () => {
  assert.equal(isCaptureKey('statement_of_accounts'), true)
  const patch = {
    deposit_amount: 500, deposit_date: '2026-11-02', deposit_taken: true, model_version: 2,
    manual_adjustment: -50, manual_adjustment_reason: 'Goodwill', invoice_number: 'INV-0101', invoice_url: 'https://pay.example/1',
  }
  assert.equal(statementPatchProblem(patch), null)
  assert.match(statementPatchProblem({ deposit_amount: '$1,650' }) ?? '', /plain number/)
  assert.match(statementPatchProblem({ deposit_amount: -5 }) ?? '', /negative/)
  assert.match(statementPatchProblem({ deposit_taken: 'yes' }) ?? '', /true or false/)
  assert.match(statementPatchProblem({ deposit_date: '2 Nov' }) ?? '', /YYYY-MM-DD/)
  assert.match(statementPatchProblem({ invoice1_amount: 1650 }) ?? '', /no input "invoice1_amount"/)
  assert.match(statementPatchProblem({ model_version: 1 }) ?? '', /model_version must be 2/)
  const d = buildPatchDraft(null, patch)
  const applied = applyPatch(null, d.proposed, emptyStatementCapture as unknown as () => Record<string, unknown>)
  assert.equal(applied.deposit_amount, 500)
  assert.equal(applied.charges_gst, true)
})

test('statement flags: missing records, deposit date, reason, and a deposit far from half', () => {
  const sacq = { estimated_m2: 100, rate_per_m2: 10 }
  const flags = (statement: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    statementFlags({ surface_area_cleaning_quote: sacq, statement_of_accounts: { model_version: 2, ...statement }, ...extra } as unknown as AssessmentData)
  assert.match(flags({})[0], /needs a House Survey/)
  const survey = { house_survey: { areas: [], labour_days: 1, rate_per_labour_day: 1000 } }
  assert.deepEqual(flags({ deposit_amount: 550, deposit_date: '2026-11-02' }, survey), [])
  assert.match(flags({ deposit_amount: 200, deposit_date: '2026-11-02' }, survey)[0], /not about half the quotes \(\$550\.00\)/)
  assert.deepEqual(flags({ deposit_amount: 550 }, survey), ['Enter the date the deposit was paid.'])
  assert.deepEqual(flags({ manual_adjustment: 10 }, survey), ['Enter the reason for the adjustment.'])
})

function statementJob(statement: Record<string, unknown> | null): Job {
  return {
    id: '11111111-2222-3333-4444-555555555555', site_address: '1 Test St',
    assessment_data: statement ? { statement_of_accounts: statement } : null,
  } as unknown as Job
}

test('generate statement: same checks as the Generate button', () => {
  assert.match((composeStatementForJob(statementJob(null), []) as { reason: string }).reason, /not been started/)
  const nothing = composeStatementForJob(statementJob({}), [])
  assert.equal(nothing.ok, false)
  assert.match((nothing as { reason: string }).reason, /nothing to bill/)
  const job = (statement: Record<string, unknown>) => ({
    ...statementJob(statement),
    assessment_data: { house_survey: { areas: [], labour_days: 1, rate_per_labour_day: 1000 }, statement_of_accounts: { model_version: 2, ...statement } },
  } as unknown as Job)
  const unreasoned = composeStatementForJob(job({ manual_adjustment: -50 }), [])
  assert.equal(unreasoned.ok, false)
  assert.match((unreasoned as { reason: string }).reason, /reason for the adjustment/)
  const good = composeStatementForJob(job({ deposit_amount: 500, deposit_date: '2026-11-02' }), [])
  assert.equal(good.ok, true)
  const content = (good as { content: Record<string, unknown> }).content
  assert.equal(content.title, 'Statement of Accounts')
  assert.equal(content.model_version, 2)
  assert.equal(content.balance, 600)
})
