import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PACK_LINK_DAYS,
  buildPackLinks,
  insertAtBodyStart,
  orderPackExtras,
  packBarHtml,
  packExpiry,
  packItemIndex,
  packLinkMessage,
  packLinkState,
  packPaths,
  packPdfFilename,
} from './documentPack'

const TOKEN = 'a'.repeat(43)

test('a pack link lasts 28 days', () => {
  assert.equal(PACK_LINK_DAYS, 28)
  const from = new Date('2026-11-14T00:00:00Z')
  assert.equal(packExpiry(from).toISOString(), '2026-12-12T00:00:00.000Z')
})

test('link state: cancelled, locked and expired close the link', () => {
  const now = new Date('2026-11-14T00:00:00Z')
  const open = { status: 'sent', expires_at: '2026-12-01T00:00:00Z' }
  assert.equal(packLinkState(open, now), 'open')
  assert.equal(packLinkState({ ...open, status: 'viewed' }, now), 'open')
  assert.equal(packLinkState({ ...open, status: 'voided' }, now), 'voided')
  assert.equal(packLinkState({ ...open, passcode_locked_at: '2026-11-13T00:00:00Z' }, now), 'locked')
  assert.equal(packLinkState({ ...open, expires_at: '2026-11-13T00:00:00Z' }, now), 'expired')
})

test('links go on the document host under /p/, else the app address', () => {
  assert.deepEqual(buildPackLinks(TOKEN, 'https://app.biohazards.net', 'document.example.com.au'), {
    page: `https://document.example.com.au/p/${TOKEN}`,
    host: 'document.example.com.au',
  })
  assert.deepEqual(buildPackLinks(TOKEN, 'https://app.biohazards.net/', null), {
    page: `https://app.biohazards.net/pack/${TOKEN}`,
    host: 'app.biohazards.net',
  })
  assert.equal(packPaths(TOKEN, true).pdf, `/p/${TOKEN}/pdf`)
  assert.equal(packPaths(TOKEN, false).pdf, `/api/pack/${TOKEN}/pdf`)
  assert.equal(packPaths(TOKEN, true).api, `/api/pack/${TOKEN}`)
})

test('?doc= picks the document, and anything else is the statement', () => {
  assert.equal(packItemIndex(3, null), 0)
  assert.equal(packItemIndex(3, '1'), 0)
  assert.equal(packItemIndex(3, '3'), 2)
  assert.equal(packItemIndex(3, '4'), 0)
  assert.equal(packItemIndex(3, 'x'), 0)
  assert.equal(packItemIndex(3, '0'), 0)
})

test('chosen documents: CDR before report, newest first, others dropped', () => {
  const docs = [
    { id: 'r1', type: 'report', created_at: '2026-11-10' },
    { id: 'c1', type: 'waste_disposal_manifest', created_at: '2026-11-01' },
    { id: 'c2', type: 'waste_disposal_manifest', created_at: '2026-11-05' },
    { id: 'q1', type: 'quote', created_at: '2026-11-11' },
  ]
  assert.deepEqual(orderPackExtras(['r1', 'c1', 'c2', 'q1', 'nope'], docs).map(d => d.id), ['c2', 'c1', 'r1'])
  assert.deepEqual(orderPackExtras(['r1'], docs).map(d => d.id), ['r1'])
  assert.deepEqual(orderPackExtras([], docs), [])
})

test('the bar links to the other documents and downloads the one in view', () => {
  const items = [
    { document_title: 'Statement of Accounts', reference: 'SOA-1' },
    { document_title: 'Contents Disposal Record', reference: 'CDR-1' },
    { document_title: 'Post Remediation Evaluation', reference: null },
  ]
  const onStatement = packBarHtml({ brandLabel: 'Brand <Co>', items, current: 0, pagePath: '/p/T', pdfPath: '/p/T/pdf' })
  assert.match(onStatement, /aria-current="page">Statement of Accounts<small>SOA-1<\/small></)
  assert.match(onStatement, /href="\/p\/T\?doc=2">Contents Disposal Record<small>CDR-1<\/small></)
  assert.match(onStatement, /href="\/p\/T\?doc=3">Post Remediation Evaluation</)
  assert.match(onStatement, /href="\/p\/T\/pdf" target="_blank"/)
  assert.match(onStatement, /Brand &lt;Co&gt;/)
  const onCdr = packBarHtml({ brandLabel: 'B', items, current: 1, pagePath: '/p/T', pdfPath: '/p/T/pdf' })
  assert.match(onCdr, /href="\/p\/T">Statement of Accounts<small>SOA-1<\/small></)
  assert.match(onCdr, /href="\/p\/T\/pdf\?doc=2"/)
  assert.match(onCdr, /@media print/)
  const alone = packBarHtml({ brandLabel: 'B', items: items.slice(0, 1), current: 0, pagePath: '/p/T', pdfPath: '/p/T/pdf' })
  assert.doesNotMatch(alone, /bh-pack-tabs"/)
  assert.match(alone, /Download PDF/)
})

test('the bar goes first inside the body', () => {
  assert.equal(insertAtBodyStart('<html><body class="x"><p>doc</p></body></html>', '<nav/>'), '<html><body class="x"><nav/><p>doc</p></body></html>')
  assert.equal(insertAtBodyStart('<p>doc</p>', '<nav/>'), '<nav/><p>doc</p>')
})

test('PDF names and the message to paste', () => {
  assert.equal(packPdfFilename({ document_title: 'Statement of Accounts', reference: 'SOA-20261114-AB12' }), 'Statement of Accounts SOA-20261114-AB12.pdf')
  assert.equal(packPdfFilename({ document_title: '"/', reference: null }), 'Document.pdf')
  const msg = packLinkMessage({
    clientName: 'Jane Citizen', siteAddress: '1 Main St', staffFirstName: 'Ben', brandLabel: 'Brand',
    link: 'https://x/p/T', passcode: 'AB12', expiresLabel: '12 December 2026',
  })
  assert.match(msg, /^Hi Jane, your Statement of Accounts from Brand for 1 Main St/)
  assert.match(msg, /https:\/\/x\/p\/T/)
  assert.match(msg, /Passcode: AB12/)
  assert.match(msg, /until 12 December 2026/)
})
