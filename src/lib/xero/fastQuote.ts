/*
 * lib/xero/fastQuote.ts
 *
 * The saved Fast Quote raised in Xero as a draft quote, with its scope of work
 * and all its terms on it (lib/xero/quote.ts). Staff open it in Xero and press
 * Send there: Xero's API has no call that emails a quote, so the send itself
 * cannot be made from here.
 *
 *   - Not in Xero yet, or deleted there: create the draft.
 *   - Still a draft: replace its contents with the saved Fast Quote.
 *   - Sent, accepted, declined or invoiced in Xero: change nothing.
 *
 * The quote goes to the contact the job's invoice has, else the contact found
 * or made from the job's client. Its id, number and status are saved on the
 * Fast Quote. Every Xero write is logged to agent_actions.
 */
import { createHash } from 'node:crypto'
import type { createServiceClient } from '@/lib/supabase'
import type { CompanyProfile, Job } from '@/lib/types'
import { logAgentAction } from '@/lib/agentActions'
import { composeDocumentContent } from '@/lib/composeDocument'
import { normalizeContentsClearanceStandards } from '@/lib/contentsClearanceQuote'
import { formatAud } from '@/lib/disposalManifest'
import {
  instantQuoteProblems,
  normalizeInstantQuoteCapture,
  type InstantQuoteContent,
  type InstantQuoteXeroRef,
} from '@/lib/instantQuote'
import { fillInstantQuoteEngagement, sharedEngagementAgreement } from '@/lib/quoteEngagement'
import { proseToPlainText } from '@/lib/richTextPrint'
import { normalizeSurfaceAreaCleaningStandards } from '@/lib/surfaceAreaCleaningQuote'
import { applyTradingBrand, isTradingNameId } from '@/lib/tradingNames'
import { XeroApiError, loadXeroConnection, xeroConfigured, xeroRequest, type XeroConnection } from './client'
import { brisbaneDate, contactFromJob, xeroSettings } from './invoice'
import { fastQuoteBody, fastQuoteBodyProblems, xeroQuoteUrl, type XeroQuoteBody } from './quote'
import { findOrCreateContact } from './sync'

type Supabase = ReturnType<typeof createServiceClient>

export interface FastQuoteXeroResult {
  /** `left`: the quote is past draft in Xero, so it was not changed. */
  outcome: 'created' | 'updated' | 'left'
  number: string
  status: string
  /** The quote inside Xero, where staff send it. */
  url: string
  /** One sentence for staff. */
  note: string
}

export type RaiseFastQuoteResult =
  | { ok: true; result: FastQuoteXeroResult }
  | { ok: false; status: number; error: string }

interface XeroQuote {
  QuoteID?: string
  QuoteNumber?: string
  Status?: string
  Total?: number
  Contact?: { ContactID?: string }
}

const TRIGGER = 'fast_quote_raised' as const

/** The quote as Xero has it now. Null when Xero no longer has it. */
async function currentQuote(supabase: Supabase, conn: XeroConnection, quoteId: string): Promise<XeroQuote | null> {
  try {
    const res = await xeroRequest<{ Quotes?: XeroQuote[] }>(supabase, conn, 'GET', `/Quotes/${encodeURIComponent(quoteId)}`)
    const quote = res.Quotes?.[0]
    return quote?.QuoteID && quote.Status !== 'DELETED' ? quote : null
  } catch (err) {
    if (err instanceof XeroApiError && err.status === 404) return null
    throw err
  }
}

