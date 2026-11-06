import '../testEnv'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chatTarget,
  directConversationDigest,
  docAgentHistory,
  docAgentRows,
  fileAgentRows,
  parseJobMention,
  rebuildHistory,
  type ChatRow,
} from '../workspaceText'
import { FILE_TOOLS } from '../workspaceAgent'
import { ToolError } from '../loop'
import { DOC_AGENTS, docAgentId, generateTarget } from './registry'
import { DOC_AGENT_TYPES } from './types'
import { directTools, referralFromToolError, type SubCtx } from './runner'
import { docAgentOverview, type OverviewInput } from './overview'

test('@job/agent mentions resolve every alias', () => {
  const cases: [string, string][] = [
    ['statement', 'statement_of_accounts'], ['soa', 'statement_of_accounts'],
    ['bcq', 'biohazard_cleaning_quote'], ['ccq', 'contents_clearance_quote'], ['sacq', 'surface_area_cleaning_quote'],
    ['survey', 'house_survey'], ['cdr', 'waste_disposal_manifest'], ['completion', 'completion_report'],
    ['SOA', 'statement_of_accounts'], ['house-survey', 'house_survey'],
  ]
  for (const [alias, type] of cases) {
    assert.deepEqual(parseJobMention(`@6743/${alias} what is owing?`), { code: '6743', agent: type, rest: 'what is owing?' }, alias)
  }
  assert.deepEqual(parseJobMention('@6743/statement'), { code: '6743', agent: 'statement_of_accounts', rest: '' })
  assert.deepEqual(parseJobMention('@6743/file: back'), { code: '6743', agent: 'file', rest: 'back' })
  assert.deepEqual(parseJobMention('@6743/nope hi'), { code: '6743', unknownAgent: 'nope', rest: 'hi' })
  assert.deepEqual(parseJobMention('@6743 hi'), { code: '6743', rest: 'hi' })
  assert.equal(parseJobMention('email bob@example.com/statement'), null)
})

test('routing: an active document agent needs an open job; otherwise the file or head agent', () => {
  assert.deepEqual(chatTarget('job-1', 'statement_of_accounts'), { kind: 'doc', jobId: 'job-1', docAgent: 'statement_of_accounts' })
  assert.deepEqual(chatTarget('job-1', null), { kind: 'file', jobId: 'job-1' })
  assert.deepEqual(chatTarget('job-1', 'not_an_agent'), { kind: 'file', jobId: 'job-1' })
  assert.deepEqual(chatTarget(null, 'statement_of_accounts'), { kind: 'head' })
})

test('routing: a direct document agent gets only its own tools, never the file agent writes', () => {
  const fileOnly = FILE_TOOLS.map(t => t.name).filter(n => !n.startsWith('read_'))
  for (const type of DOC_AGENT_TYPES) {
    const names = directTools(DOC_AGENTS[type]).map(t => t.name)
    for (const n of ['read_capture', 'read_document', 'draft_patch', 'validate_patch', 'draft_document_patch', 'draft_generate', 'refer_to_other_agent']) {
      assert.ok(names.includes(n), `${type} has ${n}`)
    }
    assert.ok(!names.includes('report'), `${type} has no report step`)
    for (const n of fileOnly) assert.ok(!names.includes(n), `${type} must not have ${n}`)
  }
})

test('a request outside the document returns the permission error and offers the right agent', async () => {
  const def = DOC_AGENTS.statement_of_accounts
  const refer = directTools(def).find(t => t.name === 'refer_to_other_agent')
  assert.ok(refer)
  const ctx = { def, drafts: [], reported: null, referral: null } as unknown as SubCtx
  await assert.rejects(refer.run(ctx, { agent: 'contents_clearance_quote', requested: 'change the CCQ rate' }), (err: unknown) => {
    assert.ok(err instanceof ToolError)
    const body = JSON.parse(err.message)
    assert.equal(body.blocked_action, 'change the CCQ rate')
    assert.equal(body.handled_by, 'CCQ agent')
    assert.equal(body.required_permission, 'write:contents_clearance_quote')
    return true
  })
  assert.deepEqual(ctx.referral, { doc_agent: 'contents_clearance_quote', label: 'CCQ agent' })
  await assert.rejects(refer.run(ctx, { agent: 'file_agent', requested: 'change the client phone' }))
  assert.deepEqual(ctx.referral, { doc_agent: null, label: 'File agent' })

  assert.deepEqual(referralFromToolError(JSON.stringify({ blocked_action: 'draft_patch:house_survey', handled_by: 'Survey agent' })), { doc_agent: 'house_survey', label: 'Survey agent' })
  assert.deepEqual(referralFromToolError(JSON.stringify({ blocked_action: 'read_capture:sow_capture', handled_by: 'file agent' })), { doc_agent: null, label: 'File agent' })
  assert.equal(referralFromToolError('Document not found on this job'), null)
})

function row(p: Partial<ChatRow> & Pick<ChatRow, 'speaker'>, i: number): ChatRow {
  return { id: `r${i}`, thread_id: 'u1', job_id: 'job-1', author: '', content: { text: `line ${i}` }, created_at: `2026-11-06T00:00:0${i}Z`, doc_agent: null, ...p }
}

