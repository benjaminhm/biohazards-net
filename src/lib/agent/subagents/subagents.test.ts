import '../testEnv'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Job } from '@/lib/types'
import {
  canDraftCapture,
  canDraftDocument,
  DOC_AGENTS,
  docAgentId,
  generateTarget,
  parseGenerateTarget,
  canReadDocument,
  readableCaptures,
  readableDocumentTypes,
  readsFullJob,
  extraReadsFor,
  ownCaptures,
} from './registry'
import { DOC_AGENT_TYPES, type GenerateInputs } from './types'
import { DOC_AGENT_LABEL, draftedByLabel } from './labels'
import { buildReport, directTools, preparePatches, subAgentTools, type SubCtx } from './runner'
import { CAPTURE_KEYS } from '../patchDraft'
import { ToolError } from '../loop'
import { jobHealth } from '../jobHealth'
import { staffOnlyBlock } from '../permissions'

function inputs(ad: Record<string, unknown> | null): GenerateInputs {
  return {
    job: { id: '11111111-2222-3333-4444-555555555555', site_address: '1 Test St', assessment_data: ad } as unknown as Job,
    documents: [], company: null, photos: [], progressNotes: [], progressRoomNotes: [],
  }
}

test('registry: one agent per document type, each with its own capture key and document type', () => {
  assert.deepEqual(Object.keys(DOC_AGENTS).sort(), [...DOC_AGENT_TYPES].sort())
  const keys = Object.values(DOC_AGENTS).map(d => d.captureKey)
  const docs = Object.values(DOC_AGENTS).map(d => d.documentType)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(new Set(docs).size, docs.length)
  for (const t of DOC_AGENT_TYPES) {
    const def = DOC_AGENTS[t]
    assert.equal(def.type, t)
    assert.equal(def.label, DOC_AGENT_LABEL[t].agent)
    assert.ok(readableCaptures(def).includes(def.captureKey))
    assert.ok(canReadDocument(def, def.documentType))
  }
})

test('registry: a sub-agent may draft only its own capture and its own document type', () => {
  for (const def of Object.values(DOC_AGENTS)) {
    assert.equal(canDraftCapture(def, def.captureKey), true)
    assert.equal(canDraftDocument(def, def.documentType), true)
    for (const other of Object.values(DOC_AGENTS)) {
      if (other === def) continue
      assert.equal(canDraftCapture(def, other.captureKey), false, `${def.type} must not draft ${other.captureKey}`)
      assert.equal(canDraftDocument(def, other.documentType), false, `${def.type} must not draft ${other.documentType}`)
    }
    assert.equal(canDraftCapture(def, 'sow_capture'), false)
  }
})

test('registry: generate targets round-trip; the old statement target still parses', () => {
  for (const t of DOC_AGENT_TYPES) assert.equal(parseGenerateTarget(generateTarget(t)), t)
  assert.equal(parseGenerateTarget('generate:statement_of_accounts'), 'statement_of_accounts')
  assert.equal(parseGenerateTarget('generate:nope'), null)
  assert.equal(parseGenerateTarget('capture:house_survey'), null)
  assert.equal(docAgentId('house_survey'), 'doc_agent:house_survey')
  assert.equal(draftedByLabel('doc_agent:statement_of_accounts'), 'File agent > Statement agent')
  assert.equal(draftedByLabel('file_agent'), null)
})

test('orchestrator: the file agent has no document write tools', async () => {
  const { FILE_TOOLS } = await import('../workspaceAgent')
  const names = FILE_TOOLS.map(t => t.name)
  for (const gone of ['draft_capture_patch', 'draft_document_patch', 'draft_statement', 'draft_generate_statement', 'draft_document']) {
    assert.equal(names.includes(gone), false, `${gone} must not be on the file agent`)
  }
  assert.ok(names.includes('delegate_to_document_agent'))
  assert.ok(names.includes('get_job_health'))
  for (const job of ['draft_field_changes', 'draft_note', 'draft_status', 'draft_photo_changes', 'draft_staff_flag', 'get_job_snapshot', 'get_job_changes_since']) assert.ok(names.includes(job))
  assert.equal(names.includes('get_job_file'), false)
})

test('sub-agent tools: own writes, generate and report; extra reads only when declared', () => {
  for (const def of Object.values(DOC_AGENTS)) {
    const names = subAgentTools(def).map(t => t.name)
    for (const n of ['read_capture', 'read_document', 'draft_patch', 'validate_patch', 'draft_document_patch', 'draft_generate', 'report']) assert.ok(names.includes(n))
    assert.equal(names.includes('read_calls'), extraReadsFor(def).includes('calls'))
    assert.equal(names.includes('delegate_to_document_agent'), false)
    const patch = subAgentTools(def).find(t => t.name === 'draft_patch')!
    const changes = (patch.input_schema.properties as Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }>).changes
    const keyEnum = changes.items?.properties?.key.enum ?? []
    assert.deepEqual(keyEnum, ownCaptures(def))
  }
})

