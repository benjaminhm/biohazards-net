import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssessmentData, Document, StatementOfAccountsContent } from '@/lib/types'
import { biohazardCleaningFigures, emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import {
  emptyStatementCapture,
  statementReferencePanel,
  presentStatementDocument,
  statementClientLines,
  statementFigures,
  statementPayHref,
  statementPhone,
  surveyDocumentCode,
  StatementReconciliationError,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'
import { statementDisposalSnapshot, statementSurveySnapshot } from '@/lib/statementSnapshot'
import { surveyPrice } from '@/lib/houseSurvey'
import { computeDisposalTotals, emptyDisposalLoad, emptyDisposalVehicle, mergedDisposalManifestCapture } from '@/lib/disposalManifest'
import { buildPrintHTML } from '@/lib/printDocument'

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

test('survey code falls back to the same code a survey document would get', () => {
  const on = new Date('2026-09-28T01:00:00.000Z')
  assert.equal(surveyDocumentCode('cfa2d3c7-5399-43bf-bd6b-0103768e1718', [], on), 'SUR-20260928-CFA2')
  assert.equal(surveyDocumentCode('cfa2d3c7-5399-43bf-bd6b-0103768e1718', [{
    id: '1',
    job_id: 'cfa2d3c7-5399-43bf-bd6b-0103768e1718',
    type: 'house_survey',
    content: { reference: 'SUR-20260924-CFA2' },
    file_url: null,
    created_at: '2026-09-24T00:00:00.000Z',
  }], on), 'SUR-20260924-CFA2')
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

test('the reference panel always shows BCQ, SACQ, and CCQ, empty until priced', () => {
  const panel = statementReferencePanel(null, [])
  assert.deepEqual(panel.quotes.map(block => block.heading), [
    'Biohazard cleaning (BCQ)',
    'Surface area cleaning (SACQ)',
    'Contents clearance (CCQ)',
  ])
  assert.deepEqual(panel.quotes.map(block => block.empty), ['No BCQ price yet.', 'No SACQ price yet.', 'No CCQ price yet.'])
  assert.ok(panel.quotes.every(block => block.lines.length === 0))
})

test('a priced BCQ shows its lines and total, with the saved quote reference', () => {
  const bcq = { ...emptyBiohazardCleaningCapture(), estimated_m2: 20, rate_per_m2: 50, labour_days: 2, rate_per_labour_day: 600 }
  const figures = biohazardCleaningFigures(bcq)
  const doc = { type: 'biohazard_cleaning_quote', created_at: '2026-11-01', content: { reference: 'BCQ-1' } } as unknown as Document
  const panel = statementReferencePanel({ biohazard_cleaning_quote: bcq } as unknown as AssessmentData, [doc])
  const block = panel.quotes.find(b => b.heading === 'Biohazard cleaning (BCQ)')!
  assert.equal(block.reference, 'BCQ-1')
  assert.equal(block.empty, null)
  assert.deepEqual(block.lines.find(line => line.label === 'Primary zone'), { label: 'Primary zone', quantity: '20 m²', ex: 1000, inc: 1100 })
  assert.deepEqual(block.lines.at(-1), { label: 'Total', ex: figures.subtotal, inc: figures.total, strong: true })
})

const snapshotSurveyAd = { house_survey: { areas: [], price_per_m2: 20 } } as unknown as AssessmentData

test('survey snapshot prices rooms like the survey and totals area and value', () => {
  const snap = statementSurveySnapshot([
    { label: 'Lounge', sqm: 12, total: null },
    { label: 'Kitchen', sqm: 8, total: 200 },
    { label: '', sqm: 4, total: null },
  ], snapshotSurveyAd, 'SUR-1')
  assert.ok(snap)
  const lounge = surveyPrice(12, 20)
  assert.deepEqual(snap.rooms.map(r => r.name), ['Lounge', 'Kitchen'])
  assert.deepEqual(snap.rooms[0], { name: 'Lounge', sqm: 12, rate_ex: 20, line_ex: lounge.ex, line_inc: lounge.inc })
  assert.equal(snap.rooms[1].line_inc, 200)
  assert.equal(snap.rooms[1].line_ex, 181.82)
  assert.equal(snap.rooms[1].rate_ex, 22.73)
  assert.equal(snap.total_sqm, 20)
  assert.equal(snap.subtotal_ex, Math.round(((lounge.ex ?? 0) + 181.82) * 100) / 100)
  assert.equal(snap.total_value_inc, Math.round(((lounge.inc ?? 0) + 200) * 100) / 100)
  assert.equal(snap.gst, Math.round(((snap.total_value_inc ?? 0) - (snap.subtotal_ex ?? 0)) * 100) / 100)
  assert.equal(statementSurveySnapshot([], snapshotSurveyAd, 'SUR-1'), null)
})

function snapshotDisposalAd(): AssessmentData {
  const skip = () => ({
    ...emptyDisposalLoad(),
    weight_kg: 400,
    vehicles: [{ ...emptyDisposalVehicle('skip'), length_m: 3, width_m: 2, height_m: 1, waste_sqm: 6, skip_cost: 0 }],
  })
  return {
    disposal_manifest_capture: {
      loads: [
        skip(),
        skip(),
        {
          ...emptyDisposalLoad(),
          distance_km: 22.5,
          vehicles: [
            { ...emptyDisposalVehicle('ute'), length_m: 2, width_m: 1.5, height_m: 1 },
            { ...emptyDisposalVehicle('trailer'), length_m: 2, width_m: 1.5, height_m: 1 },
          ],
        },
      ],
    },
  } as unknown as AssessmentData
}

test('disposal snapshot adds up loads, vehicles, distance, weight and volume', () => {
  const ad = snapshotDisposalAd()
  const loads = mergedDisposalManifestCapture(ad).loads
  const snap = statementDisposalSnapshot(ad, 'CDR-9', null)
  assert.ok(snap)
  assert.equal(snap.reference, 'CDR-9')
  assert.equal(snap.load_count, 3)
  assert.equal(snap.total_m3, computeDisposalTotals(loads).volume_m3)
  assert.deepEqual(snap.vehicles.map(v => [v.type, v.count]), [['skip', 2], ['ute', 1], ['trailer', 1]])
  assert.equal(snap.distance_km, 22.5)
  assert.equal(snap.weight_kg, 800)
  assert.equal(snap.invoiced_m3, null)
  assert.equal(statementDisposalSnapshot(ad, 'CDR-9', 99)?.invoiced_m3, 99)
  assert.equal(statementDisposalSnapshot({} as AssessmentData, '—', null), null)
})

function combinedContent(extra: Partial<StatementOfAccountsContent> = {}): StatementOfAccountsContent {
  return contentFor(fixture(), {
    survey_areas: [{ label: 'Lounge', sqm: 12, total: 264 }],
    invoice2_m3: 15,
    layout_version: 2,
    survey_snapshot: statementSurveySnapshot([{ label: 'Lounge', sqm: 12, total: 264 }], snapshotSurveyAd, 'SUR-1'),
    disposal_snapshot: statementDisposalSnapshot(snapshotDisposalAd(), 'CDR-9', 15),
    ...extra,
  })
}

function statementHtml(content: StatementOfAccountsContent): string {
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
