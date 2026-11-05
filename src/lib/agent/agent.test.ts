import assert from 'node:assert/strict'
import test from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { AGENT_TOOLS, runAgentTool, type AgentContext } from '@/lib/agent/tools'
import { DECLINED, closeSkippedApproval, lastToolUse, trimHistory } from '@/lib/agent/history'

type Msg = Anthropic.MessageParam

const askedToChangeStatus: Msg[] = [
  { role: 'user', content: 'mark it underway' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'update_job_status', input: { job_id: 'j', status: 'underway' } }] },
]

/** Supabase stand-in where every query finds nothing and records what it was asked. */
function emptyDb(calls: string[]) {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return undefined
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null })
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.map(a => JSON.stringify(a)).join(',')})`)
          return chain
        }
      },
    },
  )
  return chain as unknown as AgentContext['supabase']
}

test('a new message while a change awaits approval declines that change', () => {
  const next = closeSkippedApproval([...askedToChangeStatus, { role: 'user', content: 'actually leave it' }])
  const last = next[next.length - 1]
  assert.equal(next.length, 3)
  assert.ok(Array.isArray(last.content))
  assert.deepEqual(last.content[0], { type: 'tool_result', tool_use_id: 'tu_1', content: DECLINED })
  assert.deepEqual(last.content[1], { type: 'text', text: 'actually leave it' })
})

test('a normal conversation is left as is', () => {
  const msgs: Msg[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'find the smith job' }]
  assert.equal(closeSkippedApproval(msgs), msgs)
})

test('the change awaiting approval is the last assistant tool call', () => {
  assert.equal(lastToolUse(askedToChangeStatus)?.id, 'tu_1')
  assert.equal(lastToolUse([{ role: 'user', content: 'hi' }]), null)
})

test('trimmed history starts at a plain user message', () => {
  const msgs: Msg[] = [
    { role: 'user', content: 'one' },
    ...askedToChangeStatus,
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] },
    { role: 'assistant', content: 'done' },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: 'sure' },
  ]
  const trimmed = trimHistory(msgs, 4)
  assert.deepEqual(trimmed[0], { role: 'user', content: 'two' })
})

test('every write tool says what it will do on the approval card', () => {
  const names = AGENT_TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length)
  for (const t of AGENT_TOOLS.filter(t => t.kind === 'write')) assert.equal(typeof t.describe, 'function', t.name)
})

test('no tool can contact a client', () => {
  for (const t of AGENT_TOOLS) assert.doesNotMatch(`${t.name} ${t.description}`, /\b(send|email|sms|text the client)\b/i, t.name)
})

test('tools refuse jobs outside the organisation and change nothing', async () => {
  const calls: string[] = []
  const ctx: AgentContext = { userId: 'u', orgId: 'org_a', staffFirstName: 'Sam', supabase: emptyDb(calls) }
  for (const name of ['add_progress_note', 'update_job_status', 'set_photos_in_reports', 'list_job_photos']) {
    const r = await runAgentTool(ctx, name, { job_id: 'job_in_org_b', body: 'x', status: 'paid', photo_ids: ['p'], include: true })
    assert.equal(r.is_error, true, name)
    assert.match(r.content, /not found/i)
  }
  assert.ok(calls.includes('eq("org_id","org_a")'))
  assert.equal(calls.some(c => c.startsWith('insert') || c.startsWith('update')), false)
})

test('unknown tools come back as errors', async () => {
  const ctx: AgentContext = { userId: 'u', orgId: 'o', staffFirstName: '', supabase: emptyDb([]) }
  assert.deepEqual(await runAgentTool(ctx, 'send_sms', {}), { content: 'Unknown tool: send_sms', is_error: true })
})
