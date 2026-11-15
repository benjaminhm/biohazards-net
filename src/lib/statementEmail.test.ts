import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StatementOfAccountsV2Content } from './types'
import {
  ATTACHMENT_LIMIT_BYTES,
  emailMoney,
  statementEmailInput,
  statementEmailMoney,
  trimAttachments,
  uniqueFilenames,
} from './statementEmail'

const PAY1 = 'https://in.xero.com/inv-0269'
const PAY2 = 'https://in.xero.com/inv-0284'

/** Job total $2,970 inc GST, $1,000 deposit paid. */
function statement(over: Partial<StatementOfAccountsV2Content> = {}): StatementOfAccountsV2Content {
  return {
    model_version: 2,
    title: 'Statement of Accounts',
    reference: 'SOA-1',
    site_address: '1 Example Street',
    charges_gst: true,
    estimates_note: '',
    lines: [{ label: 'Surface cleaning', amount_ex: 2700 }],
    total_ex: 2700,
    gst: 270,
    total_inc: 2970,
    deposit: 1000,
    deposit_date: '2026-11-02',
    adjustment: null,
    adjustment_reason: '',
    balance: 1970,
    invoice_number: 'INV-0269',
    invoice_url: PAY1,
    invoice2_number: '',
    invoice2_url: '',
    credit_note_number: '',
    estimate_total: null,
    adjustment_lines: [],
    problems: [],
    ...over,
  }
}

function money(content: unknown) {
  const m = statementEmailMoney(content)
  assert.ok(m)
  return m
}

test('summary card: total job value, paid to date, balance due emphasised', () => {
  assert.deepEqual(money(statement()).summary, [
    { label: 'Total job value', value: '$2,970.00' },
    { label: 'Paid to date', value: '$1,000.00' },
    { label: 'Balance due', value: '$1,970.00', strong: true },
  ])
  assert.equal(money(statement()).preheader, 'Balance due $1,970.00')
  assert.equal(emailMoney(3278.444), '$3,278.44')
})

test('no estimate: one pay button for the balance on invoice 1', () => {
  assert.deepEqual(money(statement()).payButtons, [{ label: 'Pay invoice INV-0269 · $1,970.00', href: PAY1 }])
  assert.deepEqual(money(statement({ invoice_url: '' })).payButtons, [])
  assert.deepEqual(money(statement({ invoice_number: '' })).payButtons, [{ label: 'Pay now · $1,970.00', href: PAY1 }])
})

test('over the estimate: a pay button for invoice 1 and invoice 2, each for what is owing on it', () => {
  const over = statement({ estimate_total: 2500, invoice2_number: 'INV-0284', invoice2_url: PAY2 })
  const m = money(over)
  assert.deepEqual(m.payButtons, [
    { label: 'Pay invoice INV-0269 · $1,500.00', href: PAY1 },
    { label: 'Pay invoice INV-0284 · $470.00', href: PAY2 },
  ])
  assert.deepEqual(m.notes, [])
  assert.deepEqual(money({ ...over, invoice2_url: '' }).payButtons, [{ label: 'Pay invoice INV-0269 · $1,500.00', href: PAY1 }])
  assert.deepEqual(money({ ...over, invoice_url: '' }).payButtons, [{ label: 'Pay invoice INV-0284 · $470.00', href: PAY2 }])
})

test('invoice 1 paid in full: only invoice 2 can be paid', () => {
  const m = money(statement({ estimate_total: 2500, deposit: 2500, invoice1_paid_in_full: true, balance: 470, invoice2_number: 'INV-0284', invoice2_url: PAY2 }))
  assert.deepEqual(m.payButtons, [{ label: 'Pay invoice INV-0284 · $470.00', href: PAY2 }])
})

test('under the estimate: no pay button on invoice 1 until the credit note is applied in Xero', () => {
  const under = statement({ estimate_total: 3500, credit_note_number: 'CN-3' })
  const waiting = money(under)
  assert.deepEqual(waiting.payButtons, [])
  assert.deepEqual(waiting.notes, ['Invoice 1 INV-0269: The pay link is added once the credit note has been applied to this invoice.'])
  assert.equal(waiting.summary[2].value, '$1,970.00')

  const applied = money({ ...under, credit_note_applied: true })
  assert.deepEqual(applied.payButtons, [{ label: 'Pay invoice INV-0269 · $1,970.00', href: PAY1 }])
  assert.deepEqual(applied.notes, [])
})