/** Written onto the latest saved Fast Quote, so nothing staff saved in the meantime is lost. */
async function saveOnFastQuote(supabase: Supabase, orgId: string, jobId: string, ref: InstantQuoteXeroRef) {
  const { data } = await supabase.from('jobs').select('assessment_data').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  const ad = (data?.assessment_data ?? {}) as Record<string, unknown>
  const capture = (ad.instant_quote && typeof ad.instant_quote === 'object' ? ad.instant_quote : {}) as Record<string, unknown>
  const { error } = await supabase
    .from('jobs')
    .update({ assessment_data: { ...ad, instant_quote: { ...capture, xero_quote: ref } }, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('org_id', orgId)
  if (error) throw new Error(`The quote is in Xero, but saving its number on the Fast Quote failed: ${error.message}`)
}

/** The same quote gives the same key, so a second press does not make a second quote in Xero. */
function bodyHash(body: XeroQuoteBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)
}

interface Layout {
  inclusive: boolean
  notesAtZero: boolean
  /** Waited before this try. */
  pauseMs?: number
}

/**
 * Xero answers some quotes with a 500 and no reason. The quote is then sent
 * again after a pause, because a contact made a moment ago may not have
 * reached Xero's quotes yet. If that fails too it is sent in the other layouts
 * that carry the same words and the same price: the price on an exclusive
 * line, and the lines after the price at $0.00 instead of description only.
 */
function layouts(priceIncludesGst: boolean): Layout[] {
  const first: Layout = { inclusive: priceIncludesGst, notesAtZero: false }
  return [
    first,
    { ...first, pauseMs: 3000 },
    ...(priceIncludesGst ? [{ inclusive: false, notesAtZero: false }] : []),
    { inclusive: priceIncludesGst, notesAtZero: true },
    ...(priceIncludesGst ? [{ inclusive: false, notesAtZero: true }] : []),
  ]
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function longDate(now: Date): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
}

/** Create or update the Fast Quote's draft in Xero from what is saved on the job. */
export async function raiseFastQuote(supabase: Supabase, orgId: string, jobId: string): Promise<RaiseFastQuoteResult> {
  const fail = (status: number, error: string): RaiseFastQuoteResult => ({ ok: false, status, error })

  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id, job_code, client_name, client_organization_name, client_email, client_phone, site_address, trading_name, assessment_data')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!job) return fail(404, 'Job not found')
  const saved = (job.assessment_data as { instant_quote?: unknown } | null)?.instant_quote
  if (saved == null) return fail(400, 'Save the Fast Quote first.')
  const capture = normalizeInstantQuoteCapture(saved)
  const problems = instantQuoteProblems(capture)
  if (problems.length) return fail(400, problems.join(' '))

  if (!xeroConfigured()) return fail(400, 'Xero is not set up for this app.')
  const conn = await loadXeroConnection(supabase, orgId)
  if (!conn) return fail(400, 'Xero is not connected. Connect it in Settings first.')

  const { data: profile } = await supabase.from('company_profile').select('*').eq('org_id', orgId).limit(1).maybeSingle()
  const company = applyTradingBrand(
    (profile as CompanyProfile | null) ?? null,
    isTradingNameId(job.trading_name) ? job.trading_name : null,
  )
  // The same agreement and the same content the printed Fast Quote is composed from.
  const content = composeDocumentContent('instant_quote', job as unknown as Job, {
    instantQuoteEngagement: sharedEngagementAgreement(
      normalizeContentsClearanceStandards(profile?.contents_clearance_standards).engagement_agreement,
      normalizeSurfaceAreaCleaningStandards(profile?.surface_area_cleaning_standards).engagement_agreement,
    ),
  }).content as unknown as InstantQuoteContent
  const now = new Date()
  const agreement = proseToPlainText(fillInstantQuoteEngagement(content, {
    companyName: company?.name,
    abn: company?.abn,
    phone: job.client_phone as string | null,
    email: job.client_email as string | null,
    date: longDate(now),
  }))

  const ctx = { orgId, jobId, trigger: TRIGGER }
  const log = (action: string, extra: Partial<Parameters<typeof logAgentAction>[1]>) =>
    logAgentAction(supabase, { org_id: orgId, job_id: jobId, agent: 'xero_sync', trigger: TRIGGER, action, target_table: 'xero:Quotes', ...extra })

  try {
    const current = capture.xero_quote ? await currentQuote(supabase, conn, capture.xero_quote.id) : null
    if (current?.QuoteID && current.Status !== 'DRAFT') {
      const status = current.Status ?? ''
      const number = current.QuoteNumber || capture.xero_quote?.number || ''
      await saveOnFastQuote(supabase, orgId, jobId, { id: current.QuoteID, number, status })
      return {
        ok: true,
        result: {
          outcome: 'left',
          number,
          status,
          url: xeroQuoteUrl(current.QuoteID),
          note: `Quote ${number} is ${status.toLowerCase()} in Xero, so it was not changed. Change it in Xero, or delete it there and press again to make a new one.`.replace(/\s+/g, ' '),
        },
      }
    }

    let contactId = current?.Contact?.ContactID ?? ''
    if (!contactId) {
      const { data: invoice } = await supabase.from('xero_job_invoices').select('xero_contact_id').eq('job_id', jobId).maybeSingle()
      contactId = (invoice as { xero_contact_id?: string | null } | null)?.xero_contact_id
        || await findOrCreateContact(supabase, conn, contactFromJob(job), ctx)
    }
    const base = {
      content,
      agreement,
      contactId,
      settings: xeroSettings(conn.settings),
      date: brisbaneDate(now),
      quoteId: current?.QuoteID,
    }
    const tooLong = fastQuoteBodyProblems(fastQuoteBody({ ...base, inclusive: capture.price_includes_gst }))
    if (tooLong.length) return fail(400, tooLong.join(' '))

    const tries = layouts(capture.price_includes_gst)
    // A new key each minute: a second press straight away makes no second quote, and a later one is a new request.
    const minute = Math.floor(now.getTime() / 60_000)
    let sent: { body: XeroQuoteBody; layout: Layout; quote: XeroQuote | undefined } | null = null
    let refused: XeroApiError | null = null
    for (const [attempt, layout] of tries.entries()) {
      const body = fastQuoteBody({ ...base, inclusive: layout.inclusive, notesAtZero: layout.notesAtZero })
      if (layout.pauseMs) await sleep(layout.pauseMs)
      try {
        const res = current?.QuoteID
          ? await xeroRequest<{ Quotes?: XeroQuote[] }>(supabase, conn, 'POST', `/Quotes/${encodeURIComponent(current.QuoteID)}`, { Quotes: [body] })
          : await xeroRequest<{ Quotes?: XeroQuote[] }>(
              supabase, conn, 'PUT', '/Quotes', { Quotes: [body] },
              { idempotencyKey: `fq-${jobId}-${capture.xero_quote?.id || 'new'}-${bodyHash(body)}-${attempt}-${minute}` },
            )
        sent = { body, layout, quote: res.Quotes?.[0] }
        break
      } catch (err) {
        // A refusal with a reason (a 400) is the answer; only a 500 with none is worth another layout.
        if (!(err instanceof XeroApiError) || err.status < 500) throw err
        refused = err
        await log('xero_quote_attempt_failed', { status: 'failed', after: { attempt, ...layout }, note: err.message.slice(0, 1000) })
      }
    }
    if (!sent) {
      throw new Error(`${refused?.message ?? 'Xero refused the quote'} Tried ${tries.length} times in ${new Set(tries.map(t => `${t.inclusive}${t.notesAtZero}`)).size} layouts; Xero gave no reason for any.`)
    }
    const { body, quote } = sent
    if (!quote?.QuoteID) throw new Error('Xero did not return the quote')
    const number = quote.QuoteNumber ?? ''
    const status = quote.Status ?? 'DRAFT'
    const outcome = current ? 'updated' : 'created'
    await log(`xero_quote_${outcome}`, {
      target_id: quote.QuoteID,
      after: body,
      note: `Draft quote ${number} ${outcome} in Xero from the Fast Quote ${content.reference}.`.replace(/\s+/g, ' '),
    })
    await saveOnFastQuote(supabase, orgId, jobId, { id: quote.QuoteID, number, status })
    const totalNote = typeof quote.Total === 'number' && Math.abs(quote.Total - content.total) >= 0.005
      ? ` Xero's total is ${formatAud(quote.Total)} against ${formatAud(content.total)} on the Fast Quote; check the GST rounding before you send it.`
      : ''
    const zeroNote = sent.layout.notesAtZero
      ? ' Xero refused lines that are only a description, so the inclusions, exclusions, assumptions and engagement agreement are lines at $0.00.'
      : ''
    return {
      ok: true,
      result: {
        outcome,
        number,
        status,
        url: xeroQuoteUrl(quote.QuoteID),
        note: `Draft quote ${number} ${outcome} in Xero. Open it there and press Send.${zeroNote}${totalNote}`.replace(/\s+/g, ' '),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[xero] fast quote failed', jobId, message)
    await log('xero_quote_failed', { status: 'failed', target_id: capture.xero_quote?.id ?? '', note: message.slice(0, 1000) })
    return fail(502, message)
  }
}
