import assert from 'node:assert/strict'
import test from 'node:test'
import { documentPlainText, searchDocument } from '@/lib/documentAsk'

const quote = {
  title: 'Biohazard Cleaning Quote',
  scope_of_work: [
    'Remove affected cement sheet fibre from the bathroom walls and bag it as asbestos-suspect waste.',
    'Disinfect remaining non-porous surfaces with a TGA-registered hospital-grade disinfectant.',
  ],
  inclusions: ['Labour and consumables'],
  total: 1500,
  gst: 150,
  rooms: [{ name: 'Bathroom', detail: '3 × 2 × 2.4 m', area_m2: 36 }],
  exclusions: '<p>Carpet and <strong>underlay</strong> stay in place.</p>',
}

test('search finds cement sheet fibre inside a question about the document', () => {
  const text = documentPlainText(quote)
  const hits = searchDocument(text, 'what does this document say about cement sheet fibre')
  assert.ok(hits.length >= 1)
  assert.match(hits[0].text, /cement sheet fibre/)
  assert.equal(hits[0].heading, 'Scope of work')
})

test('search says nothing when the document does not mention the topic', () => {
  const hits = searchDocument(documentPlainText(quote), 'what does this document say about vinyl plank')
  assert.equal(hits.length, 0)
})

test('plain text keeps wording, money, rooms, and drops HTML', () => {
  const text = documentPlainText(quote)
  assert.match(text, /## Scope of work/)
  assert.match(text, /## Total\n\$1,500\.00/)
  assert.match(text, /## GST\n\$150\.00/)
  assert.match(text, /Bathroom — 3 × 2 × 2.4 m — 36 m²/)
  assert.match(text, /Carpet and underlay stay in place/)
  assert.doesNotMatch(text, /<p>|<strong>/)
})
