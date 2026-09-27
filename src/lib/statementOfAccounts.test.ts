import assert from 'node:assert/strict'
import test from 'node:test'
import type { StatementOfAccountsContent } from '@/lib/types'
import {
  emptyStatementCapture,
  presentStatementDocument,
  statementClientLines,
  statementFigures,
  statementPayHref,
  statementPhone,
  StatementReconciliationError,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'

function contentFor(
  capture: StatementOfAccountsCapture,
  extra: Partial<StatementOfAccountsContent> = {},
): StatementOfAccountsContent {
  const figures = statementFigures(capture)
  return {
    title: 'Statement of Accounts',
    reference: 'SOA-20260926-CFA2',
    site_address: '1 Example Street',
    quote_reference: 'EST-1',
    disposal_reference: 'CDR-1',
    gst_mode: figures.gst_mode,
    quote_ex: figures.quote_ex,
    quote_gst: figures.quote_gst,
    quote_inc: figures.quote_inc,
    disposal: figures.disposal,
    deposit_taken: figures.deposit_taken,
    deposit_entered: figures.deposit_entered,
    deposit_ex: figures.deposit_ex,
    owing_ex: figures.owing_ex,
    gst: figures.gst,
    owing_inc: figures.owing_inc,
    original_owing_ex: figures.original_owing_ex,
    original_owing_inc: figures.original_owing_inc,
    new_invoice_ex: figures.new_invoice_ex,
    new_invoice_inc: figures.new_invoice_inc,
    remeasured: figures.remeasured,
    remeasure_inc: figures.remeasure_inc,
    invoice2_owing_inc: figures.invoice2_owing_inc,
    job_total_ex: figures.job_total_ex,
    job_total_inc: figures.job_total_inc,
    has_invoice2: figures.has_invoice2,
    original_invoice_number: capture.original_invoice_number,
    original_invoice_url: capture.original_invoice_url,
    new_invoice_number: capture.new_invoice_number,
    new_invoice_url: capture.new_invoice_url,
    deposit_date: capture.deposit_date,
    adjustment_reason: capture.adjustment_reason,
    ...extra,
  }
}

function fixture(): StatementOfAccountsCapture {
  return {
    ...emptyStatementCapture(),
    deposit_taken: true,
    deposit_amount: 8669.65,
    deposit_date: '2026-09-20',
    original_invoice_number: 'INV-0244',
    original_invoice_url: 'https://pay.example.com/inv-0244?utm_source=email&utm_medium=soa',
    new_invoice_number: 'INV-0256',
    new_invoice_url: 'https://pay.example.com/inv-0256',
    invoice1_amount: 17339.30,
    invoice1_adjusted_amount: 17083.72,
    invoice2_amount: 6237.46,
    charges_gst: true,
    adjustment_reason: 'the measured area was smaller than the estimate',
  }
}

test('SOA-20260926-CFA2 reconciles for a non-accountant layout', () => {
  const view = presentStatementDocument(contentFor(fixture()))
  assert.equal(view.summary.jobTotalInc, 23321.18)
  assert.equal(view.summary.paidInc, 8669.65)
  assert.equal(view.summary.balanceInc, 14651.53)
  assert.ok(view.summary.gst != null && view.summary.gst > 0)
  assert.equal(
    Math.round((view.summary.jobTotalInc - view.summary.paidInc) * 100) / 100,
    view.summary.balanceInc,
  )
  assert.equal(view.invoices.length, 2)
  const [first, second] = view.invoices
  assert.equal(first.heading, 'INV-0244 — Invoice 1 (initial works)')
  assert.equal(first.balanceInc, 8669.65)
  assert.equal(first.rows[0].amountInc, 17339.30)
  assert.equal(first.rows[1].amountInc, -8669.65)
  assert.match(first.rows[1].label, /^Less: payment received /)
  assert.equal(first.rows.some(row => row.label.includes('credit transferred')), false)
  assert.equal(first.rows.some(row => row.label.includes('after adjustment')), false)
  assert.equal(second.heading, 'INV-0256 — Invoice 2 (contents)')
  assert.equal(second.rows[0].amountInc, 6237.46)
  assert.equal(second.rows[1].amountInc, -255.58)
  assert.match(second.rows[1].label, /Less: credit from INV-0244 adjustment/)
  assert.equal(second.balanceInc, 5981.88)
  const summed = Math.round(view.invoices.reduce((sum, invoice) => sum + invoice.balanceInc, 0) * 100) / 100
  assert.equal(summed, view.summary.balanceInc)
  for (const invoice of view.invoices) {
    const ledger = invoice.rows.filter(row => !row.explain)
    const above = ledger.slice(0, -1).reduce((sum, row) => sum + row.amountInc, 0)
    assert.equal(Math.round(above * 100) / 100, invoice.balanceInc)
  }
  assert.match(view.adjustmentNote ?? '', /INV-0244 was reduced by \$255\.58/)
  assert.match(view.adjustmentNote ?? '', /applied to INV-0256/)
  assert.equal(first.payLabel, 'Pay $8,669.65 online')
  assert.equal(first.payHref, 'https://pay.example.com/inv-0244')
  assert.equal(view.warnings.length, 0)
})

test('Xero amount due warns when it differs and stays quiet when it matches', () => {
  const matched = presentStatementDocument(contentFor(fixture(), {
    xero_original_amount_due: 8669.65,
    xero_new_amount_due: 5981.88,
  }))
  assert.equal(matched.warnings.length, 0)
  const drifted = presentStatementDocument(contentFor(fixture(), {
    xero_original_amount_due: 8000,
  }))
  assert.equal(drifted.warnings.length, 1)
  assert.match(drifted.warnings[0], /INV-0244/)
  assert.match(drifted.warnings[0], /8,000\.00/)
})

test('invoice breakdowns explain the amount and must add up', () => {
  const view = presentStatementDocument(contentFor(fixture(), {
    invoice1_callout: 2000,
    invoice1_contents: 5339.30,
    invoice1_cleaning: 10000,
    invoice2_m3: 12.5,
    invoice2_skips: 4000,
    invoice2_tip_receipts: 2237.46,
  }))
  const [first, second] = view.invoices
  assert.deepEqual(first.rows.slice(0, 4).map(row => [row.label, row.display ?? row.amountInc]), [
    ['Call out', 2000],
    ['Contents', 5339.30],
    ['Cleaning', 10000],
    ['Invoice amount', 17339.30],
  ])
  assert.equal(first.balanceInc, 8669.65)
  assert.deepEqual(second.rows.slice(0, 4).map(row => [row.label, row.display ?? row.amountInc]), [
    ['Cubic metres removed', '12.5 m³'],
    ['Skips', 4000],
    ['Tip receipts', 2237.46],
    ['Invoice amount', 6237.46],
  ])
  assert.equal(second.balanceInc, 5981.88)
  assert.throws(
    () => presentStatementDocument(contentFor(fixture(), { invoice1_callout: 100 })),
    (error: unknown) => error instanceof StatementReconciliationError && /call out/.test(error.message),
  )
  const metresOnly = presentStatementDocument(contentFor(fixture(), { invoice2_m3: 8 }))
  assert.equal(metresOnly.invoices[1].rows[0].display, '8 m³')
  assert.equal(metresOnly.invoices[1].balanceInc, 5981.88)
})

test('an adjustment without a reason fails the build', () => {
  const capture = fixture()
  capture.adjustment_reason = '   '
  assert.throws(
    () => presentStatementDocument(contentFor(capture)),
    (error: unknown) => error instanceof StatementReconciliationError && /reason/.test(error.message),
  )
})

test('client name, phone, and pay links stay readable', () => {
  assert.deepEqual(statementClientLines('L.J.H. Holdings Pty Ltd ACN 087871341'), {
    line1: 'L.J.H. Holdings Pty Ltd',
    line2: 'ACN 087 871 341',
  })
  assert.equal(statementPhone('+61404143284'), '+61 404 143 284')
  assert.equal(statementPhone('+61730123456'), '+61 7 3012 3456')
  assert.equal(statementPayHref('https://pay.example.com/a?utm_source=x&keep=1'), 'https://pay.example.com/a?keep=1')
})