test('nothing owing or a credit: no pay buttons', () => {
  const paid = money(statement({ deposit: 2970, balance: 0 }))
  assert.deepEqual(paid.payButtons, [])
  assert.equal(paid.summary[2].value, '$0.00')
  const credit = money(statement({ deposit: 3000, balance: -30 }))
  assert.deepEqual(credit.payButtons, [])
  assert.deepEqual(credit.summary[2], { label: 'Credit in your favour', value: '$30.00', strong: true })
  assert.equal(credit.preheader, 'Credit in your favour $30.00')
})

test('a statement that cannot be shown has no card or pay buttons', () => {
  assert.equal(statementEmailMoney(statement({ problems: ['Enter the date the deposit was paid.'] })), null)
  const email = statementEmailInput({
    brandLabel: 'FCQ', reference: 'SOA-1', message: 'Hi', statementContent: statement({ problems: ['x'] }),
    packUrl: 'https://d.example.com/p/abc', items: [], expiresLabel: '12 December 2026', contact: {},
  })
  assert.equal(email.summary, undefined)
  assert.equal(email.secondary, undefined)
  assert.equal(email.primary.href, 'https://d.example.com/p/abc')
})

test('the email: staff message as written, View statement, each document with its own link and whether it is attached', () => {
  const email = statementEmailInput({
    brandLabel: 'Forensic Cleaning QLD',
    reference: 'SOA-1',
    message: 'Hi Sam,\n\nYour statement.',
    statementContent: statement(),
    packUrl: 'https://d.example.com/p/abc',
    items: [
      { name: 'Statement of Accounts SOA-1', href: 'https://d.example.com/p/abc', status: 'attached' },
      { name: 'Contents Disposal Record CDR-1', href: 'https://d.example.com/p/abc?doc=2', status: 'too_large' },
      { name: 'Post Remediation Evaluation', href: 'https://d.example.com/p/abc?doc=3', status: 'failed' },
    ],
    expiresLabel: '12 December 2026',
    contact: { phone: '+61 7 3000 0000', email: 'admin@example.com.au' },
  })
  assert.equal(email.title, 'Statement of Accounts')
  assert.equal(email.reference, 'SOA-1')
  assert.equal(email.message, 'Hi Sam,\n\nYour statement.')
  assert.deepEqual(email.primary, { label: 'View statement', href: 'https://d.example.com/p/abc' })
  assert.deepEqual(email.secondary, [{ label: 'Pay invoice INV-0269 · $1,970.00', href: PAY1 }])
  assert.equal(email.documentsHeading, 'Your documents (PDFs attached)')
  assert.deepEqual(email.documents?.map(d => [d.name, d.href, d.note]), [
    ['Statement of Accounts SOA-1', 'https://d.example.com/p/abc', 'PDF attached'],
    ['Contents Disposal Record CDR-1', 'https://d.example.com/p/abc?doc=2', 'Not attached: use View to open it'],
    ['Post Remediation Evaluation', 'https://d.example.com/p/abc?doc=3', 'Not attached: use View to open it'],
  ])
  assert.match(email.linkNote ?? '', /until 12 December 2026\.$/)
})

test('attachments over the limit: the largest go as links, the statement last of all', () => {
  const MB = 1024 * 1024
  assert.equal(ATTACHMENT_LIMIT_BYTES, 20 * MB)
  const files = [
    { name: 'statement', size: 1 * MB, keep: true },
    { name: 'cdr', size: 3 * MB },
    { name: 'report', size: 15 * MB },
    { name: 'survey', size: 6 * MB },
  ]
  const trimmed = trimAttachments(files)
  assert.deepEqual(trimmed.attached.map(f => f.name), ['statement', 'cdr', 'survey'])
  assert.deepEqual(trimmed.tooLarge.map(f => f.name), ['report'])

  const all = trimAttachments(files, 30 * MB)
  assert.equal(all.tooLarge.length, 0)
  assert.deepEqual(all.attached, files)

  const tight = trimAttachments(files, 2 * MB)
  assert.deepEqual(tight.attached.map(f => f.name), ['statement'])
  assert.deepEqual(tight.tooLarge.map(f => f.name), ['cdr', 'report', 'survey'])

  const hugeStatement = trimAttachments([{ name: 'statement', size: 25 * MB, keep: true }, { name: 'cdr', size: 1 * MB }])
  assert.deepEqual(hugeStatement.attached.map(f => f.name), ['cdr'])
  assert.deepEqual(hugeStatement.tooLarge.map(f => f.name), ['statement'])
})

test('attachment names are made unique', () => {
  assert.deepEqual(
    uniqueFilenames(['Statement of Accounts SOA-1.pdf', 'Post Remediation Evaluation.pdf', 'Post Remediation Evaluation.pdf']),
    ['Statement of Accounts SOA-1.pdf', 'Post Remediation Evaluation.pdf', 'Post Remediation Evaluation (2).pdf'],
  )
})