test('per-document generate checks before compose', () => {
  assert.equal(DOC_AGENTS.surface_area_cleaning_quote.generate(inputs(null)).ok, false)
  assert.equal(DOC_AGENTS.surface_area_cleaning_quote.generate(inputs({ surface_area_cleaning_quote: { labour_days: 0 } })).ok, false)
  assert.equal(DOC_AGENTS.house_survey.generate(inputs({ house_survey: { areas: [] } })).ok, false)
  assert.equal(DOC_AGENTS.waste_disposal_manifest.generate(inputs({ disposal_manifest_capture: { loads: [] } })).ok, false)
  assert.equal(DOC_AGENTS.completion_report.generate(inputs(null)).ok, false)
  assert.equal(DOC_AGENTS.contents_clearance_quote.generate(inputs({ contents_clearance_quote: { maximum_man_days: 0 } })).ok, false)
  assert.equal(DOC_AGENTS.biohazard_cleaning_quote.generate(inputs({ biohazard_cleaning_quote: { labour_days: 0 } })).ok, false)
  const survey = { areas: [], labour_days: 1, rate_per_labour_day: 1000 }
  const st = DOC_AGENTS.statement_of_accounts.generate(inputs({ house_survey: survey, statement_of_accounts: { model_version: 2, manual_adjustment: 50 } }))
  assert.equal(st.ok, false)
  const good = DOC_AGENTS.statement_of_accounts.generate(inputs({ house_survey: survey, statement_of_accounts: { model_version: 2 } }))
  assert.equal(good.ok, true)
  assert.equal(DOC_AGENTS.house_survey.generate(inputs({ house_survey: { areas: [] }, biohazard_cleaning_record: { primary_m2: 4 } })).ok, true)
})

test('per-document patch checks: statement shape, BCQ overrides, CDR photo links', () => {
  assert.match(DOC_AGENTS.statement_of_accounts.patchProblem?.({ made_up_field: 1 }) ?? '', /./)
  assert.equal(DOC_AGENTS.statement_of_accounts.patchProblem?.({ deposit_amount: 1650, deposit_date: '2026-11-02' }) ?? null, null)
  assert.match(DOC_AGENTS.statement_of_accounts.patchProblem?.({ invoice1_amount: 1650 }) ?? '', /no input/)
  assert.match(DOC_AGENTS.biohazard_cleaning_quote.patchProblem?.({ check_override: ['x'] }) ?? '', /./)
})

test('report shape: drafts de-duplicated, staff needs and warnings carried', () => {
  const r = buildReport(
    DOC_AGENTS.statement_of_accounts,
    [{ id: 'a', summary: 'one' }, { id: 'a', summary: 'one again' }, { id: 'b', summary: 'generate' }],
    ['draft_patch: bad'],
    { summary: 'Filled quantities.', needs_from_staff: ['invoice 1 amount'], warnings: ['CDR weight has no field'] },
    '',
  )
  assert.deepEqual(Object.keys(r).sort(), ['agent', 'doc_type', 'drafts_created', 'errors', 'message', 'needs_from_staff', 'warnings'])
  assert.equal(r.doc_type, 'statement_of_accounts')
  assert.equal(r.agent, 'Statement agent')
  assert.deepEqual(r.drafts_created.map(d => d.id), ['a', 'b'])
  assert.deepEqual(r.needs_from_staff, ['invoice 1 amount'])
  assert.equal(r.message, 'Filled quantities.')
  assert.equal(buildReport(DOC_AGENTS.house_survey, [], [], null, '').message, 'Nothing drafted.')
})

test('job health: not generated, quote edited after acceptance, CDR vs CCQ estimate', () => {
  const issues = jobHealth({
    status: 'accepted',
    assessment: { house_survey: { areas: [] }, contents_clearance_quote: { estimated_m3: 10 } } as never,
    documents: [{ id: 'q1', type: 'contents_clearance_quote', content: { total: 1200, reference: 'CCQ-1' }, created_at: '2026-01-01' }],
    acceptances: [{ document_id: 'q1', quote_total: 1000, accepted_at: '2026-01-02' }],
  })
  const codes = issues.map(i => i.code)
  assert.ok(codes.includes('not_generated:house_survey'))
  assert.ok(codes.includes('quote_edited_after_acceptance:q1'))
  assert.ok(!codes.includes('not_generated:contents_clearance_quote'))
  assert.equal(issues.find(i => i.code === 'not_generated:house_survey')?.doc_agent, 'house_survey')
})

