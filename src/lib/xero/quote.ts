/*
 * lib/xero/quote.ts
 *
 * Pure builder for a Fast Quote as a Xero quote. Kept free of I/O and of Node
 * modules, so it can be unit tested and the Fast Quote page can use its link.
 *
 * Everything the printed Fast Quote says is on the Xero quote, in its words:
 *   - Title: the quote's title.
 *   - Summary: the basis ("Site not inspected..."), the job address, the
 *     earliest start and the presentation.
 *   - Line 1: the fixed price, described by the scope of work.
 *   - Lines with a description only: inclusions, exclusions, assumptions, then
 *     the engagement agreement. Xero's Terms box holds 4,000 characters and the
 *     agreement alone is longer, so it goes on lines, which hold 4,000 each.
 *   - Terms: the payment terms, the authority and the acceptance.
 *
 * Nothing is shortened to fit. Text too long for a Xero box that cannot be
 * carried on is reported as a problem instead. The client's photos are not on
 * the Xero quote.
 */
import { INSTANT_QUOTE_SCHEMA, instantQuoteLines, type InstantQuoteContent } from '@/lib/instantQuote'
import type { XeroSettings } from '@/lib/xero/invoice'

/** The most characters Xero takes in a quote's title, its summary and one line's description. */
export const XERO_QUOTE_LIMITS = { title: 100, summary: 3000, description: 4000 } as const

export interface XeroQuoteLine {
  Description: string
  Quantity?: number
  UnitAmount?: number
  AccountCode?: string
  TaxType?: string
}

export interface XeroQuoteBody {
  QuoteID?: string
  Status: 'DRAFT'
  Contact: { ContactID: string }
  Date: string
  Reference: string
  Title: string
  Summary: string
  Terms: string
  LineAmountTypes: 'INCLUSIVE' | 'EXCLUSIVE'
  LineItems: XeroQuoteLine[]
}

