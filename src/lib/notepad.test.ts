import assert from 'node:assert/strict'
import test from 'node:test'
import { NOTEPAD_MAX_CHARS, draftToRestore, notepadBodyError, parseNotepadDraft } from '@/lib/notepad'

test('a pad body must be text within the limit; empty is allowed', () => {
  assert.equal(notepadBodyError(''), null)
  assert.equal(notepadBodyError('- milk\n- call back Sam'), null)
  assert.equal(notepadBodyError('x'.repeat(NOTEPAD_MAX_CHARS)), null)
  assert.ok(notepadBodyError('x'.repeat(NOTEPAD_MAX_CHARS + 1)))
  assert.ok(notepadBodyError(undefined))
  assert.ok(notepadBodyError(null))
  assert.ok(notepadBodyError(42))
})

test('a stored draft is read back, and anything malformed is ignored', () => {
  assert.deepEqual(parseNotepadDraft('{"body":"a","base":"2026-11-11T00:00:00+00:00"}'), {
    body: 'a',
    base: '2026-11-11T00:00:00+00:00',
  })
  assert.deepEqual(parseNotepadDraft('{"body":"a","base":null}'), { body: 'a', base: null })
  assert.deepEqual(parseNotepadDraft('{"body":"a"}'), { body: 'a', base: null })
  assert.equal(parseNotepadDraft(null), null)
  assert.equal(parseNotepadDraft(''), null)
  assert.equal(parseNotepadDraft('not json'), null)
  assert.equal(parseNotepadDraft('null'), null)
  assert.equal(parseNotepadDraft('{"body":5}'), null)
})

test('a draft is restored only over the saved version it was typed on', () => {
  const at = '2026-11-11T00:00:00+00:00'
  assert.equal(draftToRestore({ body: 'unsaved', base: at }, at), 'unsaved')
  assert.equal(draftToRestore({ body: 'first ever', base: null }, null), 'first ever')
  assert.equal(draftToRestore({ body: '', base: at }, at), '')
  // Saved from somewhere else since: the saved pad wins.
  assert.equal(draftToRestore({ body: 'stale', base: at }, '2026-11-12T00:00:00+00:00'), null)
  assert.equal(draftToRestore({ body: 'stale', base: null }, at), null)
  assert.equal(draftToRestore(null, at), null)
})
