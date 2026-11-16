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
 *
 * Xero answers some quotes with a 500 and no reason. When the whole quote is
 * refused, a quote with only the contact, the date and the price is made, and
 * the rest is put on it one part at a time, so the part Xero will not take is
 * found, tried in plainer forms, and named to staff if none is taken. Every
 * refusal is logged with what was sent.
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
import {
  FULL_FORM,
  QUOTE_PARTS,
  fastQuoteBody,
  fastQuoteBodyProblems,
  xeroQuoteUrl,
  type PartForm,
  type QuotePart,
  type XeroQuoteBody,
} from './quote'
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

type Forms = Partial<Record<QuotePart, PartForm>>

const ALL_FULL: Forms = Object.fromEntries(QUOTE_PARTS.map(part => [part, FULL_FORM]))

/** The forms a part is tried in, closest to the printed quote first. */
const TEXT_FORMS: PartForm[] = [FULL_FORM, { plain: true, max: FULL_FORM.max }]
const LINE_FORMS: PartForm[] = [
  FULL_FORM,
  { plain: true, max: FULL_FORM.max },
  { plain: false, max: 1900 },
  { plain: false, max: 900 },
  { plain: true, max: 900 },
]
const LINE_PARTS: QuotePart[] = ['scope', 'notes', 'agreement']

const PART_LABEL: Record<QuotePart, string> = {
  title: 'the title and reference',
  summary: 'the summary',
  terms: 'the payment terms, authority and acceptance',
  scope: 'the scope of work',
  notes: 'the inclusions, exclusions and assumptions',
  agreement: 'the engagement agreement',
}

/** How the quote with nothing but the contact, the date and the price is tried. */
interface Bare {
  coded: boolean
  typed: boolean
  /** False sends it without an idempotency key. */
  keyed: boolean
}
const BARE: Bare[] = [
  { coded: true, typed: true, keyed: true },
  { coded: false, typed: true, keyed: true },
  { coded: false, typed: false, keyed: true },
  { coded: true, typed: true, keyed: false },
]

/** Left for the route's 60 seconds once the parts are being put on. */
const PARTS_BUDGET_MS = 42_000

const sameForm = (a: PartForm, b: PartForm) => a.plain === b.plain && a.max === b.max

