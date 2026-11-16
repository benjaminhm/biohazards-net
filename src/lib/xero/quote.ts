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
 *
 * Xero refuses some quotes with a 500 and no reason, so the quote can also be
 * built from a chosen set of parts, each in its own characters or plain ones
 * and with shorter lines (lib/xero/fastQuote.ts puts it on part by part).
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
  Status?: 'DRAFT'
  Contact: { ContactID: string }
  Date: string
  Reference?: string
  Title?: string
  Summary?: string
  Terms?: string
  LineAmountTypes?: 'INCLUSIVE' | 'EXCLUSIVE'
  LineItems: XeroQuoteLine[]
}

/** The parts of a Fast Quote that go on a Xero quote besides the contact, the date and the price. */
export const QUOTE_PARTS = ['title', 'summary', 'terms', 'scope', 'notes', 'agreement'] as const
export type QuotePart = typeof QUOTE_PARTS[number]

/** How one part is written: with its own characters or plain ones, and how long one line's description may be. */
export interface PartForm {
  plain: boolean
  max: number
}

export const FULL_FORM: PartForm = { plain: false, max: XERO_QUOTE_LIMITS.description }

const PLAIN_CHARACTERS: [RegExp, string][] = [
  [/[\u2022\u2023\u25E6\u2043\u2219\u00B7]/g, '-'],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/[\u2018\u2019\u201A\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/\u2026/g, '...'],
  [/\u2610/g, '[ ]'],
  [/[\u2611\u2612\u2713\u2714]/g, '[x]'],
  [/[\u00A0\u2000-\u200A\u202F\t]/g, ' '],
  [/[\u200B-\u200D\uFEFF\r]/g, ''],
  [/\u00D7/g, 'x'],
]

/**
 * The text in keyboard characters only: bullets and dashes as hyphens, curly
 * quotes straight, tick boxes as [ ], accents dropped. Any other character
 * becomes a question mark.
 */
export function plainText(text: string): string {
  let out = text
  for (const [from, to] of PLAIN_CHARACTERS) out = out.replace(from, to)
  return out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\n\x20-\x7E]/g, '?')
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
  /**
   * True sends the price including GST on an inclusive line, so Xero's total is
   * the price typed to the cent. False sends the ex-GST amount on an exclusive line.
   */
  inclusive: boolean
  /**
   * The parts to put on, and how each is written. Left out, every part goes on
   * in its own characters. A part not named is left off the quote.
   */
  parts?: Partial<Record<QuotePart, PartForm>>
  /** False leaves the account code and tax type off the price line. */
  coded?: boolean
  /**
   * False leaves out the draft status and the line amount type. Xero then reads
   * the price as excluding GST, so the ex-GST amount is sent.
   */
  typed?: boolean
  contactId: string
  settings: XeroSettings
  /** The quote's date, YYYY-MM-DD. */
  date: string
  /** The draft already in Xero, when this replaces its contents. */
  quoteId?: string
}

const AGREEMENT_HEADING = 'Engagement agreement'

const ALL_PARTS: Record<QuotePart, PartForm> = {
  title: FULL_FORM, summary: FULL_FORM, terms: FULL_FORM, scope: FULL_FORM, notes: FULL_FORM, agreement: FULL_FORM,
}

/** The quote as Xero takes it, always a draft. */
export function fastQuoteBody(input: FastQuoteInput): XeroQuoteBody {
  const { content, settings } = input
  const parts = input.parts ?? ALL_PARTS
  const typed = input.typed ?? true
  const inclusive = typed && input.inclusive
  const write = (form: PartForm, text: string) => (form.plain ? plainText(text) : text)
  const section = (form: PartForm, heading: string, lines: string[], opts: { bullet?: string; continued?: string } = {}) =>
    sectionDescriptions(write(form, heading), lines.map(line => write(form, line)), {
      ...opts,
      bullet: opts.bullet ?? (form.plain ? '- ' : '• '),
      max: form.max,
    })

  const title = content.title.trim() || 'Quote'
  // Without the scope part the price line is described by the title alone.
  const [priced = plainText(title), ...scopeMore] = parts.scope
    ? section(parts.scope, `${title}: the scope of work on this quote`, instantQuoteLines(content.scope_of_work), { continued: 'Scope of work (continued)' })
    : []
  const agreementLines = instantQuoteLines(input.agreement)
  // The agreement usually opens with its own heading; it is not printed twice.
  if (agreementLines[0]?.toLowerCase() === AGREEMENT_HEADING.toLowerCase()) agreementLines.shift()
  const after = [
    ...scopeMore,
    ...(parts.notes
      ? [
          ...section(parts.notes, 'Inclusions', content.inclusions),
          ...section(parts.notes, 'Exclusions', content.exclusions),
          ...section(parts.notes, 'Assumptions', content.assumptions),
        ]
      : []),
    ...(parts.agreement ? section(parts.agreement, AGREEMENT_HEADING.toUpperCase(), agreementLines, { bullet: '' }) : []),
  ]
  return {
    ...(input.quoteId ? { QuoteID: input.quoteId } : {}),
    ...(typed ? { Status: 'DRAFT' as const } : {}),
    Contact: { ContactID: input.contactId },
    Date: input.date,
    ...(parts.title ? { Reference: write(parts.title, content.reference), Title: write(parts.title, title) } : {}),
    ...(parts.summary ? { Summary: write(parts.summary, fastQuoteSummary(content)) } : {}),
    ...(parts.terms ? { Terms: write(parts.terms, fastQuoteTerms(content)) } : {}),
    ...(typed ? { LineAmountTypes: inclusive ? 'INCLUSIVE' as const : 'EXCLUSIVE' as const } : {}),
    LineItems: [
      {
        Description: priced,
        Quantity: 1,
        UnitAmount: inclusive ? content.total : content.subtotal,
        ...(input.coded === false ? {} : { AccountCode: settings.account_code, TaxType: settings.gst_tax_type }),
      },
      ...after.map(Description => ({ Description })),
    ],
  }
}

/** Why Xero would refuse the quote. Empty when it fits. */
export function fastQuoteBodyProblems(body: XeroQuoteBody): string[] {
  const problems: string[] = []
  const over = (text: string, max: number) => text.length - max
  if (over(body.Title ?? '', XERO_QUOTE_LIMITS.title) > 0) {
    problems.push(`The title is ${over(body.Title ?? '', XERO_QUOTE_LIMITS.title)} characters too long for a Xero quote (${XERO_QUOTE_LIMITS.title} at most).`)
  }
  if (over(body.Summary ?? '', XERO_QUOTE_LIMITS.summary) > 0) {
    problems.push(`The presentation is ${over(body.Summary ?? '', XERO_QUOTE_LIMITS.summary)} characters too long for a Xero quote. Shorten it.`)
  }
  return problems
}

/** Where staff open a quote inside Xero to send it. They need to be signed in to Xero. */
export function xeroQuoteUrl(quoteId: string): string {
  return `https://go.xero.com/Accounts/Receivable/Quotes/View/${encodeURIComponent(quoteId.trim())}`
}