const rows: ChatRow[] = [
  row({ speaker: 'user' }, 1),
  row({ speaker: 'file_agent', author: 'File agent > Statement agent', doc_agent: 'statement_of_accounts', content: { text: 'Drafted invoice 1.', instruction: 'Fill invoice 1 as $1,000' } }, 2),
  row({ speaker: 'user', doc_agent: 'statement_of_accounts', content: { text: 'What is owing?' } }, 3),
  row({ speaker: 'doc_agent', author: 'Statement agent', doc_agent: 'statement_of_accounts', content: { text: 'Invoice 1 less the deposit.' } }, 4),
  row({ speaker: 'system', author: 'Ben', doc_agent: 'statement_of_accounts', content: { text: 'Approved: Statement' } }, 5),
  row({ speaker: 'user', doc_agent: 'house_survey', content: { text: 'Kitchen is 12 m2' } }, 6),
  row({ speaker: 'file_agent' }, 7),
]

test('history: the file agent replays everything but direct document-agent chats', () => {
  assert.deepEqual(fileAgentRows(rows).map(r => r.id), ['r1', 'r2', 'r5', 'r7'])
})

test('history: a document agent sees its direct lines, delegated runs and its log lines only', () => {
  const mine = docAgentRows(rows, 'statement_of_accounts')
  assert.deepEqual(mine.map(r => r.id), ['r2', 'r3', 'r4', 'r5'])
  const history = docAgentHistory(mine)
  assert.equal(history[0].speaker, 'system')
  assert.match(history[0].content.text ?? '', /The file agent asked: Fill invoice 1 as \$1,000\. You reported: Drafted invoice 1\./)
  const messages = rebuildHistory(history)
  assert.equal(messages[0].role, 'user')
  assert.match(String(messages[0].content), /Delegated by the file agent/)
  assert.match(String(messages[0].content), /What is owing\?/)
  assert.equal(messages[1].role, 'assistant')
  assert.equal(messages[1].content, 'Invoice 1 less the deposit.')
  assert.equal(messages[messages.length - 1].role, 'user')
})

test('history: the file agent gets a short digest of direct document-agent chats', () => {
  const digest = directConversationDigest(rows, { statement_of_accounts: 'Statement agent', house_survey: 'Survey agent' })
  assert.deepEqual(digest.split('\n'), [
    '[Statement agent] Staff: What is owing?',
    '[Statement agent] Agent: Invoice 1 less the deposit.',
    '[Survey agent] Staff: Kitchen is 12 m2',
  ])
  assert.equal(directConversationDigest(rows, {}, 1), '[Document agent] Staff: Kitchen is 12 m2')
  assert.equal(directConversationDigest([rows[0]], {}), '')
})

test('overview: state, cards, unread and health per document agent', () => {
  const input: OverviewInput = {
    status: 'completed',
    assessment: { statement_of_accounts: { invoice1_amount: 100 }, house_survey: { areas: [] } },
    documents: [{ id: 'd1', type: 'house_survey' }, { id: 'd2', type: 'house_survey' }],
    health: [{ code: 'statement_quantities_stale', severity: 'warning', message: 'Statement quantities differ', doc_agent: 'statement_of_accounts' }],
    conflicts: [{ code: 'duplicate_document:house_survey', message: 'Two surveys', document_ids: ['d1', 'd2'] }],
    pendingDrafts: [
      { created_by: docAgentId('statement_of_accounts'), target_path: 'capture:statement_of_accounts' },
      { created_by: 'u1', target_path: generateTarget('statement_of_accounts') },
      { created_by: 'file_agent', target_path: 'doc:d1' },
      { created_by: 'file_agent', target_path: 'client_phone' },
    ],
    messages: [
      { doc_agent: 'statement_of_accounts', speaker: 'doc_agent', thread_id: 'u2', created_at: '2026-11-06T02:00:00Z' },
      { doc_agent: 'statement_of_accounts', speaker: 'doc_agent', thread_id: 'u2', created_at: '2026-11-06T00:30:00Z' },
      { doc_agent: 'statement_of_accounts', speaker: 'doc_agent', thread_id: 'u1', created_at: '2026-11-06T03:00:00Z' },
      { doc_agent: null, speaker: 'file_agent', thread_id: null, created_at: '2026-11-06T02:00:00Z' },
    ],
    userId: 'u1',
    jobReadAt: '2026-11-06T01:00:00Z',
    docReads: { statement_of_accounts: '2026-11-06T01:00:00Z' },
  }
  const o = docAgentOverview(input)
  const by = Object.fromEntries(o.agents.map(a => [a.type, a]))
  assert.equal(o.agents.length, 7)
  assert.equal(by.statement_of_accounts.state, 'in_progress')
  assert.equal(by.statement_of_accounts.pending_drafts, 2)
  assert.equal(by.statement_of_accounts.unread, 1)
  assert.equal(by.statement_of_accounts.health, 'warning')
  assert.equal(by.house_survey.state, 'generated')
  assert.equal(by.house_survey.pending_drafts, 1)
  assert.deepEqual(by.house_survey.health_messages, ['Two surveys'])
  assert.equal(by.contents_clearance_quote.state, 'missing')
  assert.equal(by.contents_clearance_quote.applicable, false)
  assert.equal(by.completion_report.applicable, true)
  assert.deepEqual(o.file_agent, { pending_drafts: 1, unread: 1 })
  const firstGrey = o.agents.findIndex(a => !a.applicable)
  assert.ok(firstGrey > 0 && o.agents.slice(firstGrey).every(a => !a.applicable))
})
