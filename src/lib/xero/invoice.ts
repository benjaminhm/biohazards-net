/*
 * lib/xero/invoice.ts
 *
 * Pure builders for the job's Xero invoice. One invoice per job; each accepted
 * quote on the job is one line, priced ex GST from the quote's own totals.
 * Kept free of I/O so it can be unit tested.
 */
import { createHash } from 'node:crypto'

export interface XeroSettings {
  /** Sales account code for quote lines (Xero AU default chart: 200 Sales). */
  account_code: string
  /** Tax type when the quote charges GST. */
  gst_tax_type: string
  /** Tax type when the quote has no GST. */
  no_gst_tax_type: string
  /** Days from invoice date to due date. */
  due_days: number
}

export const DEFAULT_XERO_SETTINGS: XeroSettings = {
  account_code: '200',
  gst_tax_type: 'OUTPUT',
  no_gst_tax_type: 'EXEMPTOUTPUT',
  due_days: 7,
}

export function xeroSettings(raw: unknown): XeroSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  const due = Number(r.due_days)
  return {
    account_code: str(r.account_code, DEFAULT_XERO_SETTINGS.account_code),
    gst_tax_type: str(r.gst_tax_type, DEFAULT_XERO_SETTINGS.gst_tax_type),
    no_gst_tax_type: str(r.no_gst_tax_type, DEFAULT_XERO_SETTINGS.no_gst_tax_type),
    due_days: Number.isFinite(due) && due >= 0 ? Math.round(due) : DEFAULT_XERO_SETTINGS.due_days,
  }
}

export interface AcceptedQuote {
  document_id: string
  type: string
  content: Record<string, unknown>
}

export interface XeroLine {
  Description: string
  Quantity: number
  UnitAmount: number
  AccountCode: string
  TaxType: string
}

