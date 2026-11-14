/*
 * lib/documentPack.ts
 *
 * A statement pack: the Statement of Accounts sent to the client by private
 * link, with the Contents Disposal Record and report staff chose to put with
 * it. The link opens on the statement; a bar above each document links to the
 * others in the pack and downloads the one in view as a PDF. View and download
 * only: nothing is signed or accepted.
 *
 * The links live on the brand's document host beside quote links, under /p/
 * so the two kinds of link never meet:
 *
 *   document.<brand>.com.au/p/<token>            the statement
 *   document.<brand>.com.au/p/<token>?doc=2      the second document in the pack
 *   document.<brand>.com.au/p/<token>/pdf?doc=2  its PDF
 *
 * On the app address (brands with no document host yet) the same pages are
 * /pack/<token> and /api/pack/<token>/pdf. Passcode, five-try lock and unlock
 * cookie are the quote links' own (lib/signing/core.ts).
 *
 * Pure: no database, no network. The routes and lib/documentPackStore.ts use it.
 */
import { DOC_TYPE_LABELS } from '@/lib/types'
import type { DocType } from '@/lib/types'

/** How long a pack link can be used. */
export const PACK_LINK_DAYS = 28

/** The statement plus up to this many other documents. */
export const MAX_PACK_EXTRAS = 6

export const PACK_STATEMENT_TYPE = 'statement_of_accounts'

/** What can go in a pack with the statement, in the order it is shown. */
export const PACK_EXTRA_TYPES = ['waste_disposal_manifest', 'report'] as const

export function isPackExtraType(type: string): boolean {
  return (PACK_EXTRA_TYPES as readonly string[]).includes(type)
}

export function packExpiry(from: Date): Date {
  return new Date(from.getTime() + PACK_LINK_DAYS * 24 * 60 * 60 * 1000)
}

export type PackLinkState = 'open' | 'voided' | 'expired' | 'locked'

export function packLinkState(
  row: { status: string; expires_at: string; passcode_locked_at?: string | null },
  now: Date,
): PackLinkState {
  if (row.status === 'voided') return 'voided'
  if (row.passcode_locked_at) return 'locked'
  const expires = new Date(row.expires_at).getTime()
  if (Number.isNaN(expires) || expires <= now.getTime()) return 'expired'
  return 'open'
}

export interface PackLinks {
  /** The statement: the link the client is given. */
  page: string
  host: string
}

export function buildPackLinks(token: string, appUrl: string, documentHost: string | null): PackLinks {
  if (documentHost) return { page: `https://${documentHost}/p/${token}`, host: documentHost }
  const base = appUrl.replace(/\/+$/, '')
  let host = base
  try { host = new URL(base).host } catch { /* keep as written */ }
  return { page: `${base}/pack/${token}`, host }
}

/** Paths for one pack, as seen from the page the client is on. */
export function packPaths(token: string, onDocumentHost: boolean): { page: string; pdf: string; api: string } {
  return onDocumentHost
    ? { page: `/p/${token}`, pdf: `/p/${token}/pdf`, api: `/api/pack/${token}` }
    : { page: `/pack/${token}`, pdf: `/api/pack/${token}/pdf`, api: `/api/pack/${token}` }
}

/** "Contents Disposal Record CDR-…": the name a document has in the pack. */
export function packItemLabel(item: { document_title: string; reference: string | null }): string {
  return `${item.document_title}${item.reference ? ` ${item.reference}` : ''}`
}

export function packDocumentTitle(type: string): string {
  return DOC_TYPE_LABELS[type as DocType] ?? 'Document'
}

/** Which document is wanted: ?doc=1 is the statement. Out of range or missing is the statement. */
export function packItemIndex(count: number, docParam: string | null): number {
  if (!docParam || !/^\d{1,3}$/.test(docParam)) return 0
  const n = Number(docParam)
  return n >= 1 && n <= count ? n - 1 : 0
}

/**
 * The documents to put in a pack, statement first, then the others in the
 * order the job's document types are listed (CDR before report), newest first
 * within each type. Ids that are not on the job, are the wrong type, or repeat
 * are dropped.
 */
export function orderPackExtras<T extends { id: string; type: string; created_at: string }>(
  chosenIds: string[],
  candidates: T[],
): T[] {
  const wanted = new Set(chosenIds)
  const typeRank = (t: string) => (PACK_EXTRA_TYPES as readonly string[]).indexOf(t)
  return candidates
    .filter(c => wanted.has(c.id) && isPackExtraType(c.type))
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || b.created_at.localeCompare(a.created_at))
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The bar above each document in the pack: the brand, a Download PDF button
 * for the one in view, and a link to each of the others. Hidden when printed.
 */
