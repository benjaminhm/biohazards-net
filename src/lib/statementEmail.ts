/*
 * lib/statementEmail.ts
 *
 * What goes in the email a statement pack is sent in (lib/email/documentEmail.ts):
 * the summary card and pay buttons from the statement as it was saved, the
 * documents in the pack with a View link each, and which of them are attached.
 *
 * The figures and pay links come from the same presentation the printed
 * statement uses, so the email never says something the statement does not:
 * no pay button where the statement has none (nothing owing, no Xero link, or
 * invoice 1 while the credit note is still to be applied in Xero).
 *
 * Pure: no database, no network.
 */
import type { StatementOfAccountsContent } from '@/lib/types'
import {
  StatementReconciliationError,
  isStatementV2Content,
  presentStatementDocument,
  presentStatementV2,
} from '@/lib/statementOfAccounts'
import type { DocumentEmailInput, DocumentEmailLink, DocumentEmailRow } from '@/lib/email/documentEmail'

/** Attachments above this total go as links only. Mail providers refuse much past 25 MB once encoded. */
export const ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024

export function emailMoney(n: number): string {
  const rounded = Math.round(Math.abs(n) * 100) / 100
  return '$' + rounded.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface StatementEmailMoney {
  summary: DocumentEmailRow[]
  payButtons: DocumentEmailLink[]
  /** Why an invoice has no pay button yet, as the statement prints it. */
  notes: string[]
  preheader: string
}

function payLabel(number: string | undefined, fallback: string, amount: number): string {
  const num = number?.trim()
  return `Pay ${num ? `invoice ${num}` : fallback} · ${emailMoney(amount)}`
}

function summaryRows(jobTotal: number, paid: number, balance: number): DocumentEmailRow[] {
  const credit = balance < -0.004
  return [
    { label: 'Total job value', value: emailMoney(jobTotal) },
    { label: 'Paid to date', value: emailMoney(paid) },
    { label: credit ? 'Credit in your favour' : 'Balance due', value: emailMoney(balance), strong: true },
  ]
}

function preheaderFor(balance: number): string {
  return balance < -0.004 ? `Credit in your favour ${emailMoney(balance)}` : `Balance due ${emailMoney(balance)}`
}

/**
 * The card and pay buttons for a saved statement. Null when the statement
 * cannot be shown (it does not reconcile), in which case the email carries
 * neither and the client opens the statement for the figures.
 */
export function statementEmailMoney(content: unknown): StatementEmailMoney | null {
  try {
    if (isStatementV2Content(content)) {
      const view = presentStatementV2(content)
      const payButtons: DocumentEmailLink[] = []
      const notes: string[] = []
      if (view.invoices.length === 0) {
        if (view.payHref && view.balance > 0.004) {
          payButtons.push({ label: payLabel(content.invoice_number, 'now', view.balance), href: view.payHref })
        }
      }
      for (const inv of view.invoices) {
        const name = inv.heading.split(' · ')[0]
        if (inv.payHref && inv.amount > 0.004) {
          const number = inv.kind === 'invoice1' ? content.invoice_number : content.invoice2_number
          const fallback = inv.kind === 'invoice1' ? 'invoice 1' : 'invoice 2'
          payButtons.push({ label: payLabel(number, fallback, inv.amount), href: inv.payHref })
        } else if (inv.payNote) {
          notes.push(`${name}: ${inv.payNote}`)
        }
      }
      return { summary: summaryRows(view.jobTotal, view.paid, view.balance), payButtons, notes, preheader: preheaderFor(view.balance) }
    }
    const c = content as StatementOfAccountsContent
    const view = presentStatementDocument(c)
    const numbers = [c.original_invoice_number, c.new_invoice_number]
    const payButtons = view.invoices.flatMap((inv, i) =>
      inv.payHref && inv.balanceInc > 0.004
        ? [{ label: payLabel(numbers[i], `invoice ${i + 1}`, inv.balanceInc), href: inv.payHref }]
        : [],
    )
    const { jobTotalInc, paidInc, balanceInc } = view.summary
    return { summary: summaryRows(jobTotalInc, paidInc, balanceInc), payButtons, notes: [], preheader: preheaderFor(balanceInc) }
  } catch (err) {
    if (err instanceof StatementReconciliationError) return null
    throw err
  }
}

/**
 * Which files fit under the limit. The largest are left off first, and the
 * statement (`keep`) only once every other document is off. What is left off
 * still goes in the email as a link.
 */
export function trimAttachments<T extends { size: number; keep?: boolean }>(
  files: T[],
  limit = ATTACHMENT_LIMIT_BYTES,
): { attached: T[]; tooLarge: T[] } {
  let total = files.reduce((sum, f) => sum + f.size, 0)
  const dropOrder = [...files].sort((a, b) => Number(Boolean(a.keep)) - Number(Boolean(b.keep)) || b.size - a.size)
  const dropped = new Set<T>()
  for (const file of dropOrder) {
    if (total <= limit) break
    dropped.add(file)
    total -= file.size
  }
  // Something smaller left off on the way may fit once a bigger file is off.
  for (const file of [...dropped].sort((a, b) => Number(Boolean(b.keep)) - Number(Boolean(a.keep)) || a.size - b.size)) {
    if (total + file.size > limit) continue
    dropped.delete(file)
    total += file.size
  }
  return { attached: files.filter(f => !dropped.has(f)), tooLarge: files.filter(f => dropped.has(f)) }
}

export type StatementEmailItemStatus = 'attached' | 'too_large' | 'failed'

export interface StatementEmailItem {
  name: string
  href: string
  status: StatementEmailItemStatus
}

export function statementEmailInput(d: {
  brandLabel: string
  reference: string | null
  /** Staff's message, exactly as sent from the window. */
  message: string
  statementContent: unknown
  packUrl: string
  /** The statement first, then the other documents, in pack order. */
  items: StatementEmailItem[]
  expiresLabel: string
  contact: { phone?: string | null; email?: string | null }
}): DocumentEmailInput {
  const money = statementEmailMoney(d.statementContent)
  const attachedCount = d.items.filter(i => i.status === 'attached').length
  return {
    brandLabel: d.brandLabel,
    title: 'Statement of Accounts',
    reference: d.reference,
    message: d.message,
    preheader: money?.preheader,
    summary: money?.summary,
    primary: { label: 'View statement', href: d.packUrl },
    secondary: money?.payButtons,
    notes: money?.notes,
    documentsHeading: attachedCount ? 'Your documents (PDFs attached)' : 'Your documents',
    documents: d.items.map(item => ({
      name: item.name,
      href: item.href,
      note: item.status === 'attached' ? 'PDF attached' : 'Not attached: use View to open it',
    })),
    linkNote: `These links are private to you, so please do not forward this email. They can be used until ${d.expiresLabel}.`,
    contact: d.contact,
  }
}

/** File names for the attachments, with a number added where two would be the same. */
export function uniqueFilenames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map(name => {
    const key = name.toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n === 1 ? name : name.replace(/(\.pdf)?$/i, ` (${n})$1`)
  })
}
