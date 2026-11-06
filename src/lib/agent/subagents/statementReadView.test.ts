import '../testEnv'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentData } from '@/lib/types'
import { houseSurveyDocument } from '@/lib/houseSurvey'
import { houseSurveyWithQuote, quoteSurveyLink, surveyAreasFromQuoteRooms } from '@/lib/surveyQuoteLink'
import { disposalRecordSummary, loadHasContent, mergedDisposalManifestCapture, quoteDisposalLink } from '@/lib/disposalManifest'
import { agentView, canReadDocument, DOC_AGENTS, readableCaptures, readViewFor } from './registry'
import { directTools, inputsMessage, stateText, subAgentTools, type SubCtx } from './runner'
import { buildSnapshot, changesSince, snapshotHashes, type SnapshotRaw } from '../jobSnapshot'
import { cdrSummary, surveySummary } from '../recordSummaries'
import { statementAgentFigures, summaryDollarFigures } from '../statementDraft'
import { CAPTURE_KEYS } from '../patchDraft'
import { ToolError } from '../loop'
import type { DraftRow } from '../drafts'

const soa = DOC_AGENTS.statement_of_accounts
const sacq = {
  rate_per_m2: 12,
  exclude_ceiling: true,
  labour_days: 2,
  rate_per_labour_day: 500,
  mobilisation_fee: 150,
  rooms: [{ id: 'r1', name: 'Lounge', length_m: 5, width_m: 4, height_m: 2.4 }],
}
const ccq = { rate_per_m3: 85, maximum_man_days: 1, rate_per_labour_day: 600, mobilisation_fee: 100 }

function job(): AssessmentData {
  const areas = surveyAreasFromQuoteRooms(quoteSurveyLink({ surface_area_cleaning_quote: sacq } as unknown as AssessmentData)!)
  return {
    surface_area_cleaning_quote: sacq,
    contents_clearance_quote: ccq,
    house_survey: { areas, price_per_m2: null },
    disposal_manifest_capture: {
      loads: [
        { facility: 'SECRET-TIP', dump_fee: 180, vehicles: [{ type: 'trailer', length_m: 2, width_m: 1.5, height_m: 1 }] },
        { vehicles: [{ type: 'skip', length_m: 3, width_m: 2, height_m: 1, skip_cost: 4321 }] },
      ],
      cost_per_m3: 100,
      prepaid_m3: 2,
    },
    statement_of_accounts: { invoice1_amount: 1650, charges_gst: true },
    sow_capture: { objective: 'Clean the lounge' },
  } as unknown as AssessmentData
}

const RAW_ONLY = ['SECRET-TIP', 'skip_cost', 'prepaid_m3', 'dump_fee', '"legs"', '4321']

function assertNoRaw(value: unknown, where: string) {
  const s = JSON.stringify(value)
  for (const marker of RAW_ONLY) assert.ok(!s.includes(marker), `${where} leaks ${marker}`)
}

function draft(id: string, target_path: string): DraftRow {
  return { id, org_id: 'o', job_id: 'j', message_id: null, kind: 'document', target_path, before: null, proposed: { x: 1 }, summary: `draft ${id}`, status: 'pending', created_at: '2026-01-01T00:00:00Z' } as DraftRow
}

function raw(ad: AssessmentData): SnapshotRaw {
  return {
    job: { id: 'j', status: 'underway', updated_at: '2026-01-01T00:00:00Z', assessment_data: ad },
    documents: [
      { id: 'hs1', type: 'house_survey', content: { reference: 'HS-1', areas: [{ legs: [] }] }, created_at: '2026-01-02T00:00:00Z', released_to_portal_at: null },
      { id: 'wdm1', type: 'waste_disposal_manifest', content: { reference: 'WDM-1', facility: 'SECRET-TIP' }, created_at: '2026-01-02T00:00:00Z', released_to_portal_at: null },
      { id: 'q1', type: 'quote', content: { reference: 'Q-1', total: 1650 }, created_at: '2026-01-02T00:00:00Z', released_to_portal_at: null },
    ],
    photos: [], notes: [], calls: [], xero: null, flags: [], acceptances: [],
    drafts: [draft('d1', 'capture:house_survey'), draft('d2', 'doc:wdm1'), draft('d3', 'generate:waste_disposal_manifest'), draft('d4', 'capture:statement_of_accounts')],
  }
}

/** Fake Supabase that returns one job row or one document for any query. */
function ctxWith(row: Record<string, unknown>): SubCtx {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: row })
  return { def: soa, orgId: 'o', jobId: 'j', userId: 'u', drafts: [], reported: null, supabase: { from: () => chain } } as unknown as SubCtx
}

