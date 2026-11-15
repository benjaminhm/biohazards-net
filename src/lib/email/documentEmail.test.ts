import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  documentEmailHeading,
  escapeHtml,
  renderDocumentEmail,
  safeHref,
  type DocumentEmailInput,
} from './documentEmail'

function input(over: Partial<DocumentEmailInput> = {}): DocumentEmailInput {
  return {
    brandLabel: 'Forensic Cleaning QLD',
    title: 'Statement of Accounts',
    reference: 'SOA-20261114-9207',
    message: 'Hi Sam,\n\nPlease find your statement below.\nThanks',
    primary: { label: 'View statement', href: 'https://document.example.com.au/p/abc' },
    contact: { phone: '+61 7 3000 0000', email: 'admin@example.com.au' },
    ...over,
  }
}

test('escapes everything staff or the job can type', () => {
  const { html, text } = renderDocumentEmail(input({
    brandLabel: 'A & B <Cleaning>',
    message: '<script>alert(1)</script> "quoted" it\'s',
    summary: [{ label: '<b>Total</b>', value: '$1 & 2' }],
    documents: [{ name: 'Report <x>', href: 'https://example.com/?a=1&b=2', note: 'PDF "attached"' }],
  }))
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;quoted&quot; it&#39;s/)
  assert.match(html, /A &amp; B &lt;Cleaning&gt;/)
  assert.match(html, /&lt;b&gt;Total&lt;\/b&gt;/)
  assert.match(html, /\$1 &amp; 2/)
  assert.match(html, /Report &lt;x&gt;/)
  assert.match(html, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/)
  assert.match(text, /<script>alert\(1\)<\/script>/, 'the plain-text version is not HTML, so it is not escaped')
  assert.equal(escapeHtml(`<&"'>`), '&lt;&amp;&quot;&#39;&gt;')
})

test('only web addresses become links', () => {
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('data:text/html,hi'), null)
  assert.equal(safeHref('https://in.xero.com/abc"onmouseover=x'), null)
  assert.equal(safeHref(' https://in.xero.com/abc '), 'https://in.xero.com/abc')
  const { html, text } = renderDocumentEmail(input({
    secondary: [{ label: 'Pay bad', href: 'javascript:alert(1)' }, { label: 'Pay invoice INV-1 · $10.00', href: 'https://in.xero.com/inv1' }],
    documents: [{ name: 'Bad doc', href: 'ftp://x' }],
  }))
  assert.equal(html.includes('javascript:'), false)
  assert.equal(html.includes('Pay bad'), false)
  assert.equal(html.includes('Bad doc'), false)
  assert.match(html, /Pay invoice INV-1 · \$10\.00/)
  assert.equal(text.includes('Pay bad'), false)
})

test('heading, brand as text, message paragraphs and no images or scripts', () => {
  const { html } = renderDocumentEmail(input())
  assert.equal(documentEmailHeading(input()), 'Statement of Accounts SOA-20261114-9207')
  assert.equal(documentEmailHeading(input({ reference: null })), 'Statement of Accounts')
  assert.match(html, /<title>Statement of Accounts SOA-20261114-9207<\/title>/)
  assert.match(html, />Forensic Cleaning QLD<\/div>/)
  assert.match(html, /<h1[^>]*>Statement of Accounts <span[^>]*>SOA-20261114-9207<\/span><\/h1>/)
  assert.match(html, /<p[^>]*>Hi Sam,<\/p><p[^>]*>Please find your statement below\.<br>Thanks<\/p>/)
  assert.equal(/<img|<script|<style/i.test(html), false)
  assert.match(html, /max-width: 560px/)
  assert.match(html, /<meta name="viewport"/)
})