export function packBarHtml(d: {
  brandLabel: string
  items: { document_title: string; reference: string | null }[]
  current: number
  pagePath: string
  pdfPath: string
}): string {
  const docHref = (index: number) => (index === 0 ? d.pagePath : `${d.pagePath}?doc=${index + 1}`)
  const pdfHref = d.current === 0 ? d.pdfPath : `${d.pdfPath}?doc=${d.current + 1}`
  const links = d.items
    .map((item, index) => {
      const label = `${esc(item.document_title)}${item.reference ? `<small>${esc(item.reference)}</small>` : ''}`
      return index === d.current
        ? `<span class="bh-pack-tab bh-pack-on" aria-current="page">${label}</span>`
        : `<a class="bh-pack-tab" href="${esc(docHref(index))}">${label}</a>`
    })
    .join('')
  return `
<div class="bh-pack-bar" role="navigation" aria-label="Your documents">
  <div class="bh-pack-inner">
    <div class="bh-pack-top">
      <div class="bh-pack-brand">${esc(d.brandLabel)}</div>
      <a class="bh-pack-pdf" href="${esc(pdfHref)}" target="_blank" rel="noopener">Download PDF</a>
    </div>
    ${d.items.length > 1 ? `<div class="bh-pack-tabs">${links}</div>` : ''}
  </div>
</div>
<style>
  .bh-pack-bar { position: sticky; top: 0; z-index: 50; background: #0f172a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-shadow: 0 2px 12px rgba(0,0,0,0.2); }
  .bh-pack-inner { max-width: 960px; margin: 0 auto; padding: 10px 16px; box-sizing: border-box; }
  .bh-pack-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .bh-pack-brand { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; }
  .bh-pack-tabs { display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .bh-pack-tab { flex: none; font-size: 13px; line-height: 1.3; padding: 6px 10px; border-radius: 6px; color: #e2e8f0; text-decoration: none; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; }
  .bh-pack-tab small { display: block; font-size: 11px; opacity: 0.75; }
  a.bh-pack-tab:hover { background: rgba(255,255,255,0.1); }
  .bh-pack-on { background: #fff; color: #0f172a; font-weight: 700; border-color: #fff; }
  .bh-pack-pdf { font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 6px; background: #FF6B35; color: #fff; text-decoration: none; white-space: nowrap; }
  @media print { .bh-pack-bar { display: none !important; } }
</style>`
}

/** Put the bar first inside <body>. */
export function insertAtBodyStart(html: string, extra: string): string {
  const match = /<body\b[^>]*>/i.exec(html)
  if (!match) return extra + html
  const at = match.index + match[0].length
  return html.slice(0, at) + extra + html.slice(at)
}

/** The PDF's file name: "Statement of Accounts SOA-….pdf". */
export function packPdfFilename(item: { document_title: string; reference: string | null }): string {
  const name = packItemLabel(item).replace(/[^A-Za-z0-9 ._-]+/g, '').replace(/\s+/g, ' ').trim()
  return `${name || 'Document'}.pdf`
}

/** What the client is told with the link, for staff to paste into their own text or email. */
export function packLinkMessage(d: {
  clientName: string
  siteAddress: string | null
  staffFirstName: string
  brandLabel: string
  link: string
  passcode: string
  expiresLabel: string
}): string {
  const first = d.clientName.trim().split(/\s+/)[0] || 'there'
  const site = d.siteAddress?.trim()
  return [
    `Hi ${first}, your Statement of Accounts from ${d.brandLabel}${site ? ` for ${site}` : ''} is ready to view and download here:`,
    d.link,
    `Passcode: ${d.passcode}`,
    `The statement links to the other documents for the job. The link can be used until ${d.expiresLabel}.`,
    d.staffFirstName ? `Thanks, ${d.staffFirstName}` : 'Thanks',
  ].join('\n\n')
}

export function packDefaultSubject(brandLabel: string, reference: string | null): string {
  return `Statement of Accounts${reference ? ` ${reference}` : ''} from ${brandLabel}`
}

export function packDefaultMessage(d: {
  clientName: string
  siteAddress: string | null
  staffFirstName: string
  brandLabel: string
}): string {
  const first = d.clientName.trim().split(/\s+/)[0] || 'there'
  const site = d.siteAddress?.trim()
  return [
    `Hi ${first},`,
    '',
    `Please find your Statement of Accounts${site ? ` for ${site}` : ''} at the link below. It links to the other documents for the job, and each can be downloaded as a PDF.`,
    '',
    'Kind regards,',
    d.staffFirstName || d.brandLabel,
    d.staffFirstName ? d.brandLabel : '',
  ].join('\n').trim()
}