test('summaries are the same figures the survey and CDR summaries show', () => {
  const ad = job()
  const doc = houseSurveyDocument('', '', houseSurveyWithQuote(ad), quoteSurveyLink(ad)!.charges)
  const s = surveySummary(ad)
  assert.equal(s.exists, true)
  assert.equal(s.unit, 'm²')
  assert.equal(s.quantity, doc.totals.priced)
  assert.equal(s.rate_ex_gst, 12)
  assert.equal(s.line_amount_ex_gst, doc.summary!.quantity_ex)
  assert.equal(s.labour_days, 2)
  assert.equal(s.labour_amount_ex_gst, 1000)
  assert.equal(s.callout_fee_ex_gst, 150)
  assert.equal(s.total_inc_gst, doc.summary!.total_inc)

  const capture = mergedDisposalManifestCapture(ad)
  const record = disposalRecordSummary({ ...capture, loads: capture.loads.filter(loadHasContent) }, quoteDisposalLink(ad))
  const c = cdrSummary(ad)
  assert.equal(c.quantity, 9)
  assert.equal(c.unit, 'm³')
  assert.equal(c.rate_ex_gst, 100)
  assert.equal(c.line_amount_ex_gst, 900)
  assert.equal(c.labour_amount_ex_gst, 600)
  assert.equal(c.callout_fee_ex_gst, 100)
  assert.equal(c.total_ex_gst, 1600)
  assert.equal(c.gst, 160)
  assert.equal(c.total_inc_gst, 1760)
  assert.deepEqual([c.total_ex_gst, c.gst, c.total_inc_gst], [record.summary.total_ex, record.summary.gst, record.summary.total_inc])
})

test('a record not started yet is flagged, with no figures', () => {
  const ad = { surface_area_cleaning_quote: sacq, contents_clearance_quote: ccq } as unknown as AssessmentData
  for (const s of [surveySummary(ad), cdrSummary(ad)]) {
    assert.equal(s.exists, false)
    assert.equal(s.total_inc_gst, null)
    assert.equal(s.labour_amount_ex_gst, null)
  }
})

test('statement agent: raw survey and CDR captures and documents are unreadable; summaries replace them', () => {
  const keys = readableCaptures(soa)
  assert.ok(!keys.includes('house_survey') && !keys.includes('disposal_manifest_capture'))
  assert.ok(keys.includes('survey_summary') && keys.includes('cdr_summary'))
  for (const k of CAPTURE_KEYS) if (k !== 'house_survey' && k !== 'disposal_manifest_capture') assert.ok(keys.includes(k), k)
  assert.equal(canReadDocument(soa, 'house_survey'), false)
  assert.equal(canReadDocument(soa, 'waste_disposal_manifest'), false)
  for (const t of ['quote', 'contents_clearance_quote', 'statement_of_accounts', 'completion_report']) assert.ok(canReadDocument(soa, t), t)

  const ad = job()
  const view = agentView(soa, ad)
  assert.ok(!('house_survey' in view) && !('disposal_manifest_capture' in view))
  assert.deepEqual(view.survey_summary, surveySummary(ad))
  assert.deepEqual(view.cdr_summary, cdrSummary(ad))
  assert.deepEqual(view.statement_of_accounts, ad.statement_of_accounts)
  assert.deepEqual(view.contents_clearance_quote, ccq)
  assertNoRaw(view, 'agentView')
})

test('statement agent: per-turn context shows summaries, not the records', () => {
  const view = agentView(soa, job())
  const delegated = inputsMessage(soa, view, [], [], 'Draft the statement', '')
  const direct = stateText(soa, view, [], [])
  for (const text of [delegated, direct]) {
    assert.match(text, /survey_summary/)
    assert.match(text, /cdr_summary/)
    assert.match(text, /surface_area_cleaning_quote/)
    assertNoRaw(text, 'context')
  }
})

test('statement agent: snapshot, health and changes-since hide the records and drafts on them', () => {
  const ad = job()
  const snap = buildSnapshot(raw(ad), { role: 'admin', view: readViewFor(soa) })
  assert.ok(!('house_survey' in snap.captures) && !('disposal_manifest_capture' in snap.captures))
  assert.ok('survey_summary' in snap.captures && 'cdr_summary' in snap.captures)
  assert.ok('statement_of_accounts' in snap.captures && 'sow_capture' in snap.captures)
  assert.deepEqual(snap.documents.map(d => d.id), ['q1'])
  assert.deepEqual(snap.pending_drafts.map(d => d.id), ['d4'])
  assertNoRaw(snap, 'snapshot')

  const before = raw(ad)
  const changed = raw({ ...ad, house_survey: { ...(ad.house_survey as object), price_per_m2: 20 } } as AssessmentData)
  const diff = changesSince({ since: '2026-01-01T00:00:00Z', raw: changed, previous: snapshotHashes(before), role: 'admin', view: readViewFor(soa) })
  assert.deepEqual(Object.keys(diff.captures.changed), ['survey_summary'])
  assert.equal((diff.captures.changed.survey_summary as { rate_ex_gst: number }).rate_ex_gst, 20)
  assertNoRaw(diff, 'changes since')

  const coarse = changesSince({ since: '2025-12-01T00:00:00Z', raw: changed, previous: null, touchedCaptures: ['disposal_manifest_capture'], view: readViewFor(soa) })
  assert.deepEqual(Object.keys(coarse.captures.changed), ['cdr_summary'])
  assert.deepEqual(coarse.documents.added.map(d => (d as { id: string }).id), ['q1'])
  assertNoRaw(coarse, 'coarse changes since')
})