test('buttons: primary filled in the brand orange, pay buttons outlined, with the copy-this-link fallback', () => {
  const { html } = renderDocumentEmail(input({
    secondary: [{ label: 'Pay invoice INV-0269 · $3,278.44', href: 'https://in.xero.com/inv1' }],
  }))
  assert.match(html, /bgcolor="#FF6B35" style="background-color: #FF6B35;[^"]*"[^>]*>\s*<a href="https:\/\/document\.example\.com\.au\/p\/abc"[^>]*>View statement<\/a>/)
  assert.match(html, /border: 2px solid #FF6B35;[^"]*">\s*<a href="https:\/\/in\.xero\.com\/inv1"[^>]*>Pay invoice INV-0269 · \$3,278\.44<\/a>/)
  assert.ok(html.indexOf('View statement') < html.indexOf('Pay invoice'))
  assert.match(html, /If the button does not work, copy this link into your browser:<br><a href="https:\/\/document\.example\.com\.au\/p\/abc"/)
})

test('summary card emphasises one row', () => {
  const { html } = renderDocumentEmail(input({
    summary: [
      { label: 'Total job value', value: '$2,970.00' },
      { label: 'Paid to date', value: '$1,000.00' },
      { label: 'Balance due', value: '$1,970.00', strong: true },
    ],
  }))
  assert.match(html, /Total job value<\/td>\s*<td align="right"[^>]*font-size: 15px;[^>]*font-weight: 400;[^>]*>\$2,970\.00/)
  assert.match(html, /Balance due<\/td>\s*<td align="right"[^>]*font-size: 20px;[^>]*font-weight: 700;[^>]*>\$1,970\.00/)
  assert.equal(renderDocumentEmail(input()).html.includes('Total job value'), false)
})

test('documents each have a View link and a note', () => {
  const { html } = renderDocumentEmail(input({
    documentsHeading: 'Your documents (PDFs attached)',
    documents: [
      { name: 'Statement of Accounts SOA-1', href: 'https://d.example.com/p/abc', note: 'PDF attached' },
      { name: 'Contents Disposal Record CDR-1', href: 'https://d.example.com/p/abc?doc=2', note: 'Not attached: use View to open it' },
    ],
  }))
  assert.match(html, /Your documents \(PDFs attached\)/)
  assert.match(html, /Statement of Accounts SOA-1<\/div><div[^>]*>PDF attached<\/div>[\s\S]*?<a href="https:\/\/d\.example\.com\/p\/abc"[^>]*>View<\/a>/)
  assert.match(html, /Contents Disposal Record CDR-1<\/div><div[^>]*>Not attached: use View to open it<\/div>[\s\S]*?<a href="https:\/\/d\.example\.com\/p\/abc\?doc=2"[^>]*>View<\/a>/)
})

test('footer has the brand phone and email, and leaves out what is missing', () => {
  const { html } = renderDocumentEmail(input())
  assert.match(html, /<a href="tel:\+61730000000"[^>]*>\+61 7 3000 0000<\/a>/)
  assert.match(html, /<a href="mailto:admin@example\.com\.au"[^>]*>admin@example\.com\.au<\/a>/)
  const bare = renderDocumentEmail(input({ contact: { phone: '', email: null } }))
  assert.equal(bare.html.includes('tel:'), false)
  assert.equal(bare.html.includes('mailto:'), false)
  assert.equal(bare.text.trim().endsWith('Forensic Cleaning QLD'), true)
})

test('plain-text version carries the same content', () => {
  const { text } = renderDocumentEmail(input({
    summary: [{ label: 'Balance due', value: '$1,970.00', strong: true }],
    secondary: [{ label: 'Pay invoice INV-0269 · $1,970.00', href: 'https://in.xero.com/inv1' }],
    notes: ['Invoice 2: the pay link comes later.'],
    documents: [{ name: 'Report PRE-1', href: 'https://d.example.com/p/abc?doc=2', note: 'PDF attached' }],
    linkNote: 'These links are private to you.',
  }))
  assert.equal(text, [
    'Forensic Cleaning QLD',
    'Statement of Accounts SOA-20261114-9207',
    '',
    'Hi Sam,\n\nPlease find your statement below.\nThanks',
    '',
    'Balance due: $1,970.00',
    '',
    'View statement: https://document.example.com.au/p/abc',
    '',
    'Pay invoice INV-0269 · $1,970.00: https://in.xero.com/inv1',
    '',
    'Invoice 2: the pay link comes later.',
    '',
    'Documents:',
    '- Report PRE-1 (PDF attached): https://d.example.com/p/abc?doc=2',
    '',
    'These links are private to you.',
    '',
    'Forensic Cleaning QLD',
    '+61 7 3000 0000 · admin@example.com.au',
  ].join('\n'))
})
