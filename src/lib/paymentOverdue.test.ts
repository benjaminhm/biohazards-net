import assert from 'node:assert/strict'
import test from 'node:test'
import type { Job } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  addCalendarDays,
  buildPaymentReminderContent,
  daysBetween,
  emptyPaymentOverdueCapture,
  overdueInvoiceOptions,
  paymentReminderResult,
  resolveContractedPayer,
  type PaymentOverdueCapture,
} from '@/lib/paymentOverdue'
import { emptyStatementCapture, type StatementOfAccountsCapture } from '@/lib/statementOfAccounts'

function statement(patch: Partial<StatementOfAccountsCapture>): StatementOfAccountsCapture {
  return { ...emptyStatementCapture(), ...patch }
}

function capture(patch: Partial<PaymentOverdueCapture> = {}): PaymentOverdueCapture {
  return { ...emptyPaymentOverdueCapture(), ...patch }
}

const ready = capture({
  letter_date: '2026-10-05',
  payer_name: 'Northside Property Pty Ltd',
  payer_address: '12 Accounts Street\nBrisbane QLD 4000',
  payer_abn: '12 345 678 901',
  invoice1_late: true,
  invoice1_submitted: '2026-08-01',
  invoice1_due: '2026-08-15',
})

test('trade account legal name is the contracted payer', () => {
  const payer = resolveContractedPayer(
    { client_name: 'Sam Lee', client_organization_name: 'Northside', site_address: '1 Site St' },
    { legal_name: 'Northside Property Pty Ltd', billing_address: '12 Accounts Street', abn: '12 345 678 901' },
  )
  assert.equal(payer.source, 'account')
  assert.equal(payer.name, 'Northside Property Pty Ltd')
  assert.equal(payer.address, '12 Accounts Street')
  assert.equal(payer.abn, '12 345 678 901')
})

test('organisation name is the payer when there is no trade account', () => {
  const payer = resolveContractedPayer(
    { client_name: 'Sam Lee', client_organization_name: 'Northside Property', site_address: '1 Site St' },
    null,
  )
  assert.equal(payer.source, 'organisation')
  assert.equal(payer.name, 'Northside Property')
  assert.equal(payer.address, '')
})

test('a person with no organisation is the contracted payer', () => {
  const payer = resolveContractedPayer(
    { client_name: 'Sam Lee', site_address: '1 Site St' },
    null,
  )
  assert.equal(payer.source, 'person')
  assert.equal(payer.name, 'Sam Lee')
  assert.equal(payer.address, '1 Site St')
})

test('a paid invoice cannot be marked late', () => {
  const options = overdueInvoiceOptions(statement({
    invoice1_amount: 1100,
    deposit_taken: true,
    deposit_amount: 1100,
    invoice2_amount: 550,
    original_invoice_number: 'INV-1',
    new_invoice_number: 'INV-2',
  }))
  assert.deepEqual(options.map(option => option.key), ['invoice2'])
  assert.equal(options[0].label, 'Invoice 2 (INV-2)')
  assert.equal(options[0].remainingInc, 550)
})

test('invoice 1 keeps its own balance when invoice 2 carries an adjustment', () => {
  const options = overdueInvoiceOptions(statement({
    invoice1_amount: 1100,
    deposit_taken: true,
    deposit_amount: 100,
    invoice1_adjusted_amount: 900,
    invoice2_amount: 500,
    adjustment_reason: 'Remeasured',
  }))
  const invoice1 = options.find(option => option.key === 'invoice1')
  const invoice2 = options.find(option => option.key === 'invoice2')
  assert.equal(invoice1?.remainingInc, 1000)
  assert.equal(invoice2?.remainingInc, 300)
})

test('the reminder quotes the statement and counts 14, 21 and 28 days from the letter', () => {
  const result = paymentReminderResult(
    '8 Example Road',
    {
      ...ready,
      invoice2_late: true,
      invoice2_submitted: '2026-09-01',
      invoice2_due: '2026-09-10',
      guarantor_name: 'Sam Lee',
      guarantor_address: '4 Home Street, Brisbane',
      guarantee_reference: 'engagement dated 1 July 2026',
    },
    statement({
      invoice1_amount: 1100,
      invoice2_amount: 550,
      original_invoice_number: 'INV-1',
      new_invoice_number: 'INV-2',
    }),
    '2026-10-05',
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.draft.payBy, '2026-10-19')
  assert.equal(result.draft.demandOn, '2026-10-26')
  assert.equal(result.draft.finalOn, '2026-11-02')
  assert.equal(result.draft.lateTotalInc, 1650)
  assert.equal(result.draft.lateInvoices[0].daysLate, daysBetween('2026-08-15', '2026-10-05'))
  assert.ok(result.draft.statementLines.some(line => line.label === 'Invoice 1'))
  assert.match(result.draft.paragraphs.join('\n'), /Statement of Accounts for 8 Example Road/)
  assert.match(result.draft.paragraphs.join('\n'), /Invoice 1 \(INV-1\) is late by/)
  assert.match(result.draft.paragraphs.join('\n'), /Invoice 2 \(INV-2\) is late by/)
  assert.match(result.draft.paragraphs.join('\n'), /letter of demand will be sent to Northside Property Pty Ltd at 12 Accounts Street/)
  assert.match(result.draft.paragraphs.join('\n'), /Sam Lee, who personally guaranteed this payment \(engagement dated 1 July 2026\)/)
  assert.match(result.draft.paragraphs.join('\n'), /legal action will be commenced/)
  assert.equal(addCalendarDays('2026-10-05', 14), '2026-10-19')
})

test('an invoice that is not yet due is rejected', () => {
  const result = paymentReminderResult(
    '8 Example Road',
    { ...ready, invoice1_due: '2026-10-20' },
    statement({ invoice1_amount: 1100, original_invoice_number: 'INV-1' }),
    '2026-10-05',
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.issues.join(' '), /not late/)
})

test('a partial guarantor is rejected', () => {
  const result = paymentReminderResult(
    '8 Example Road',
    { ...ready, guarantor_name: 'Sam Lee' },
    statement({ invoice1_amount: 1100 }),
    '2026-10-05',
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.issues.join(' '), /guarantor/)
})

test('compose stores the reminder and reports a missing balance', () => {
  const job = {
    id: 'job-1',
    site_address: '8 Example Road',
    assessment_data: {
      statement_of_accounts: statement({ invoice1_amount: 1100, original_invoice_number: 'INV-1' }),
      payment_overdue: ready,
    },
  } as Job
  const content = buildPaymentReminderContent(job, 'PRM-20261005-JOB1')
  assert.equal(content.error, '')
  assert.equal(content.reference, 'PRM-20261005-JOB1')
  assert.equal(content.late_invoices.length, 1)
  assert.equal(content.pay_by, '2026-10-19')

  const blocked = buildPaymentReminderContent({ ...job, assessment_data: { statement_of_accounts: emptyStatementCapture() } } as Job, 'PRM-1')
  assert.match(blocked.error, /no invoice balance/)

  const html = buildPrintHTML('payment_reminder', content as unknown as Record<string, unknown>, [], [], null, 'job-1', 'http://localhost', undefined, { screenActionBar: false })
  assert.match(html, /Payment Reminder/)
  assert.match(html, /Northside Property Pty Ltd/)
  assert.match(html, /letter of demand will be sent to Northside Property Pty Ltd/)
  assert.match(html, /19 October 2026/)
  assert.match(html, /legal action will be commenced/)
})
