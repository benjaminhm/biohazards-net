/*
 * lib/acceptableQuotes.ts
 *
 * Quote document types a client can accept from the quote link or the portal.
 * One job can have several (BCQ, CCQ, SACQ); each is accepted on its own and
 * every accepted quote on the job goes on the job's one Xero invoice.
 */
import type { DocType } from '@/lib/types'

export const ACCEPTABLE_QUOTE_TYPES = [
  'quote',
  'biohazard_cleaning_quote',
  'contents_clearance_quote',
  'surface_area_cleaning_quote',
] as const satisfies readonly DocType[]

export function isAcceptableQuoteType(type: unknown): boolean {
  return (ACCEPTABLE_QUOTE_TYPES as readonly string[]).includes(type as string)
}
