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
  readableCaptures,
  readableDocumentTypes,
} from './registry'
import { DOC_AGENT_TYPES, type GenerateInputs } from './types'
import { DOC_AGENT_LABEL, draftedByLabel } from './labels'
import { buildReport, subAgentTools } from './runner'
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
    assert.equal(readableCaptures(def)[0], def.captureKey)
    assert.equal(readableDocumentTypes(def)[0], def.documentType)
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
    assert.equal(names.includes('read_calls'), def.extraReads.includes('calls'))
    assert.equal(names.includes('delegate_to_document_agent'), false)
    const patch = subAgentTools(def).find(t => t.name === 'draft_patch')!
    const changes = (patch.input_schema.properties as Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }>).changes
    const keyEnum = changes.items?.properties?.key.enum ?? []
    assert.deepEqual(keyEnum, [def.captureKey])
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
  const st = DOC_AGENTS.statement_of_accounts.generate(inputs({ statement_of_accounts: { invoice1_amount: 1000, invoice1_callout: 100 } }))
  assert.equal(st.ok, false)
  const good = DOC_AGENTS.statement_of_accounts.generate(inputs({ statement_of_accounts: { invoice1_amount: 1000, invoice1_callout: 200, invoice1_cleaning: 800 } }))
  assert.equal(good.ok, true)
})

test('per-document patch checks: statement shape, BCQ overrides, CDR photo links', () => {
  assert.match(DOC_AGENTS.statement_of_accounts.patchProblem?.({ made_up_field: 1 }) ?? '', /./)
  assert.equal(DOC_AGENTS.statement_of_accounts.patchProblem?.({ invoice1_amount: 1650 }) ?? null, null)
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