test('permission refusals are structured', () => {
  const b = staffOnlyBlock('send_email')
  assert.deepEqual(Object.keys(b).sort(), ['blocked_action', 'handled_by', 'message', 'required_permission'])
  assert.equal(b.blocked_action, 'send_email')
  assert.match(staffOnlyBlock('fax_client').message, /not available to agents/)
})

const FULL_READS = ['get_job_snapshot', 'get_job_changes_since', 'get_job_health', 'list_job_documents', 'read_capture', 'read_document', 'read_calls', 'read_progress_notes', 'read_photos', 'read_xero_invoice', 'read_acceptances']

test('statement agent reads the whole job file in delegated and direct modes', () => {
  const def = DOC_AGENTS.statement_of_accounts
  assert.equal(readsFullJob(def), true)
  const summarised = ['house_survey', 'disposal_manifest_capture', 'biohazard_cleaning_record']
  assert.deepEqual([...readableCaptures(def)].sort(), [...CAPTURE_KEYS.filter(k => !summarised.includes(k)), 'survey_summary', 'cdr_summary', 'bcq_record_summary'].sort())
  assert.equal(readableDocumentTypes(def), null)
  for (const t of ['quote', 'report', 'swms', 'completion_report', 'authority_to_proceed']) assert.ok(canReadDocument(def, t), t)
  for (const tools of [subAgentTools(def), directTools(def)]) {
    const names = tools.map(t => t.name)
    for (const n of FULL_READS) assert.ok(names.includes(n), `statement agent has ${n}`)
    const readCapture = tools.find(t => t.name === 'read_capture')
    const keys = (readCapture?.input_schema.properties as { key: { enum: string[] } }).key.enum
    assert.ok(keys.includes('sow_capture') && keys.includes('completion_report_capture'))
  }
})

test('statement agent still drafts only its own capture and document', async () => {
  const def = DOC_AGENTS.statement_of_accounts
  assert.throws(() => preparePatches(def, {}, [{ key: 'house_survey', patch: { price_per_m2: 20 } }]), (err: unknown) => {
    assert.ok(err instanceof ToolError)
    const body = JSON.parse(err.message)
    assert.equal(body.blocked_action, 'draft_patch:house_survey')
    assert.equal(body.handled_by, 'Survey agent')
    return true
  })
  assert.throws(() => preparePatches(def, {}, [{ key: 'sow_capture', patch: { a: 1 } }]), ToolError)
  for (const other of Object.values(DOC_AGENTS)) {
    if (other === def) continue
    assert.equal(canDraftCapture(def, other.captureKey), false)
    assert.equal(canDraftDocument(def, other.documentType), false)
  }
  const draftTool = subAgentTools(def).find(t => t.name === 'draft_patch')
  const keyEnum = ((draftTool?.input_schema.properties as { changes: { items: { properties: { key: { enum: string[] } } } } }).changes.items.properties.key.enum)
  assert.deepEqual(keyEnum, ['statement_of_accounts'])
  const docPatch = subAgentTools(def).find(t => t.name === 'draft_document_patch')
  const ctx = {
    def, orgId: 'o', jobId: 'j', drafts: [], reported: null,
    supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'd1', type: 'house_survey', content: {} } }) }) }) }) }) }) },
  } as unknown as SubCtx
  await assert.rejects(docPatch!.run(ctx, { document_id: 'd1', patch: { title: 'x' } }), (err: unknown) => {
    assert.ok(err instanceof ToolError)
    assert.equal(JSON.parse(err.message).blocked_action, 'draft_document_patch:house_survey')
    return true
  })
})

test('the other six document agents keep their scoped reads', () => {
  for (const def of Object.values(DOC_AGENTS)) {
    if (def.type === 'statement_of_accounts') continue
    assert.equal(readsFullJob(def), false, def.type)
    assert.deepEqual(readableCaptures(def), [...ownCaptures(def), ...def.readCaptures])
    assert.deepEqual(readableDocumentTypes(def), [def.documentType, ...def.readDocumentTypes])
    const names = subAgentTools(def).map(t => t.name)
    for (const n of ['get_job_snapshot', 'get_job_changes_since', 'get_job_health', 'list_job_documents']) assert.ok(!names.includes(n), `${def.type} must not have ${n}`)
  }
})