const TYPE_LABELS: Record<string, string> = {
  quote: 'Quote',
  biohazard_cleaning_quote: 'Biohazard cleaning',
  contents_clearance_quote: 'Contents clearance',
  surface_area_cleaning_quote: 'Surface area cleaning',
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const cents = (n: number) => Math.round(n * 100) / 100

/** Ex-GST amount and whether GST applies, from a quote's subtotal / gst / total. */
export function quoteAmount(content: Record<string, unknown>): { exGst: number; gst: boolean } | null {
  const subtotal = num(content.subtotal)
  const gst = num(content.gst)
  const total = num(content.total)
  const hasGst = gst != null && gst > 0
  if (subtotal != null) return { exGst: cents(subtotal), gst: hasGst }
  if (total != null) return { exGst: cents(hasGst ? total - (gst as number) : total), gst: hasGst }
  return null
}

export function quoteLine(q: AcceptedQuote, settings: XeroSettings): XeroLine | null {
  const amount = quoteAmount(q.content)
  if (!amount) return null
  const label = TYPE_LABELS[q.type] ?? 'Quote'
  const title = typeof q.content.title === 'string' ? q.content.title.trim() : ''
  const reference = typeof q.content.reference === 'string' ? q.content.reference.trim() : ''
  const head = title && title.toLowerCase() !== label.toLowerCase() ? `${label}: ${title}` : label
  return {
    Description: reference ? `${head} (quote ${reference})` : head,
    Quantity: 1,
    UnitAmount: amount.exGst,
    AccountCode: settings.account_code,
    TaxType: amount.gst ? settings.gst_tax_type : settings.no_gst_tax_type,
  }
}

export interface BuiltLines {
  lines: XeroLine[]
  /** Accepted quotes with no subtotal or total, so they could not be priced. */
  unpriced: string[]
}

export function buildInvoiceLines(quotes: AcceptedQuote[], settings: XeroSettings): BuiltLines {
  const lines: XeroLine[] = []
  const unpriced: string[] = []
  for (const q of quotes) {
    const line = quoteLine(q, settings)
    if (line) lines.push(line)
    else unpriced.push(q.document_id)
  }
  return { lines, unpriced }
}

export function linesHash(lines: XeroLine[]): string {
  return createHash('sha256').update(JSON.stringify(lines)).digest('hex').slice(0, 32)
}

/** YYYY-MM-DD in Brisbane, offset by `addDays`. */
export function brisbaneDate(now: Date, addDays = 0): string {
  const d = new Date(now.getTime() + addDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(d)
}

export interface InvoiceInput {
  contactId: string
  reference: string
  lines: XeroLine[]
  settings: XeroSettings
  now: Date
}

export function draftInvoiceBody(input: InvoiceInput) {
  return {
    Type: 'ACCREC',
    Status: 'DRAFT',
    Contact: { ContactID: input.contactId },
    Reference: input.reference,
    Date: brisbaneDate(input.now),
    DueDate: brisbaneDate(input.now, input.settings.due_days),
    LineAmountTypes: 'Exclusive',
    LineItems: input.lines,
  }
}

/** A signed document link on a job, as far as the invoice is concerned. */
export interface SignedLink {
  id: string
  /** Staff have checked it and created (or confirmed) the invoice. */
  confirmed: boolean
  /** The quotes accepted on it. */
  documentIds: string[]
}

/**
 * Whether the job's invoice may be touched now. A signed link that staff have
 * not checked yet holds the invoice: nothing is created or changed until a
 * person confirms it. The check itself (`confirming` is that link) goes ahead,
 * leaving out the quotes of any other link still waiting for its own check.
 * Pass null for every other trigger.
 */
export function staffCheckHold(links: SignedLink[], confirming: string | null): { hold: boolean; leaveOut: string[] } {
  const waiting = links.filter(l => !l.confirmed && l.id !== confirming)
  if (confirming == null) return { hold: waiting.length > 0, leaveOut: [] }
  return { hold: false, leaveOut: [...new Set(waiting.flatMap(l => l.documentIds))] }
}

/**
 * Where staff open an invoice inside Xero. They need to be signed in to Xero;
 * with one Xero file there is no organisation to choose.
 */
export function xeroInvoiceUrl(invoiceId: string): string {
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(invoiceId.trim())}`
}

/** Value for a Xero `where` string literal: quotes and backslashes removed. */
export function whereLiteral(value: string): string {
  return value.replace(/["\\]/g, '').trim()
}

export interface ContactInput {
  name: string
  email: string
  phone: string
  /** The person, when the contact's name is a company. */
  firstName?: string
  lastName?: string
  address?: { line1: string; city: string; region: string; postalCode: string }
  /** ABN, digits only. */
  abn?: string
  /** ACN, digits only. */
  acn?: string
}

/**
 * The Xero contact for the person who signed: they are the paying, responsible
 * client, so the invoice is made out to them as they gave their details. The
 * contact is named for the company when they signed for one, with the signer
 * as its person.
 */
export function contactFromSigner(details: {
  legalName: string
  email: string
  mobile: string
  address: { street: string; suburb: string; state: string; postcode: string }
  company: { name: string; number: string; numberType: string } | null
}): ContactInput {
  const words = details.legalName.trim().split(/\s+/)
  const company = details.company?.name.trim() ?? ''
  return {
    name: company || details.legalName.trim(),
    email: details.email,
    phone: details.mobile,
    firstName: words[0] ?? '',
    lastName: words.slice(1).join(' '),
    address: {
      line1: details.address.street,
      city: details.address.suburb,
      region: details.address.state,
      postalCode: details.address.postcode,
    },
    ...(details.company?.numberType === 'ABN' ? { abn: details.company.number } : {}),
    ...(details.company?.numberType === 'ACN' ? { acn: details.company.number } : {}),
  }
}

/**
 * A new contact as Xero takes it. The address is given as both the street and
 * the postal address: Xero prints the postal one on invoices.
 */
export function xeroContactBody(input: ContactInput): Record<string, unknown> {
  const contact: Record<string, unknown> = { Name: input.name }
  if (input.firstName) contact.FirstName = input.firstName
  if (input.lastName) contact.LastName = input.lastName
  if (input.email) contact.EmailAddress = input.email
  if (input.phone) contact.Phones = [{ PhoneType: 'MOBILE', PhoneNumber: input.phone }]
  if (input.address) {
    const a = {
      AddressLine1: input.address.line1,
      City: input.address.city,
      Region: input.address.region,
      PostalCode: input.address.postalCode,
      Country: 'Australia',
    }
    contact.Addresses = [{ AddressType: 'STREET', ...a }, { AddressType: 'POBOX', ...a }]
  }
  if (input.abn) contact.TaxNumber = input.abn
  if (input.acn) contact.CompanyNumber = input.acn
  return contact
}

/** A contact as Xero's search returns it. */
export interface XeroContactLite {
  ContactID: string
  Name?: string
  FirstName?: string
  LastName?: string
  EmailAddress?: string
  ContactStatus?: string
}

/** A Xero contact that may be the person who signed, for staff to choose from. */
export interface ContactCandidate {
  id: string
  name: string
  /** The contact's person, when it has one and it differs from the name. */
  person: string
  email: string
  /** Why it is offered: the same email, the same name, or only similar. */
  why: 'email' | 'name' | 'similar'
}

/**
 * Existing Xero contacts that may be the signer, best first: the same email,
 * then the same name, then anything else the search turned up. Archived
 * contacts are left out (an invoice cannot be raised to one), and only a few
 * are shown: staff are choosing, not browsing.
 */
export function rankContacts(
  found: XeroContactLite[],
  who: { email: string; names: string[] },
  limit = 8,
): ContactCandidate[] {
  const email = who.email.trim().toLowerCase()
  const names = who.names.map(n => n.trim().toLowerCase()).filter(Boolean)
  const seen = new Set<string>()
  const out: ContactCandidate[] = []
  for (const c of found) {
    if (!c.ContactID || seen.has(c.ContactID) || c.ContactStatus === 'ARCHIVED') continue
    seen.add(c.ContactID)
    const name = (c.Name ?? '').trim()
    const person = [c.FirstName, c.LastName].map(s => (s ?? '').trim()).filter(Boolean).join(' ')
    const contactEmail = (c.EmailAddress ?? '').trim()
    const why = email && contactEmail.toLowerCase() === email
      ? 'email'
      : names.includes(name.toLowerCase()) || (person && names.includes(person.toLowerCase()))
        ? 'name'
        : 'similar'
    out.push({ id: c.ContactID, name: name || person || contactEmail, person: person && person !== name ? person : '', email: contactEmail, why })
  }
  const order = { email: 0, name: 1, similar: 2 }
  return out.sort((a, b) => order[a.why] - order[b.why]).slice(0, limit)
}

export function contactFromJob(job: {
  client_name?: string | null
  client_organization_name?: string | null
  client_email?: string | null
  client_phone?: string | null
  job_code?: string | null
}): ContactInput {
  const org = job.client_organization_name?.trim() ?? ''
  const person = job.client_name?.trim() ?? ''
  const email = job.client_email?.trim() ?? ''
  const usable = (s: string) => s && !/^caller\s*\+?\d|^unknown caller$/i.test(s)
  const name = (usable(org) && org) || (usable(person) && person) || email || `Job ${job.job_code ?? ''}`.trim()
  return { name, email, phone: job.client_phone?.trim() ?? '' }
}
