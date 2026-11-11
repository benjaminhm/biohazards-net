/*
 * lib/signing/items.ts
 *
 * The rules for a link that carries more than one quote: the client accepts or
 * declines each, signs once, and pays one deposit on what they accepted. No
 * database, network or Node imports, so it can be tested directly and used by
 * the staff screens.
 *
 * A link with one quote has nothing to choose: signing it accepts it, and
 * declining it declines the link, exactly as before.
 */
import { depositAmount, money, percentLabel } from '@/lib/signing/pay'

export type ItemDecision = 'pending' | 'accepted' | 'declined'

/** More than this on one page is more than a client will read through. */
export const MAX_QUOTES_PER_LINK = 6

/**
 * The client's choices as their page sends them: one per quote, in order, each
 * accepted or declined. Null when it is anything else. The choices are kept in
 * the client's browser until they sign, and are written once, with the
 * signature, so what is signed for is exactly what their page showed.
 */
export function readDecisions(value: unknown, count: number): ('accepted' | 'declined')[] | null {
  if (!Array.isArray(value) || value.length !== count) return null
  const out: ('accepted' | 'declined')[] = []
  for (const v of value) {
    if (v !== 'accepted' && v !== 'declined') return null
    out.push(v)
  }
  return out
}

/** The quotes with the client's choices applied. With one quote on the link, signing accepts it. */
export function withDecisions<T extends ItemLike>(items: T[], decisions: ('accepted' | 'declined')[] | null): T[] {
  if (items.length === 1) return [{ ...items[0], decision: 'accepted' }]
  return items.map((item, i) => ({ ...item, decision: decisions?.[i] ?? item.decision }))
}

/** A quote on a link, as far as these rules need it. */
export interface ItemLike {
  position: number
  document_title: string
  reference: string | null
  /** Inc GST. */
  quote_total: number | null
  decision: ItemDecision
}

export function itemLine(item: Pick<ItemLike, 'document_title' | 'reference'>): string {
  return `${item.document_title}${item.reference ? ` ${item.reference}` : ''}`
}

/** "A", "A and B", "A, B and C". */
export function listLine(parts: string[]): string {
  const list = parts.filter(Boolean)
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** The quotes the signature goes on. With one quote on the link, that quote. */
export function acceptedItems<T extends ItemLike>(items: T[]): T[] {
  if (items.length === 1) return items[0].decision === 'declined' ? [] : items
  return items.filter(i => i.decision === 'accepted')
}

/** The total of some quotes, to the cent. Null when none of them has a total. */
export function totalOf(items: Pick<ItemLike, 'quote_total'>[]): number | null {
  const priced = items.filter(i => i.quote_total != null && Number.isFinite(Number(i.quote_total)))
  if (!priced.length) return null
  return Math.round(priced.reduce((sum, i) => sum + Number(i.quote_total), 0) * 100) / 100
}

/**
 * Why a link with several quotes cannot be signed yet, or null when it can.
 * Every quote needs a choice, and at least one must be accepted: declining
 * them all is declining the link, which is a different button.
 */
export function decisionsProblem(items: ItemLike[]): string | null {
  if (items.length <= 1) return null
  if (items.some(i => i.decision === 'pending')) return 'Choose Accept or Decline for each quote before signing.'
  if (!items.some(i => i.decision === 'accepted')) return 'You have not accepted a quote, so there is nothing to sign.'
  return null
}

/** What the client's page is told about the quotes on the link: labels only, worked out here. */
export interface QuotesSummary {
  items: { n: number; label: string; totalLabel: string | null; decision: ItemDecision }[]
  /** Total of the accepted quotes, e.g. "$3,300.00". Null when none is accepted or none has a total. */
  acceptedTotalLabel: string | null
  /** The deposit on the accepted total. Null when there is no deposit to ask for. */
  depositLabel: string | null
  percentLabel: string | null
}

export function quotesSummary(items: ItemLike[], depositPercent: number | null): QuotesSummary {
  const total = totalOf(acceptedItems(items))
  const deposit = depositAmount(total, depositPercent)
  return {
    items: items.map((item, index) => ({
      n: index + 1,
      label: itemLine(item),
      totalLabel: item.quote_total != null ? money(Number(item.quote_total)) : null,
      decision: item.decision,
    })),
    acceptedTotalLabel: total != null ? money(total) : null,
    depositLabel: deposit != null ? money(deposit) : null,
    percentLabel: deposit != null && depositPercent != null ? percentLabel(Number(depositPercent)) : null,
  }
}

/**
 * Which quote a page shows, from 0. `wanted` is the number in the address
 * (from 1); without one, an open link starts on the first quote still to be
 * decided, and a signed link on the first accepted quote. A signed link never
 * shows a declined quote as if it were signed.
 */
export function pickItem(items: ItemLike[], wanted: number | null, signed: boolean): number {
  const valid = wanted != null && Number.isInteger(wanted) && wanted >= 1 && wanted <= items.length ? wanted - 1 : -1
  if (signed) {
    const accepted = acceptedItems(items)
    if (valid >= 0 && accepted.includes(items[valid])) return valid
    return accepted.length ? items.indexOf(accepted[0]) : 0
  }
  if (valid >= 0) return valid
  const undecided = items.findIndex(i => i.decision === 'pending')
  return undecided >= 0 ? undecided : 0
}

/** "1 of 2" style page number from the address, or null when it is not a number. */
export function readDocNumber(value: string | null): number | null {
  if (!value || !/^\d{1,3}$/.test(value)) return null
  return Number(value)
}
