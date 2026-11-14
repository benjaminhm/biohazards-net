/*
 * lib/xero/statementDocs.ts
 *
 * Invoice 2 and the credit note from the Statement of Accounts, raised in Xero
 * as drafts with one click. Invoice 2 carries the quotes that came in higher
 * than the estimate, the credit note the ones that came in lower
 * (statementV2Adjustments). Staff approve and send them from Xero, and
 * allocate the credit note against invoice 1 there.
 *
 *   - Not in Xero yet: create the draft for invoice 1's contact.
 *   - Still a draft: replace its lines with the statement's.
 *   - Approved in Xero: change nothing; pick up invoice 2's pay link.
 *   - Voided or deleted in Xero: create a new draft.
 *
 * The numbers, ids and statuses are saved on the statement. Every Xero write
 * is logged to agent_actions.
 */
import type { createServiceClient } from '@/lib/supabase'
import type { AssessmentData } from '@/lib/types'
import { logAgentAction } from '@/lib/agentActions'
import { formatAud } from '@/lib/disposalManifest'
import {
  normalizeStatementCapture,
  statementV2Adjustments,
  statementV2Figures,
  type StatementOfAccountsCapture,
  type StatementV2Figures,
} from '@/lib/statementOfAccounts'
import { loadXeroConnection, xeroConfigured, xeroRequest, type XeroConnection } from './client'
import { brisbaneDate, contactFromJob, linesHash, xeroSettings, type XeroLine, type XeroSettings } from './invoice'
import { xeroPayUrl } from './payments'
import { findOrCreateContact } from './sync'

type Supabase = ReturnType<typeof createServiceClient>

export type StatementDocKind = 'invoice2' | 'credit_note'

