import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decryptToken, encryptToken } from './crypto'
import {
  DEFAULT_XERO_SETTINGS,
  brisbaneDate,
  buildInvoiceLines,
  contactFromJob,
  draftInvoiceBody,
  linesHash,
  quoteAmount,
  staffCheckHold,
  xeroInvoiceUrl,
  xeroSettings,
} from './invoice'
import { xeroErrorMessage, xeroRedirectUriFor } from './client'
import { invoicePaid, xeroDate } from './payments'
import { isAcceptableQuoteType } from '../acceptableQuotes'

const KEY = 'a'.repeat(64)

test('tokens round-trip and tampering is rejected', () => {
  const enc = encryptToken('secret-token', KEY)
  assert.notEqual(enc, encryptToken('secret-token', KEY))
  assert.equal(decryptToken(enc, KEY), 'secret-token')
  const parts = enc.split(':')
  parts[3] = Buffer.from('tampered').toString('base64')
  assert.throws(() => decryptToken(parts.join(':'), KEY))
  assert.throws(() => encryptToken('x', 'short'))
})

test('quote amounts are ex GST', () => {
  assert.deepEqual(quoteAmount({ subtotal: 1000, gst: 100, total: 1100 }), { exGst: 1000, gst: true })
  assert.deepEqual(quoteAmount({ total: 1100, gst: 100 }), { exGst: 1000, gst: true })
  assert.deepEqual(quoteAmount({ subtotal: '500', gst: 0, total: 500 }), { exGst: 500, gst: false })
  assert.equal(quoteAmount({ title: 'x' }), null)
})

test('one line per accepted quote, unpriced ones reported', () => {
  const { lines, unpriced } = buildInvoiceLines([
    { document_id: 'a', type: 'biohazard_cleaning_quote', content: { title: 'Unattended death', reference: 'BCQ-1', subtotal: 2000, gst: 200, total: 2200 } },
    { document_id: 'b', type: 'contents_clearance_quote', content: { title: 'Contents Clearance', reference: 'CCQ-1', subtotal: 800, gst: 0, total: 800 } },
    { document_id: 'c', type: 'surface_area_cleaning_quote', content: { reference: 'SACQ-1' } },
  ], DEFAULT_XERO_SETTINGS)
  assert.equal(lines.length, 2)
  assert.deepEqual(unpriced, ['c'])
  assert.deepEqual(lines[0], {
    Description: 'Biohazard cleaning: Unattended death (quote BCQ-1)',
    Quantity: 1,
    UnitAmount: 2000,
    AccountCode: '200',
    TaxType: 'OUTPUT',
  })
  assert.equal(lines[1].Description, 'Contents clearance (quote CCQ-1)')
  assert.equal(lines[1].TaxType, 'EXEMPTOUTPUT')
})

test('lines hash changes only when lines change', () => {
  const q = [{ document_id: 'a', type: 'quote', content: { subtotal: 100, gst: 10 } }]
  const a = linesHash(buildInvoiceLines(q, DEFAULT_XERO_SETTINGS).lines)
  assert.equal(a, linesHash(buildInvoiceLines(q, DEFAULT_XERO_SETTINGS).lines))
  q[0].content.subtotal = 120
  assert.notEqual(a, linesHash(buildInvoiceLines(q, DEFAULT_XERO_SETTINGS).lines))
})

test('settings fall back to defaults', () => {
  assert.deepEqual(xeroSettings(null), DEFAULT_XERO_SETTINGS)
  assert.deepEqual(xeroSettings({ account_code: '210', due_days: '0' }), { ...DEFAULT_XERO_SETTINGS, account_code: '210', due_days: 0 })
})

test('draft invoice body uses Brisbane dates and job code reference', () => {
  const now = new Date('2026-11-05T15:30:00Z')
  assert.equal(brisbaneDate(now), '2026-11-06')
  const body = draftInvoiceBody({ contactId: 'c1', reference: 'BBC-0042', lines: [], settings: DEFAULT_XERO_SETTINGS, now })
  assert.equal(body.Type, 'ACCREC')
  assert.equal(body.Status, 'DRAFT')
  assert.equal(body.Reference, 'BBC-0042')
  assert.equal(body.DueDate, '2026-11-13')
  assert.equal(body.LineAmountTypes, 'Exclusive')
})

test('contact prefers organisation, skips caller placeholders', () => {
  assert.equal(contactFromJob({ client_organization_name: 'Acme Realty', client_name: 'Jo' }).name, 'Acme Realty')
  assert.equal(contactFromJob({ client_name: 'Caller +61400111222', client_email: 'a@b.com' }).name, 'a@b.com')
  assert.equal(contactFromJob({ client_name: 'Unknown caller', job_code: 'J1' }).name, 'Job J1')
})

test('Xero validation errors are surfaced', () => {
  assert.equal(xeroErrorMessage({ Elements: [{ ValidationErrors: [{ Message: 'Account code is not valid' }] }] }), 'Account code is not valid')
  assert.equal(xeroErrorMessage({ Detail: 'TokenExpired' }), 'TokenExpired')
})

test('BCQ, CCQ and SACQ are acceptable quotes', () => {
  for (const t of ['quote', 'biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote']) {
    assert.ok(isAcceptableQuoteType(t))
  }
  assert.ok(!isAcceptableQuoteType('report'))
})