test('statement agent: read tools refuse the records and documents, and return summaries', async () => {
  const ad = job()
  for (const tools of [subAgentTools(soa), directTools(soa)]) {
    const readCapture = tools.find(t => t.name === 'read_capture')!
    const ctx = ctxWith({ assessment_data: ad })
    for (const key of ['house_survey', 'disposal_manifest_capture']) {
      await assert.rejects(readCapture.run(ctx, { key }), (err: unknown) => {
        assert.ok(err instanceof ToolError)
        assert.equal(JSON.parse(err.message).blocked_action, `read_capture:${key}`)
        return true
      })
    }
    const out = await readCapture.run(ctx, { key: 'cdr_summary' }) as { exists: boolean; content: unknown }
    assert.equal(out.exists, true)
    assert.deepEqual(out.content, cdrSummary(ad))
    const missing = await readCapture.run(ctxWith({ assessment_data: { statement_of_accounts: {} } }), { key: 'survey_summary' }) as { exists: boolean }
    assert.equal(missing.exists, false)

    const readDocument = tools.find(t => t.name === 'read_document')!
    for (const type of ['house_survey', 'waste_disposal_manifest']) {
      await assert.rejects(readDocument.run(ctxWith({ id: 'x', type, content: { facility: 'SECRET-TIP' } }), { document_id: 'x' }), ToolError)
    }
    const validate = tools.find(t => t.name === 'validate_patch')!
    const v = await validate.run(ctxWith({ id: 'x', type: 'waste_disposal_manifest', content: { facility: 'SECRET-TIP' } }), { document_id: 'x', patch: { a: 1 } })
    assert.equal((v as { ok: boolean }).ok, false)
    assertNoRaw(v, 'validate_patch')
  }
})

test('statement agent figures come from the summaries, never skip, tip, prepaid or waste charge', () => {
  const ad = job()
  const figures = statementAgentFigures(ad)
  assert.deepEqual(figures.survey_summary, surveySummary(ad))
  assert.deepEqual(figures.cdr_summary, cdrSummary(ad))
  assertNoRaw(figures, 'survey_and_cdr_figures')
  assert.deepEqual(summaryDollarFigures(ad).map(f => [f.statement_field, f.amount]), [
    ['invoice1_adjusted_amount', surveySummary(ad).total_inc_gst],
    ['invoice2_amount', 1760],
  ])
  const exGst = { ...ad, statement_of_accounts: { charges_gst: false } } as AssessmentData
  assert.deepEqual(summaryDollarFigures(exGst).map(f => f.amount), [surveySummary(ad).total_ex_gst, 1600])
  for (const f of summaryDollarFigures(ad)) assert.ok(!/skips|trailers|utes|tip_receipts|prepaid/.test(f.statement_field))
})

test('other agents keep their reads of the survey and CDR', () => {
  const ad = job()
  assert.equal(readViewFor(DOC_AGENTS.house_survey), null)
  assert.ok(readableCaptures(DOC_AGENTS.house_survey).includes('house_survey'))
  assert.ok(readableCaptures(DOC_AGENTS.waste_disposal_manifest).includes('disposal_manifest_capture'))
  assert.ok(readableCaptures(DOC_AGENTS.contents_clearance_quote).includes('disposal_manifest_capture'))
  assert.ok(canReadDocument(DOC_AGENTS.house_survey, 'house_survey'))
  assert.equal(agentView(DOC_AGENTS.completion_report, ad).disposal_manifest_capture, ad.disposal_manifest_capture)
  const fileAgent = buildSnapshot(raw(ad), { role: 'admin' })
  assert.ok('house_survey' in fileAgent.captures && 'disposal_manifest_capture' in fileAgent.captures)
  assert.equal(fileAgent.documents.length, 3)
  assert.equal(fileAgent.pending_drafts.length, 4)
})