/** A line too long for one description, cut at a space into pieces that fit. */
function pieces(line: string, max: number): string[] {
  const out: string[] = []
  let rest = line
  while (rest.length > max) {
    const space = rest.lastIndexOf(' ', max)
    const at = space > max / 2 ? space : max
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * A heading and its lines as descriptions that each fit one Xero line.
 * A section too long for one carries on in the next, headed "(continued)".
 */
export function sectionDescriptions(
  heading: string,
  lines: string[],
  opts: { bullet?: string; continued?: string; max?: number } = {},
): string[] {
  const bullet = opts.bullet ?? '• '
  const max = opts.max ?? XERO_QUOTE_LIMITS.description
  const continued = opts.continued ?? `${heading} (continued)`
  const room = Math.max(1, max - Math.max(heading.length, continued.length) - 1 - bullet.length)
  const out: string[] = []
  let current = heading
  let empty = true
  for (const line of lines.flatMap(l => pieces(l, room))) {
    const next = `${current}\n${bullet}${line}`
    if (next.length > max && !empty) {
      out.push(current)
      current = `${continued}\n${bullet}${line}`
    } else {
      current = next
    }
    empty = false
  }
  if (!empty) out.push(current)
  return out
}

/** What is printed in the box at the top of the Fast Quote, as Xero's summary. */
export function fastQuoteSummary(content: InstantQuoteContent): string {
  const hasPhotos = (content.photo_ids ?? []).length > 0
  const address = (content.job_address || content.site_address).trim()
  const head = [
    hasPhotos ? INSTANT_QUOTE_SCHEMA.basis.withPhotos : INSTANT_QUOTE_SCHEMA.basis.described,
    address ? `Job address: ${address}` : '',
    content.earliest_start ? `Earliest start: ${content.earliest_start}. ${INSTANT_QUOTE_SCHEMA.startNote}` : '',
  ].filter(Boolean).join('\n')
  return [head, content.presentation.trim()].filter(Boolean).join('\n\n')
}

export function fastQuoteTerms(content: InstantQuoteContent): string {
  return [
    ['Payment terms', content.terms],
    ['Authority', content.authority],
    ['Acceptance', content.acceptance],
  ]
    .filter(([, text]) => text.trim())
    .map(([heading, text]) => `${heading}\n${text.trim()}`)
    .join('\n\n')
}

export interface FastQuoteInput {
  content: InstantQuoteContent
  /** The engagement agreement as plain text, with its brackets already filled. */
  agreement: string
  /** True when the price staff typed already includes GST. */
  priceIncludesGst: boolean
  contactId: string
  settings: XeroSettings
  /** The quote's date, YYYY-MM-DD. */
  date: string
  /** The draft already in Xero, when this replaces its contents. */
  quoteId?: string
}

const AGREEMENT_HEADING = 'Engagement agreement'

/**
 * The quote as Xero takes it, always a draft.
 * A price typed including GST is sent as an inclusive line, so Xero's total is
 * the price typed to the cent. A price typed excluding GST is sent exclusive.
 */
export function fastQuoteBody(input: FastQuoteInput): XeroQuoteBody {
  const { content, settings } = input
  const title = content.title.trim() || 'Quote'
  const [priced = `${title}: the scope of work on this quote`, ...scopeMore] = sectionDescriptions(
    `${title}: the scope of work on this quote`,
    instantQuoteLines(content.scope_of_work),
    { continued: 'Scope of work (continued)' },
  )
  const agreementLines = instantQuoteLines(input.agreement)
  // The agreement usually opens with its own heading; it is not printed twice.
  if (agreementLines[0]?.toLowerCase() === AGREEMENT_HEADING.toLowerCase()) agreementLines.shift()
  const notes = [
    ...scopeMore,
    ...sectionDescriptions('Inclusions', content.inclusions),
    ...sectionDescriptions('Exclusions', content.exclusions),
    ...sectionDescriptions('Assumptions', content.assumptions),
    ...sectionDescriptions(AGREEMENT_HEADING.toUpperCase(), agreementLines, { bullet: '' }),
  ]
  return {
    ...(input.quoteId ? { QuoteID: input.quoteId } : {}),
    Status: 'DRAFT',
    Contact: { ContactID: input.contactId },
    Date: input.date,
    Reference: content.reference,
    Title: title,
    Summary: fastQuoteSummary(content),
    Terms: fastQuoteTerms(content),
    LineAmountTypes: input.priceIncludesGst ? 'INCLUSIVE' : 'EXCLUSIVE',
    LineItems: [
      {
        Description: priced,
        Quantity: 1,
        UnitAmount: input.priceIncludesGst ? content.total : content.subtotal,
        AccountCode: settings.account_code,
        TaxType: settings.gst_tax_type,
      },
      ...notes.map(Description => ({ Description })),
    ],
  }
}

/** Why Xero would refuse the quote. Empty when it fits. */
export function fastQuoteBodyProblems(body: XeroQuoteBody): string[] {
  const problems: string[] = []
  const over = (text: string, max: number) => text.length - max
  if (over(body.Title, XERO_QUOTE_LIMITS.title) > 0) {
    problems.push(`The title is ${over(body.Title, XERO_QUOTE_LIMITS.title)} characters too long for a Xero quote (${XERO_QUOTE_LIMITS.title} at most).`)
  }
  if (over(body.Summary, XERO_QUOTE_LIMITS.summary) > 0) {
    problems.push(`The presentation is ${over(body.Summary, XERO_QUOTE_LIMITS.summary)} characters too long for a Xero quote. Shorten it.`)
  }
  return problems
}

/** Where staff open a quote inside Xero to send it. They need to be signed in to Xero. */
export function xeroQuoteUrl(quoteId: string): string {
  return `https://go.xero.com/Accounts/Receivable/Quotes/View/${encodeURIComponent(quoteId.trim())}`
}
