import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isApproveAllPhrase,
  isOverwrite,
  parseJobMention,
  rebuildHistory,
  voiceApprovable,
  type ChatRow,
} from './workspaceText'

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