export interface StatementXeroDoc {
  kind: StatementDocKind
  /** What the statement bills on it, inc GST when the job charges GST. Positive on both. */
  amount: number
  lines: XeroLine[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Ex GST lines for Xero, one per quote that moved, then any adjustment. */
export function statementXeroDocs(f: StatementV2Figures, settings: XeroSettings): StatementXeroDoc[] {
  const { invoice2, credit_note } = statementV2Adjustments(f)
  const taxType = f.charges_gst ? settings.gst_tax_type : settings.no_gst_tax_type
  const build = (kind: StatementDocKind, part: NonNullable<typeof invoice2>): StatementXeroDoc => ({
    kind,
    amount: Math.abs(part.amount),
    lines: part.rows.filter(row => Math.abs(row.difference_ex) > 0.004).map(row => ({
      Description: row.actual_ex == null || row.estimate_ex == null
        ? row.label
        : `${row.label}: final ${formatAud(row.actual_ex)}, estimate ${formatAud(row.estimate_ex)} (ex GST)`,
      Quantity: 1,
      UnitAmount: round2(Math.abs(row.difference_ex)),
      AccountCode: settings.account_code,
      TaxType: taxType,
    })),
  })
  return [
    ...(invoice2 ? [build('invoice2', invoice2)] : []),
    ...(credit_note ? [build('credit_note', credit_note)] : []),
  ]
}

export type StatementDocOutcome = 'created' | 'updated' | 'approved' | 'not_needed'

export interface StatementDocResult {
  kind: StatementDocKind
  outcome: StatementDocOutcome
  number: string
  status: string
  /** One sentence for staff. */
  note: string
}

interface XeroDocBody {
  id: string
  number: string
  status: string
  total: number | null
}

const NAMES: Record<StatementDocKind, string> = { invoice2: 'Invoice 2', credit_note: 'Credit note' }

const FIELDS = {
  invoice2: { id: 'xero_invoice2_id', status: 'xero_invoice2_status', number: 'invoice2_number' },
  credit_note: { id: 'xero_credit_note_id', status: 'xero_credit_note_status', number: 'credit_note_number' },
} as const

function fromXero(kind: StatementDocKind, raw: Record<string, unknown> | undefined): XeroDocBody | null {
  if (!raw) return null
  const id = raw[kind === 'invoice2' ? 'InvoiceID' : 'CreditNoteID']
  if (typeof id !== 'string' || !id) return null
  const number = raw[kind === 'invoice2' ? 'InvoiceNumber' : 'CreditNoteNumber']
  return {
    id,
    number: typeof number === 'string' ? number : '',
    status: typeof raw.Status === 'string' ? raw.Status : '',
    total: typeof raw.Total === 'number' ? raw.Total : null,
  }
}

async function xeroDoc(supabase: Supabase, conn: XeroConnection, kind: StatementDocKind, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<XeroDocBody | null> {
  const key = kind === 'invoice2' ? 'Invoices' : 'CreditNotes'
  const res = await xeroRequest<Record<string, Record<string, unknown>[] | undefined>>(supabase, conn, method, path, body, { idempotencyKey })
  return fromXero(kind, res[key]?.[0])
}

function totalNote(doc: XeroDocBody | null, amount: number): string {
  if (doc?.total == null || Math.abs(doc.total - amount) < 0.015) return ''
  return ` Xero's total is ${formatAud(doc.total)} against ${formatAud(amount)} on the statement; check the GST rounding.`
}

export type RaiseStatementResult =
  | { ok: true; results: StatementDocResult[] }
  | { ok: false; status: number; error: string; results: StatementDocResult[] }

/** Create or update the statement's drafts in Xero, and save what Xero returns on the statement. */
export async function raiseStatementDocs(supabase: Supabase, orgId: string, jobId: string): Promise<RaiseStatementResult> {
  const results: StatementDocResult[] = []
  const fail = (status: number, error: string): RaiseStatementResult => ({ ok: false, status, error, results })

  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id, job_code, client_name, client_organization_name, client_email, client_phone, assessment_data')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!job) return fail(404, 'Job not found')
  const ad = (job.assessment_data ?? null) as AssessmentData | null
  const capture = normalizeStatementCapture(ad?.statement_of_accounts)
  const figures = statementV2Figures(ad, capture)
  if (figures.problems.length > 0) return fail(400, figures.problems[0])

  if (!xeroConfigured()) return fail(400, 'Xero is not set up for this app.')
  const conn = await loadXeroConnection(supabase, orgId)
  if (!conn) return fail(400, 'Xero is not connected. Connect it in Settings first.')
  const settings = xeroSettings(conn.settings)
  const docs = statementXeroDocs(figures, settings)
  if (docs.length === 0 && !capture.xero_invoice2_id && !capture.xero_credit_note_id) {
    return fail(400, 'There is nothing to raise: the final figures match the estimate.')
  }

  const reference = (job.job_code as string | null)?.trim() || jobId.slice(0, 8)
  const trigger = 'statement_raised' as const
  let contactId: string | null = null
  const contact = async () => {
    if (contactId) return contactId
    const { data: row } = await supabase.from('xero_job_invoices').select('xero_contact_id').eq('job_id', jobId).maybeSingle()
    const known = (row as { xero_contact_id?: string | null } | null)?.xero_contact_id
    contactId = known || await findOrCreateContact(supabase, conn, contactFromJob(job), { orgId, jobId, trigger })
    return contactId
  }
  const patch: Partial<StatementOfAccountsCapture> = {}
  const log = (action: string, kind: StatementDocKind, extra: Partial<Parameters<typeof logAgentAction>[1]>) =>
    logAgentAction(supabase, {
      org_id: orgId,
      job_id: jobId,
      agent: 'xero_sync',
      trigger,
      action,
      target_table: kind === 'invoice2' ? 'xero:Invoices' : 'xero:CreditNotes',
      ...extra,
    })

  try {
    for (const kind of ['invoice2', 'credit_note'] as const) {
      const doc = docs.find(d => d.kind === kind) ?? null
      const fields = FIELDS[kind]
      const name = NAMES[kind]
      const path = kind === 'invoice2' ? '/Invoices' : '/CreditNotes'
      const listKey = kind === 'invoice2' ? 'Invoices' : 'CreditNotes'
      const idKey = kind === 'invoice2' ? 'InvoiceID' : 'CreditNoteID'
      const savedId = capture[fields.id]
      let current = savedId ? await xeroDoc(supabase, conn, kind, 'GET', `${path}/${encodeURIComponent(savedId)}`) : null
      if (current && (current.status === 'VOIDED' || current.status === 'DELETED')) current = null

      if (current && current.status !== 'DRAFT') {
        Object.assign(patch, { [fields.id]: current.id, [fields.status]: current.status, [fields.number]: current.number || capture[fields.number] })
        let note = `${name} ${current.number} is ${current.status.toLowerCase()} in Xero, so it was not changed.`
        if (doc && current.total != null && Math.abs(current.total - doc.amount) >= 0.015) {
          note += ` Xero has ${formatAud(current.total)} and the statement now has ${formatAud(doc.amount)}; change it in Xero if the statement is right.`
        } else if (!doc) note += ' The statement no longer needs it; void it in Xero if that is right.'
        if (kind === 'invoice2' && current.status === 'AUTHORISED' && !capture.invoice2_url) {
          const online = await xeroRequest<{ OnlineInvoices?: { OnlineInvoiceUrl?: string }[] }>(
            supabase, conn, 'GET', `/Invoices/${encodeURIComponent(current.id)}/OnlineInvoice`,
          )
          const url = xeroPayUrl(online.OnlineInvoices?.[0]?.OnlineInvoiceUrl)
          if (url) {
            patch.invoice2_url = url
            note += ' Its pay link was added to the statement.'
          }
        }
        results.push({ kind, outcome: 'approved', number: current.number, status: current.status, note })
        continue
      }

      if (!doc) {
        if (current) {
          Object.assign(patch, { [fields.status]: current.status })
          results.push({ kind, outcome: 'not_needed', number: current.number, status: current.status, note: `Draft ${name.toLowerCase()} ${current.number} is no longer needed by the statement; delete it in Xero.` })
        }
        continue
      }

      if (current) {
        const updated = await xeroDoc(supabase, conn, kind, 'POST', `${path}/${encodeURIComponent(current.id)}`, {
          [listKey]: [{ [idKey]: current.id, LineAmountTypes: 'Exclusive', LineItems: doc.lines }],
        }) ?? current
        Object.assign(patch, { [fields.id]: updated.id, [fields.status]: updated.status, [fields.number]: updated.number || current.number })
        await log(`xero_${kind}_updated`, kind, { target_id: updated.id, after: doc.lines, note: `Draft ${name.toLowerCase()} ${updated.number} updated from the Statement of Accounts for ${reference}.` })
        results.push({ kind, outcome: 'updated', number: updated.number, status: updated.status, note: `Draft ${name.toLowerCase()} ${updated.number} updated in Xero.${totalNote(updated, doc.amount)}` })
        continue
      }

      const now = new Date()
      const body = {
        Type: kind === 'invoice2' ? 'ACCREC' : 'ACCRECCREDIT',
        Status: 'DRAFT',
        Contact: { ContactID: await contact() },
        Reference: reference,
        Date: brisbaneDate(now),
        ...(kind === 'invoice2' ? { DueDate: brisbaneDate(now, settings.due_days) } : {}),
        LineAmountTypes: 'Exclusive',
        LineItems: doc.lines,
      }
      const created = await xeroDoc(supabase, conn, kind, 'PUT', path, { [listKey]: [body] }, `soa-${kind}-${jobId}-${savedId || 'new'}-${linesHash(doc.lines)}`)
      if (!created) throw new Error(`Xero did not return the new ${name.toLowerCase()}`)
      Object.assign(patch, { [fields.id]: created.id, [fields.status]: created.status, [fields.number]: created.number })
      if (kind === 'invoice2') patch.invoice2_url = ''
      await log(`xero_${kind}_created`, kind, { target_id: created.id, after: body, note: `Draft ${name.toLowerCase()} ${created.number} created from the Statement of Accounts for ${reference}.` })
      results.push({ kind, outcome: 'created', number: created.number, status: created.status, note: `Draft ${name.toLowerCase()} ${created.number} created in Xero.${totalNote(created, doc.amount)}` })
    }
    return { ok: true, results }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logAgentAction(supabase, { org_id: orgId, job_id: jobId, agent: 'xero_sync', trigger, action: 'xero_statement_failed', status: 'failed', note: message })
    return fail(502, message)
  } finally {
    if (Object.keys(patch).length > 0) await saveOnStatement(supabase, orgId, jobId, patch)
  }
}

/** Written onto the latest saved statement, so nothing staff saved in the meantime is lost. */
async function saveOnStatement(supabase: Supabase, orgId: string, jobId: string, patch: Partial<StatementOfAccountsCapture>) {
  const { data } = await supabase.from('jobs').select('assessment_data').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  const ad = ((data?.assessment_data ?? {}) as Record<string, unknown>)
  const statement = (ad.statement_of_accounts && typeof ad.statement_of_accounts === 'object' ? ad.statement_of_accounts : {}) as Record<string, unknown>
  const { error } = await supabase
    .from('jobs')
    .update({ assessment_data: { ...ad, statement_of_accounts: { ...statement, ...patch } }, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('org_id', orgId)
  if (error) console.error('[xero] saving statement documents failed', jobId, error.message)
}
