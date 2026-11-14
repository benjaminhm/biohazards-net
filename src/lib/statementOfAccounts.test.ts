import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssessmentData, StatementOfAccountsContent } from '@/lib/types'
import {
  emptyStatementCapture,
  normalizeStatementCapture,
  presentStatementDocument,
  presentStatementV2,
  statementClientLines,
  statementPayHref,
  statementPhone,
  statementReminderLines,
  statementV2Content,
  statementV2Figures,
  statementV2Invoices,
  statementV2Adjustments,
  statementV2Rows,
  breakdownTotal,
  StatementReconciliationError,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'
import { surveySummary, cdrSummary } from '@/lib/agent/recordSummaries'
import { surfaceAreaCaptureFigures, emptySurfaceAreaCleaningCapture } from '@/lib/surfaceAreaCleaningQuote'
import { emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { buildPrintHTML } from '@/lib/printDocument'
import { statementXeroDocs } from '@/lib/xero/statementDocs'
import { DEFAULT_XERO_SETTINGS } from '@/lib/xero/invoice'

/** Model 1 figures for the fixture, as they were stored on statements issued before model 2. */
const V1_FIGURES = {
  gst_mode: 'exclusive', quote_ex: 15763, quote_gst: 1576.3, quote_inc: 17339.3, disposal: 5670.42, deposit_taken: true,
  deposit_entered: 8669.65, deposit_ex: 7881.5, owing_ex: 13319.57, gst: 1331.96, owing_inc: 14651.53, original_owing_ex: 7881.5,
  original_owing_inc: 8669.65, new_invoice_ex: 5670.42, new_invoice_inc: 6237.46, remeasured: true, remeasure_inc: 255.58,
  invoice2_owing_inc: 5981.88, job_total_ex: 21201.07, job_total_inc: 23321.18, has_invoice2: true,
} as const

/** The same with a manual adjustment on the last invoice. */
const V1_MANUAL: Record<number, Partial<StatementOfAccountsContent>> = {
  [-100]: { owing_ex: 13228.66, gst: 1322.87, owing_inc: 14551.53, invoice2_owing_inc: 5881.88, job_total_ex: 21110.16, job_total_inc: 23221.18 },
  [-50]: { owing_ex: 13274.12, gst: 1327.41, owing_inc: 14601.53, invoice2_owing_inc: 5931.88, job_total_ex: 21155.62, job_total_inc: 23271.18 },
}

function contentFor(
  capture: StatementOfAccountsCapture,
  extra: Partial<StatementOfAccountsContent> = {},
): StatementOfAccountsContent {
  return {
    title: 'Statement of Accounts',
    reference: 'SOA-20260926-CFA2',
    site_address: '1 Example Street',
    quote_reference: 'EST-1',
    disposal_reference: 'CDR-1',
    ...V1_FIGURES,
    ...(capture.manual_adjustment == null ? {} : V1_MANUAL[capture.manual_adjustment]),
    original_invoice_number: capture.original_invoice_number,
    original_invoice_url: capture.original_invoice_url,
    new_invoice_number: capture.new_invoice_number,
    new_invoice_url: capture.new_invoice_url,
    deposit_date: capture.deposit_date,
    adjustment_reason: capture.adjustment_reason,
    manual_adjustment_inc: capture.manual_adjustment,
    manual_adjustment_reason: capture.manual_adjustment_reason,
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
  const withAreas = presentStatementDocument(contentFor(fixture(), {
    invoice1_callout: 2000,
    invoice1_contents: 5339.30,
    invoice1_cleaning: 10000,
    survey_areas: [
      { label: 'Granny Flat', sqm: 182.21, total: 2733.87 },
      { label: 'Ground Floor Main Dwelling', sqm: 367.9, total: 5519.98 },
      { label: 'Level 2 Main Dwelling', sqm: 240.26, total: 3604.87 },
    ],
  }))
  assert.deepEqual(withAreas.invoices[0].rows.slice(0, 8).map(row => [row.label, row.quantity ?? null, row.display ?? row.amountInc]), [
    ['Call out', null, 2000],
    ['Contents', null, 5339.30],
    ['Cleaning', null, 10000],
    ['Granny Flat', '182.21 m²', 2733.87],
    ['Ground Floor Main Dwelling', '367.9 m²', 5519.98],
    ['Level 2 Main Dwelling', '240.26 m²', 3604.87],
    ['Total area', '790.37 m²', 11858.72],
    ['Invoice amount', null, 17339.30],
  ])
  assert.equal(withAreas.invoices[0].balanceInc, 8669.65)
  assert.deepEqual(second.rows.slice(0, 4).map(row => [row.label, row.display ?? row.amountInc]), [
    ['Cubic metres removed', '12.5 m³'],
    ['Skips', 4000],
    ['Tip receipts', 2237.46],
    ['Invoice amount', 6237.46],
  ])
  assert.equal(second.balanceInc, 5981.88)
  const split = presentStatementDocument(contentFor(fixture(), {
    invoice2_skips: 1650,
    invoice2_trailers: 4591.95,
    invoice2_utes: 508.20,
    invoice2_tip_receipts: 1137.31,
    invoice2_prepaid: 1650,
  }))
  assert.deepEqual(split.invoices[1].rows.slice(0, 6).map(row => [row.label, row.amountInc]), [
    ['Skips', 1650],
    ['Trailers', 4591.95],
    ['Utes', 508.20],
    ['Tip receipts', 1137.31],
    ['Prepaid', -1650],
    ['Invoice amount', 6237.46],
  ])
  assert.equal(split.invoices[1].balanceInc, 5981.88)
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

test('a manual line changes the last invoice total', () => {
  const reduced = fixture()
  reduced.manual_adjustment = -100
  reduced.manual_adjustment_reason = 'agreed reduction'
  const view = presentStatementDocument(contentFor(reduced))
  assert.equal(view.invoices[0].balanceInc, 8669.65)
  assert.equal(view.invoices[1].balanceInc, 5881.88)
  assert.equal(view.summary.balanceInc, 14551.53)
  assert.equal(view.summary.jobTotalInc, 23221.18)
  const adjustment = view.invoices[1].rows.find(row => row.label === 'agreed reduction')
  assert.equal(adjustment?.amountInc, -100)
  const balance = view.invoices[1].rows.at(-1)
  assert.equal(balance?.label, 'Balance due on INV-0256')
  assert.equal(balance?.amountInc, 5881.88)
  const blank = fixture()
  blank.manual_adjustment = -50
  blank.manual_adjustment_reason = '  '
  assert.throws(
    () => presentStatementDocument(contentFor(blank)),
    (error: unknown) => error instanceof StatementReconciliationError && /last invoice/.test(error.message),
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

function combinedContent(extra: Partial<StatementOfAccountsContent> = {}): StatementOfAccountsContent {
  return contentFor(fixture(), {
    survey_areas: [{ label: 'Lounge', sqm: 12, total: 264 }],
    invoice2_m3: 15,
    layout_version: 2,
    survey_snapshot: { reference: 'SUR-1', rooms: [{ name: 'Lounge', sqm: 12, rate_ex: 20, line_ex: 240, line_inc: 264 }], total_sqm: 12, subtotal_ex: 240, gst: 24, total_value_inc: 264 },
    disposal_snapshot: { reference: 'CDR-9', total_m3: 9, load_count: 3, vehicles: [{ type: 'skip', label: 'Skip', count: 2 }], distance_km: 22.5, weight_kg: 800, invoiced_m3: 15 },
    ...extra,
  })
}

function statementHtml(content: StatementOfAccountsContent | ReturnType<typeof statementV2Content>): string {
  return buildPrintHTML('statement_of_accounts', content as unknown as Record<string, unknown>, [], [], null, 'job-1', 'https://app.example.com')
}

test('combined statement prints survey, disposal, then invoices with no repeated survey rows', () => {
  const content = combinedContent()
  const html = statementHtml(content)
  const survey = html.indexOf('1. Survey Rooms')
  const cdr = html.indexOf('2. Contents Disposal Record')
  const invoices = html.indexOf('3. Invoice Summary')
  assert.ok(survey > 0 && cdr > survey && invoices > cdr)
  assert.equal(html.split('>Lounge<').length - 1, 1)
  assert.equal(html.includes('Total area'), true)
  assert.equal(html.includes('Cubic metres removed'), false)
  assert.match(html, /Total owing<\/td><td class="r"[^>]*>\$14,651\.53/)
  const view = presentStatementDocument(content)
  assert.equal(view.invoices[0].rows.some(row => row.quantity), false)
  assert.equal(view.summary.balanceInc, presentStatementDocument(contentFor(fixture())).summary.balanceInc)
})

test('combined statement says Not applicable without a survey or CDR', () => {
  const html = statementHtml(combinedContent({ survey_snapshot: null, disposal_snapshot: null }))
  assert.match(html, /1\. Survey Rooms<\/div><p class="body-text soa-na">Not applicable/)
  assert.match(html, /2\. Contents Disposal Record<\/div><p class="body-text soa-na">Not applicable/)
  assert.equal(html.includes('Cubic metres removed'), true)
})

test('a statement generated before the combined layout prints as it did', () => {
  const legacy = contentFor(fixture(), { survey_areas: [{ label: 'Lounge', sqm: 12, total: 264 }], invoice2_m3: 15 })
  const html = statementHtml(legacy)
  assert.equal(html.includes('1. Survey Rooms'), false)
  assert.equal(html.includes('Cubic metres removed'), true)
  assert.ok(presentStatementDocument(legacy).invoices[0].rows.some(row => row.quantity))
})

test('model 1 content still prints the two-invoice statement, not model 2', () => {
  const html = statementHtml(contentFor(fixture()))
  assert.match(html, /INV-0244 — Invoice 1 \(initial works\)/)
  assert.match(html, /INV-0256 — Invoice 2 \(contents\)/)
  assert.equal(html.includes('Less deposit paid'), false)
})

const sacq = { ...emptySurfaceAreaCleaningCapture(), estimated_m2: 100, rate_per_m2: 10 }
const bcqByArea = { ...emptyBiohazardCleaningCapture(), estimated_m2: 20, rate_per_m2: 50, labour_days: 2, rate_per_labour_day: 600, travel_km: 0 }

function v2Job(statement: Partial<StatementOfAccountsCapture> = {}, extra: Record<string, unknown> = {}): AssessmentData {
  return {
    surface_area_cleaning_quote: sacq,
    house_survey: { areas: [], price_per_m2: 20, labour_days: 1, rate_per_labour_day: 500, mobilisation_fee: 100 },
    biohazard_cleaning_quote: bcqByArea,
    biohazard_cleaning_record: { primary_m2: 18 },
    statement_of_accounts: { ...emptyStatementCapture(), ...statement },
    ...extra,
  } as unknown as AssessmentData
}

test('model 2: record totals, GST once, less the deposit', () => {
  const ad = v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02' })
  const f = statementV2Figures(ad)
  assert.deepEqual(f.problems, [])
  assert.deepEqual(f.lines, [
    { label: 'Surface cleaning', amount_ex: surveySummary(ad).total_ex_gst },
    { label: 'Biohazard cleaning', amount_ex: 18 * 50 + 2 * 600 },
  ])
  assert.equal(f.total_ex, 600 + 2100)
  assert.equal(f.gst, 270)
  assert.equal(f.total_inc, 2970)
  assert.equal(f.balance, 1970)
  assert.deepEqual(statementV2Rows(f).map(row => [row.label, row.amount]), [
    ['Surface cleaning', 600],
    ['Biohazard cleaning', 2100],
    ['Job total ex GST', 2700],
    ['GST', 270],
    ['Job total inc GST', 2970],
    ['Less deposit paid (2 November 2026)', -1000],
    ['Balance owing', 1970],
  ])
})

test('model 2: estimates are a paragraph, never in the sum, and suggest half as the deposit', () => {
  const f = statementV2Figures(v2Job())
  const sacqInc = Math.round(surfaceAreaCaptureFigures(sacq).total * 100) / 100
  assert.deepEqual(f.estimates.map(e => e.label), ['Surface area cleaning', 'Biohazard cleaning'])
  assert.equal(f.estimates[0].amount, sacqInc)
  assert.match(f.estimates_note, /^The original estimates totalled \$[\d,.]+ \(Surface area cleaning \$[\d,.]+, Biohazard cleaning \$[\d,.]+\)\. Final figures are based on measured surface area, counted volume and work completed\.$/)
  assert.equal(f.suggested_deposit, Math.round((sacqInc + 2420) / 2 * 100) / 100)
  assert.equal(f.total_ex, 2700)
  assert.equal(statementV2Figures({ house_survey: { areas: [], labour_days: 1, rate_per_labour_day: 100 }, statement_of_accounts: {} } as unknown as AssessmentData).estimates_note, '')
})

test('model 2: an adjustment with its reason, and a credit when the deposit is more', () => {
  const adjusted = statementV2Figures(v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02', manual_adjustment: -70, manual_adjustment_reason: 'goodwill' }))
  assert.equal(adjusted.balance, 1900)
  assert.deepEqual(statementV2Rows(adjusted).slice(-2), [
    { label: 'Adjustment (goodwill)', amount: -70 },
    { label: 'Balance owing', amount: 1900, strong: true },
  ])
  const credit = statementV2Figures(v2Job({ deposit_amount: 3000, deposit_date: '2026-11-02' }))
  assert.equal(credit.balance, -30)
  assert.deepEqual(statementV2Rows(credit).at(-1), { label: 'Credit', amount: 30, strong: true })
  assert.deepEqual(statementReminderLines(credit).at(-1), { label: 'Credit', ex: 27.27, inc: 30, strong: true })
  const noGst = statementV2Figures(v2Job({ charges_gst: false }))
  assert.equal(noGst.gst, 0)
  assert.equal(noGst.balance, 2700)
  assert.deepEqual(statementV2Rows(noGst).map(row => row.label), ['Surface cleaning', 'Biohazard cleaning', 'Job total', 'Balance owing'])
})

test('model 2: a fixed-price BCQ bills its total with no record', () => {
  const fixed = { ...emptyBiohazardCleaningCapture(), labour_days: 1, rate_per_labour_day: 800, travel_km: 0 }
  const f = statementV2Figures(v2Job({}, { biohazard_cleaning_quote: fixed, biohazard_cleaning_record: undefined }))
  assert.deepEqual(f.problems, [])
  assert.deepEqual(f.lines.at(-1), { label: 'Biohazard cleaning', amount_ex: 800 })
})

test('model 2 refuses a statement with missing pieces', () => {
  const problems = (ad: AssessmentData) => statementV2Figures(ad).problems
  assert.match(problems(v2Job({}, { house_survey: undefined }))[0], /needs a House Survey/)
  assert.match(problems(v2Job({}, { contents_clearance_quote: { estimated_m3: 10, rate_per_m3: 80 } }))[0], /needs a Contents Disposal Record/)
  assert.match(problems(v2Job({}, { biohazard_cleaning_record: undefined }))[0], /Fill in the Biohazard Cleaning Record/)
  assert.match(problems(v2Job({}, { biohazard_cleaning_record: { primary_m2: null } }))[0], /missing: Measured m² for primary zone/)
  assert.deepEqual(problems(v2Job({ deposit_amount: 500 })), ['Enter the date the deposit was paid.'])
  assert.deepEqual(problems(v2Job({ manual_adjustment: 50 })), ['Enter the reason for the adjustment.'])
  assert.match(problems({ statement_of_accounts: {} } as unknown as AssessmentData)[0], /nothing to bill/)
  const content = statementV2Content(statementV2Figures(v2Job({ deposit_amount: 500 })), 'SOA-1', '1 Example Street')
  assert.throws(() => presentStatementV2(content), (err: unknown) => err instanceof StatementReconciliationError && /deposit was paid/.test(err.message))
  assert.match(statementHtml(content), /This statement could not be generated\.<\/strong> Enter the date the deposit was paid\./)
})

test('model 2 prints the summary, the estimates paragraph and the pay link', () => {
  const content = statementV2Content(
    statementV2Figures(v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02', invoice_number: 'INV-9', invoice_url: 'https://pay.example.com/inv-9?utm_source=x' })),
    'SOA-1',
    '1 Example Street',
  )
  assert.equal(content.model_version, 2)
  const html = statementHtml(content)
  assert.match(html, /The original estimates totalled/)
  assert.match(html, /Less deposit paid \(2 November 2026\)<\/td><td class="r">\(\$1,000\.00\)/)
  assert.match(html, /Balance owing<\/td><td class="r" style="font-weight:700">\$1,970\.00/)
  assert.match(html, /href="https:\/\/pay\.example\.com\/inv-9"/)
  assert.match(html, /How the balance is paid/)
  assert.match(html, /Invoice 1 INV-9 · estimate/)
  assert.equal(presentStatementV2(content).payLabel, null)
  assert.ok(cdrSummary(v2Job()).exists === false)
})

test('model 2 splits the balance into invoice 1 (estimate less deposit) and invoice 2 (actual less estimate)', () => {
  const f = statementV2Figures(v2Job({
    deposit_amount: 1000, deposit_date: '2026-11-02',
    invoice_number: 'INV-9', invoice_url: 'https://pay.example.com/inv-9',
    invoice2_number: 'INV-10', invoice2_url: 'https://pay.example.com/inv-10',
  }))
  const estimate = f.estimate_total ?? 0
  assert.ok(estimate > 0)
  const [one, two] = statementV2Invoices(f)
  assert.equal(one.heading, 'Invoice 1 INV-9 · estimate')
  assert.equal(one.amount, Math.round((estimate - 1000) * 100) / 100)
  assert.equal(Math.round((one.amount + two.amount) * 100) / 100, f.balance)
  const expected2 = Math.round((2970 - estimate) * 100) / 100
  assert.equal(two.amount, expected2)
  assert.equal(two.heading, `${expected2 < 0 ? 'Credit note' : 'Invoice 2'} INV-10 · adjustment to actual`)
  assert.equal(two.payHref, expected2 > 0 ? 'https://pay.example.com/inv-10' : null)

  const adjusted = statementV2Figures(v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02', manual_adjustment: -70, manual_adjustment_reason: 'goodwill' }))
  const split = statementV2Invoices(adjusted)
  assert.equal(Math.round(split.reduce((sum, inv) => sum + inv.amount, 0) * 100) / 100, adjusted.balance)
  assert.match(split[1].detail, /less goodwill \$70\.00 inc GST\.$/)
  assert.deepEqual(split[1].breakdown.at(-1), { label: 'Adjustment (goodwill)', actual_ex: null, estimate_ex: null, difference_ex: -63.64, gst: -6.36, difference_inc: -70 })

  assert.deepEqual(f.adjustment_lines?.map(line => line.label), ['Surface area cleaning (SACQ)', 'Biohazard cleaning (BCQ)'])
  const surfaceRow = two.breakdown[0]
  assert.equal(surfaceRow.actual_ex, 600)
  assert.equal(surfaceRow.difference_ex, Math.round((600 - surfaceAreaCaptureFigures(sacq).subtotal) * 100) / 100)
  assert.equal(surfaceRow.difference_inc, Math.round((surfaceRow.difference_ex + surfaceRow.gst) * 100) / 100)
  assert.equal(breakdownTotal(two).difference_inc, two.amount)
  assert.match(two.detail, / inc GST\.$/)

  const fixedOnly = statementV2Figures({ house_survey: { areas: [], labour_days: 1, rate_per_labour_day: 100 }, statement_of_accounts: {} } as unknown as AssessmentData)
  assert.deepEqual(statementV2Invoices(fixedOnly), [])
})

test('a model 2 statement issued before the invoice split prints as it did', () => {
  const content = statementV2Content(
    statementV2Figures(v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02', invoice_number: 'INV-9', invoice_url: 'https://pay.example.com/inv-9' })),
    'SOA-1',
    '1 Example Street',
  )
  const issued = { ...content, estimate_total: undefined, invoice2_number: undefined, invoice2_url: undefined }
  const view = presentStatementV2(issued)
  assert.deepEqual(view.invoices, [])
  assert.equal(view.payLabel, 'Pay $1,970.00 online')
  assert.equal(statementHtml(issued).includes('How the balance is paid'), false)
})

test('a model 1 capture in progress becomes model 2 inputs without losing its stored fields', () => {
  const v1 = { ...fixture(), model_version: undefined, invoice_number: undefined, invoice_url: undefined }
  const c = normalizeStatementCapture(v1)
  assert.equal(c.model_version, 2)
  assert.equal(c.deposit_amount, 8669.65)
  assert.equal(c.deposit_date, '2026-09-20')
  assert.equal(c.invoice_number, 'INV-0244')
  assert.equal(c.invoice_url, fixture().original_invoice_url)
  assert.equal(c.invoice1_amount, 17339.30)
  assert.equal(c.invoice2_amount, 6237.46)
  assert.equal(normalizeStatementCapture({ deposit_taken: false, deposit_amount: 500 }).deposit_amount, null)
  assert.equal(normalizeStatementCapture({ model_version: 2, deposit_amount: 500 }).deposit_amount, 500)
})

test('model 2: a left-out quote and its record are not billed or mentioned', () => {
  const f = statementV2Figures(v2Job({ ignored_quotes: ['surface'] }, { house_survey: undefined }))
  assert.deepEqual(f.problems, [])
  assert.deepEqual(f.lines, [{ label: 'Biohazard cleaning', amount_ex: 2100 }])
  assert.deepEqual(f.estimates.map(e => e.label), ['Biohazard cleaning'])
  assert.equal(f.suggested_deposit, 1210)
  assert.deepEqual(normalizeStatementCapture({ ignored_quotes: ['surface', 'surface', 'nope'] }).ignored_quotes, ['surface'])
  const html = statementHtml(statementV2Content(f, 'SOA-1', '1 Example Street'))
  assert.equal(/Surface/.test(html), false)
})

test('model 2: invoice 1 paid in full takes the whole estimate and says so', () => {
  const f = statementV2Figures(v2Job({ ignored_quotes: ['surface'], invoice1_paid_in_full: true, deposit_amount: 5, deposit_date: '2026-11-02', invoice_number: 'INV-9' }))
  assert.deepEqual(f.problems, [])
  assert.equal(f.deposit, 2420)
  assert.equal(f.suggested_deposit, null)
  assert.equal(f.balance, -110)
  assert.deepEqual(statementV2Rows(f).at(-2), { label: 'Less invoice 1 (INV-9) paid in full (2 November 2026)', amount: -2420 })
  const [invoice1] = statementV2Invoices(f)
  assert.equal(invoice1.amountLabel, 'Paid in full')
  assert.equal(invoice1.amountShown, 2420)
  assert.equal(invoice1.payHref, null)
  assert.match(invoice1.detail, /paid in full on 2 November 2026\.$/)
  assert.equal(statementReminderLines(f)[1].label, 'Less invoice 1 (INV-9) paid in full')
  const html = statementHtml(statementV2Content(f, 'SOA-1', '1 Example Street'))
  assert.match(html, /Paid in full \$2,420\.00/)
  assert.match(html, /paid in full up front/)
  assert.equal(/deposit/i.test(html.slice(html.indexOf('<body'))), false)
  assert.deepEqual(statementV2Figures(v2Job({ invoice1_paid_in_full: true })).problems, ['Enter the date invoice 1 was paid.'])
})

test('model 2: increases go on invoice 2 and decreases on a credit note, adding up to the difference', () => {
  const f = statementV2Figures(v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02', manual_adjustment: 220, manual_adjustment_reason: 'extra tip run', credit_note_number: 'CN-7' }))
  const { invoice2, credit_note, net } = statementV2Adjustments(f)
  assert.ok(invoice2 && credit_note)
  assert.deepEqual(invoice2.rows.map(row => row.label), ['Adjustment (extra tip run)'])
  assert.deepEqual(credit_note.rows.map(row => row.label), ['Surface area cleaning (SACQ)', 'Biohazard cleaning (BCQ)'])
  assert.ok(credit_note.amount < 0)
  assert.equal(Math.round((invoice2.amount + credit_note.amount) * 100) / 100, net)
  const invoices = statementV2Invoices(f)
  assert.deepEqual(invoices.map(inv => inv.kind), ['invoice1', 'invoice2', 'credit_note'])
  assert.match(invoices[2].heading, /^Credit note CN-7/)
  assert.equal(invoices[2].amountShown, -credit_note.amount)
  const docs = statementXeroDocs(f, DEFAULT_XERO_SETTINGS)
  assert.deepEqual(docs.map(doc => [doc.kind, doc.lines.length]), [['invoice2', 1], ['credit_note', 2]])
  assert.deepEqual(docs[0].lines[0], { Description: 'Adjustment (extra tip run). As per the Statement of Accounts.', Quantity: 1, UnitAmount: 200, AccountCode: '200', TaxType: 'OUTPUT' })
  assert.equal(docs[1].lines[1].Description, 'Biohazard cleaning (BCQ): estimate $2,200.00 less final $2,100.00 = $100.00 ex GST. As per the Statement of Accounts.')
  const referenced = statementXeroDocs(f, DEFAULT_XERO_SETTINGS, { statement: 'SOA-20261114-9207', quotes: { 'Biohazard cleaning (BCQ)': 'BCQ-20260929-9207' } })
  assert.equal(referenced[1].lines[1].Description, 'Biohazard cleaning (BCQ): estimate $2,200.00 less final $2,100.00 = $100.00 ex GST. Estimate from BCQ-20260929-9207. As per Statement of Accounts SOA-20261114-9207.')
  assert.equal(docs[1].lines[1].UnitAmount, 100)
})

test('model 2: all decreases make one credit note, and an older statement keeps its number in invoice 2', () => {
  const f = statementV2Figures(v2Job({ deposit_amount: 1000, deposit_date: '2026-11-02', invoice2_number: 'CN-OLD' }))
  const { invoice2, credit_note } = statementV2Adjustments(f)
  assert.equal(invoice2, null)
  assert.ok(credit_note)
  const last = statementV2Invoices(f).at(-1)
  assert.equal(last?.kind, 'credit_note')
  assert.match(last?.heading ?? '', /^Credit note CN-OLD/)
  assert.deepEqual(statementXeroDocs(f, DEFAULT_XERO_SETTINGS).map(doc => doc.kind), ['credit_note'])
})