test('deposit prefill reads what Xero says was paid, with the latest payment date', () => {
  assert.equal(xeroDate('/Date(1762387200000+0000)/'), '2025-11-06')
  assert.equal(xeroDate('2026-11-02T00:00:00'), '2026-11-02')
  assert.equal(xeroDate('soon'), null)
  assert.deepEqual(
    invoicePaid({ InvoiceNumber: 'INV-9', AmountPaid: 1100.004, Payments: [{ Date: '/Date(1762387200000+0000)/' }, { Date: '2025-10-01' }] }),
    { invoice_number: 'INV-9', amount_paid: 1100, paid_on: '2025-11-06' },
  )
  assert.equal(invoicePaid({ InvoiceNumber: 'INV-9', AmountPaid: 0 }), null)
  assert.equal(invoicePaid(null), null)
})

test('a signed link waiting for its staff check holds the job invoice', () => {
  const checked = { id: 'a', confirmed: true, documentIds: ['doc-a'] }
  const waiting = { id: 'b', confirmed: false, documentIds: ['doc-b'] }
  const alsoWaiting = { id: 'c', confirmed: false, documentIds: ['doc-c', 'doc-d'] }

  // Any trigger other than the check itself (a quote edited, another quote accepted) is held.
  assert.deepEqual(staffCheckHold([checked, waiting], null), { hold: true, leaveOut: [] })
  // Nothing waiting: carry on as before.
  assert.deepEqual(staffCheckHold([checked], null), { hold: false, leaveOut: [] })
  assert.deepEqual(staffCheckHold([], null), { hold: false, leaveOut: [] })

  // The check on a link goes ahead for that link.
  assert.deepEqual(staffCheckHold([checked, waiting], 'b'), { hold: false, leaveOut: [] })
  // Another link still waiting is not invoiced along with it.
  assert.deepEqual(staffCheckHold([checked, waiting, alsoWaiting], 'b'), { hold: false, leaveOut: ['doc-c', 'doc-d'] })
  // Creating the invoice again on a link already checked leaves every waiting link out.
  assert.deepEqual(staffCheckHold([checked, waiting], 'a'), { hold: false, leaveOut: ['doc-b'] })
})

test('the staff link opens the invoice inside Xero', () => {
  assert.equal(
    xeroInvoiceUrl(' 3f2a9c1e-0000-4000-8000-123456789abc '),
    'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=3f2a9c1e-0000-4000-8000-123456789abc',
  )
  assert.equal(xeroInvoiceUrl('a b&c'), 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=a%20b%26c')
})

test('the signed alert asks staff to check and invoice, and escapes what the client typed', async () => {
  process.env.RESEND_API_KEY ||= 're_test_not_used'
  const { quoteAcceptedEmailHtml } = await import('../email')
  const base = {
    jobId: 'job-1', clientName: 'Jane <b>Smith</b>', siteAddress: '1 Example St', jobType: 'trauma',
    reference: 'BCQ-1', total: 3300, contactEmail: 'jane@example.com',
  }
  const signed = quoteAcceptedEmailHtml({ ...base, checkNote: 'Nothing has been invoiced yet. Check <it>.' })
  assert.match(signed, /Quote signed: check and create the invoice/)
  assert.match(signed, /Nothing has been invoiced yet\. Check &lt;it&gt;\./)
  assert.match(signed, /Open job to check →/)
  assert.match(signed, /\/jobs\/job-1"/)
  assert.doesNotMatch(signed, /Ready to schedule|Open invoice in Xero|<b>Smith/)
  assert.match(signed, /Jane &lt;b&gt;Smith&lt;\/b&gt;/)

  // The emailed accept box is unchanged.
  const accepted = quoteAcceptedEmailHtml(base)
  assert.match(accepted, /Quote Accepted ✓/)
  assert.match(accepted, /Ready to schedule — open the job to proceed\./)
  // Only a real Xero address is ever linked.
  assert.match(quoteAcceptedEmailHtml({ ...base, xeroInvoiceUrl: xeroInvoiceUrl('abc') }), /Open invoice in Xero →/)
  assert.doesNotMatch(quoteAcceptedEmailHtml({ ...base, xeroInvoiceUrl: 'https://evil.example/x' }), /Open invoice in Xero|evil\.example/)
})

test('Xero returns the admin to the staff host they are signed in on, and to no other host', () => {
  const env = { NEXT_PUBLIC_APP_URL: 'https://app.biohazards.net/' }
  assert.equal(xeroRedirectUriFor('login.biohazards.net', env), 'https://login.biohazards.net/api/xero/callback')
  assert.equal(xeroRedirectUriFor('app.biohazards.net', env), 'https://app.biohazards.net/api/xero/callback')
  assert.equal(xeroRedirectUriFor('Login.Biohazards.net:443', env), 'https://login.biohazards.net/api/xero/callback')
  // Any other host (a client-facing one, or one made up in the request) falls back to the app address.
  for (const host of ['document.forensiccleaningqld.com.au', 'evil.example', 'login.biohazards.net.evil.example', '', null]) {
    assert.equal(xeroRedirectUriFor(host, env), 'https://app.biohazards.net/api/xero/callback', String(host))
  }
  assert.equal(xeroRedirectUriFor(null, {}), 'https://app.biohazards.net/api/xero/callback')
  assert.equal(xeroRedirectUriFor('localhost:3000', { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }), 'http://localhost:3000/api/xero/callback')
  // An explicit setting always wins.
  assert.equal(xeroRedirectUriFor('login.biohazards.net', { XERO_REDIRECT_URI: ' https://x.example/cb ' }), 'https://x.example/cb')
})