function listed(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

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

    const build = (parts: Forms, shape: { coded: boolean; typed: boolean }, quoteId = '') =>
      fastQuoteBody({ ...base, quoteId: quoteId || undefined, inclusive: capture.price_includes_gst, parts, ...shape })
    // A new key each minute: a second press straight away makes no second quote, and a later one is a new request.
    const minute = Math.floor(now.getTime() / 60_000)
    const key = (tag: string, body: XeroQuoteBody) => `fq-${jobId}-${tag}-${bodyHash(body)}-${minute}`
    const send = async (body: XeroQuoteBody, opts: { quoteId?: string; key?: string }) => {
      const res = opts.quoteId
        ? await xeroRequest<{ Quotes?: XeroQuote[] }>(supabase, conn, 'POST', `/Quotes/${encodeURIComponent(opts.quoteId)}`, { Quotes: [body] })
        : await xeroRequest<{ Quotes?: XeroQuote[] }>(supabase, conn, 'PUT', '/Quotes', { Quotes: [body] }, opts.key ? { idempotencyKey: opts.key } : {})
      const quote = res.Quotes?.[0]
      if (!quote?.QuoteID) throw new Error('Xero did not return the quote')
      return quote
    }
    let lastRefusal = ''
    const refused = new Set<string>()
    /** One send. A refusal is logged with what it was and null comes back; a sign-in or rate-limit refusal ends the press. */
    const attempt = async (step: string, detail: Record<string, unknown>, body: XeroQuoteBody, opts: { quoteId?: string; key?: string }) => {
      // Two forms of a part can come out the same; what Xero has refused is not sent again.
      const same = `${opts.quoteId ?? ''}:${Boolean(opts.key)}:${bodyHash(body)}`
      if (refused.has(same)) return null
      try {
        return await send(body, opts)
      } catch (err) {
        if (!(err instanceof XeroApiError) || [401, 403, 429].includes(err.status)) throw err
        refused.add(same)
        lastRefusal = err.message
        await log('xero_quote_attempt_failed', {
          status: 'failed',
          target_id: opts.quoteId ?? '',
          after: {
            step,
            ...detail,
            http: err.status,
            xero: err.body,
            lines: body.LineItems.map(line => line.Description.length),
            keyed: Boolean(opts.key),
          },
          note: err.message.slice(0, 1000),
        })
        return null
      }
    }

    const whole = build(ALL_FULL, { coded: true, typed: true }, current?.QuoteID)
    let quoteId = current?.QuoteID ?? ''
    let created = false
    let shape = { coded: true, typed: true }
    let forms: Forms = ALL_FULL
    let body = whole
    let quote = await attempt('whole', {}, whole, { quoteId, key: key('whole', whole) })

    if (!quote) {
      // Not in Xero yet: the quote with nothing on it but the contact, the date and the price.
      if (!quoteId) {
        for (const [index, bare] of BARE.entries()) {
          const bareBody = build({}, bare)
          quote = await attempt('bare', { ...bare }, bareBody, { key: bare.keyed ? key(`bare${index}`, bareBody) : undefined })
          if (quote) {
            shape = { coded: bare.coded, typed: bare.typed }
            body = bareBody
            break
          }
        }
        if (!quote) {
          let readable = 'Quotes can be read through this connection'
          try {
            await xeroRequest(supabase, conn, 'GET', '/Quotes?page=1')
          } catch (err) {
            readable = `Reading quotes through this connection fails too (${err instanceof Error ? err.message : String(err)})`
          }
          throw new Error(`${lastRefusal} Xero refused the whole quote, and then a quote with nothing on it but the contact, the date and the price. ${readable}.`)
        }
        quoteId = quote.QuoteID ?? ''
        created = true
        // Linked straight away, so the next press carries on with this quote whatever happens below.
        await saveOnFastQuote(supabase, orgId, jobId, { id: quoteId, number: quote.QuoteNumber ?? '', status: quote.Status ?? 'DRAFT' })
        await log('xero_quote_created', {
          target_id: quoteId,
          after: { ...body, shape } as unknown as Record<string, unknown>,
          note: `Draft quote ${quote.QuoteNumber ?? ''} created in Xero with the price only, after Xero refused the whole Fast Quote ${content.reference}. Its parts follow.`.replace(/\s+/g, ' '),
        })
      }

      // Then one part at a time, each in the first form Xero takes.
      forms = {}
      let lineForm = null as PartForm | null
      for (const part of QUOTE_PARTS) {
        if (Date.now() - now.getTime() > PARTS_BUDGET_MS) break
        const isLines = LINE_PARTS.includes(part)
        const tried: PartForm[] = isLines ? [FULL_FORM, ...(lineForm ? [lineForm] : []), ...LINE_FORMS] : TEXT_FORMS
        const candidates: PartForm[] = tried.filter((form, index) => tried.findIndex(other => sameForm(other, form)) === index)
        for (const form of candidates) {
          const next = build({ ...forms, [part]: form }, shape, quoteId)
          const taken = await attempt('part', { part, ...form }, next, { quoteId })
          if (taken) {
            forms = { ...forms, [part]: form }
            if (isLines) lineForm = form
            body = next
            quote = taken
            break
          }
        }
      }
      if (!quote) throw new Error(`${lastRefusal} Xero refused the whole quote, and then every part of it on its own.`)
    }

    const number = quote.QuoteNumber ?? capture.xero_quote?.number ?? ''
    const status = quote.Status ?? 'DRAFT'
    const outcome = current ? 'updated' : 'created'
    const missing = QUOTE_PARTS.filter(part => !forms[part])
    const plain = QUOTE_PARTS.filter(part => forms[part]?.plain)
    await log(created ? 'xero_quote_updated' : `xero_quote_${outcome}`, {
      target_id: quote.QuoteID ?? quoteId,
      after: { ...body, forms, shape, missing } as unknown as Record<string, unknown>,
      note: `Draft quote ${number} ${outcome} in Xero from the Fast Quote ${content.reference}.${missing.length ? ` Not on it: ${listed(missing.map(part => PART_LABEL[part]))}.` : ''}`.replace(/\s+/g, ' '),
    })
    await saveOnFastQuote(supabase, orgId, jobId, { id: quote.QuoteID ?? quoteId, number, status })
    const totalNote = typeof quote.Total === 'number' && Math.abs(quote.Total - content.total) >= 0.005
      ? ` Xero's total is ${formatAud(quote.Total)} against ${formatAud(content.total)} on the Fast Quote; check the GST before you send it.`
      : ''
    const missingNote = missing.length
      ? ` It is NOT complete. Not on it: ${listed(missing.map(part => PART_LABEL[part]))}. Do not send it as it is.`
      : ' Open it there and press Send.'
    const plainNote = plain.length
      ? ` Xero would not take the bullets, dashes or tick boxes in ${listed(plain.map(part => PART_LABEL[part]))}, so plain characters stand in for them there.`
      : ''
    const codedNote = shape.coded ? '' : ' Xero would not take the account code and tax rate on the price line; set them in Xero.'
    return {
      ok: true,
      result: {
        outcome,
        number,
        status,
        url: xeroQuoteUrl(quote.QuoteID ?? quoteId),
        note: `Draft quote ${number} ${outcome} in Xero.${missingNote}${plainNote}${codedNote}${totalNote}`.replace(/\s+/g, ' '),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[xero] fast quote failed', jobId, message)
    await log('xero_quote_failed', { status: 'failed', target_id: capture.xero_quote?.id ?? '', note: message.slice(0, 1000) })
    return fail(502, message)
  }
}
