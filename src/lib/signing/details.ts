/*
 * lib/signing/details.ts
 *
 * The "Your details" step the client completes before signing: who is signing,
 * in what capacity, and where they can be reached. The person who signs becomes
 * the paying, responsible client, so these are the details an invoice, a notice
 * or a legal document would be sent to.
 *
 * This is what the signer states about themselves, under a declaration. It is
 * not an identity check: nothing here is verified against a licence or any
 * register. Staff read it before anything is invoiced.
 *
 * The one set of rules for what may be saved. The page asks the server to check
 * what was typed (so there is no second copy of these rules in the browser),
 * and the server checks again when the document is signed. No database, network
 * or Node imports: the staff screens use the labels too.
 */

export const CAPACITIES = [
  { id: 'owner', label: 'Owner of the property' },
  { id: 'tenant', label: 'Tenant of the property' },
  { id: 'agent', label: 'Agent for the owner' },
  { id: 'executor', label: 'Executor or administrator of an estate' },
  { id: 'company_officer', label: 'Officer of a company' },
] as const

export type CapacityId = (typeof CAPACITIES)[number]['id']

export function capacityLabel(id: string | null | undefined): string {
  return CAPACITIES.find(c => c.id === id)?.label ?? ''
}

/** Whether the company fields apply: a company officer must give them, an agent may. */
export function companyRule(capacity: string): 'required' | 'optional' | 'none' {
  if (capacity === 'company_officer') return 'required'
  if (capacity === 'agent') return 'optional'
  return 'none'
}

export const STATES = ['QLD', 'NSW', 'VIC', 'TAS', 'SA', 'WA', 'NT', 'ACT'] as const

/*
 * PLACEHOLDER WORDING. To be replaced with the solicitor's wording. Each signed
 * request keeps the exact text the signer agreed to, with this version, so a
 * later change of wording never alters what an earlier signer declared.
 */
export const DECLARATION_VERSION = 'placeholder-1'

export function declarationText(brandLabel: string): string {
  return (
    'I declare that the details I have given are true and correct, that I am the person named, ' +
    'and that I am authorised to accept this quote in the capacity stated. ' +
    `I understand ${brandLabel} will rely on these details, and may send invoices, notices and legal documents ` +
    'to me at the address, email and mobile number I have given.'
  )
}

export interface SignerCompany {
  name: string
  /** ABN (11 digits) or ACN (9 digits), digits only. Empty when an agent gave none. */
  number: string
  numberType: 'ABN' | 'ACN' | ''
  position: string
}

/** What the signer typed, tidied. */
export interface SignerDetailsInput {
  capacity: CapacityId
  legalName: string
  /** YYYY-MM-DD. Kept on the record and shown to staff; not printed on the docket. */
  dateOfBirth: string
  address: { street: string; suburb: string; state: string; postcode: string }
  mobile: string
  email: string
  company: SignerCompany | null
}

/** What is saved on the signed request. */
export interface SignerDetails extends SignerDetailsInput {
  declaration: { version: string; text: string; agreedAt: string }
}

export type DetailsResult =
  | { ok: true; details: SignerDetailsInput }
  | { ok: false; field: string; error: string }

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

const digits = (s: string) => s.replace(/\D/g, '')

/** An Australian Business Number: 11 digits that pass the ATO's check. */
export function isAbn(value: string): boolean {
  const d = digits(value)
  if (!/^\d{11}$/.test(d)) return false
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
  const sum = weights.reduce((total, w, i) => total + w * (Number(d[i]) - (i === 0 ? 1 : 0)), 0)
  return sum % 89 === 0
}

/** An Australian Company Number: 9 digits whose last digit is ASIC's check digit. */
export function isAcn(value: string): boolean {
  const d = digits(value)
  if (!/^\d{9}$/.test(d)) return false
  const sum = [8, 7, 6, 5, 4, 3, 2, 1].reduce((total, w, i) => total + w * Number(d[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(d[8])
}

/** "12 345 678 901" for an ABN, "123 456 789" for an ACN. */
export function formatCompanyNumber(number: string): string {
  const d = digits(number)
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  if (d.length === 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  return d
}

/**
 * A mobile number as it is kept: "0412 345 678" for an Australian mobile, or
 * "+" and the digits for a number from overseas. Null when it is neither.
 */
export function tidyMobile(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  const d = digits(raw)
  const local = /^04\d{8}$/.test(d) ? d : /^614\d{8}$/.test(d) ? `0${d.slice(2)}` : /^6104\d{8}$/.test(d) ? d.slice(2) : ''
  if (local) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
  if (raw.startsWith('+') && d.length >= 8 && d.length <= 15 && !d.startsWith('61')) return `+${d}`
  return null
}

/** YYYY-MM-DD from a date field, or from DD/MM/YYYY as typed. Null when it is not a real date. */
export function tidyDate(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const typed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : typed ? [typed[3], typed[2].padStart(2, '0'), typed[1].padStart(2, '0')] : ['', '', '']
  if (!y) return null
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${m}-${d}`
}

/** Whole years between a date of birth and today's date in Brisbane. */
export function ageOn(dateOfBirth: string, today: Date): number {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(today)
  const [ny, nm, nd] = now.split('-').map(Number)
  const [by, bm, bd] = dateOfBirth.split('-').map(Number)
  return ny - by - (nm < bm || (nm === bm && nd < bd) ? 1 : 0)
}

function isEmail(value: string): boolean {
  // The same test as lib/signing/core.ts, which cannot be loaded in a browser.
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(value)
}

/**
 * Check and tidy what the signer typed. The first problem found is returned
 * with the field it belongs to, so the page can point at it.
 */
export function cleanSignerDetails(input: unknown, today: Date): DetailsResult {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const bad = (field: string, error: string): DetailsResult => ({ ok: false, field, error })

  const capacity = CAPACITIES.find(c => c.id === o.capacity)?.id
  if (!capacity) return bad('capacity', 'Choose who you are signing as.')

  const legalName = text(o.legalName, 200)
  if (legalName.length < 2) return bad('legalName', 'Enter your full legal name.')
  if (legalName.length > 120) return bad('legalName', 'That name is too long.')

  const dateOfBirth = tidyDate(o.dateOfBirth)
  if (!dateOfBirth) return bad('dateOfBirth', 'Enter your date of birth.')
  const age = ageOn(dateOfBirth, today)
  if (age < 18) return bad('dateOfBirth', 'You need to be 18 or over to sign.')
  if (age > 120) return bad('dateOfBirth', 'Check your date of birth.')

  const a = (o.address && typeof o.address === 'object' ? o.address : {}) as Record<string, unknown>
  const street = text(a.street, 200)
  if (street.length < 3 || street.length > 120) return bad('street', 'Enter your residential street address.')
  const suburb = text(a.suburb, 100)
  if (suburb.length < 2 || suburb.length > 60) return bad('suburb', 'Enter your suburb or town.')
  const state = text(a.state, 10).toUpperCase()
  if (!(STATES as readonly string[]).includes(state)) return bad('state', 'Choose your state or territory.')
  const postcode = digits(text(a.postcode, 10))
  if (!/^\d{4}$/.test(postcode)) return bad('postcode', 'Enter your 4-digit postcode.')

  const mobile = tidyMobile(o.mobile)
  if (!mobile) return bad('mobile', 'Enter your mobile number, for example 0412 345 678.')

  const email = text(o.email, 200).toLowerCase()
  if (!isEmail(email) || email.length > 160) return bad('email', 'Enter your email address.')

  let company: SignerCompany | null = null
  const rule = companyRule(capacity)
  if (rule !== 'none') {
    const c = (o.company && typeof o.company === 'object' ? o.company : {}) as Record<string, unknown>
    const name = text(c.name, 200)
    const number = digits(text(c.number, 40))
    const position = text(c.position, 120)
    if (rule === 'required' || name || number || position) {
      if (name.length < 2 || name.length > 120) return bad('companyName', 'Enter the company name.')
      if (rule === 'required' && !number) return bad('companyNumber', "Enter the company's ABN or ACN.")
      if (number && !isAbn(number) && !isAcn(number)) {
        return bad('companyNumber', 'That is not a valid ABN (11 digits) or ACN (9 digits). Check the number.')
      }
      if (rule === 'required' && position.length < 2) return bad('position', 'Enter your position in the company.')
      company = { name, number, numberType: number.length === 11 ? 'ABN' : number.length === 9 ? 'ACN' : '', position }
    }
  }

  return {
    ok: true,
    details: { capacity, legalName, dateOfBirth, address: { street, suburb, state, postcode }, mobile, email, company },
  }
}

/** Details read back from the database: null unless they have the saved shape. */
export function readSignerDetails(value: unknown): SignerDetails | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Partial<SignerDetails>
  if (typeof o.legalName !== 'string' || !o.address || typeof o.address !== 'object' || typeof o.capacity !== 'string') return null
  return o as SignerDetails
}

export function addressLine(a: SignerDetailsInput['address']): string {
  return `${a.street}, ${a.suburb} ${a.state} ${a.postcode}`
}

/** "1990-03-14" as "14/03/1990", for the staff check. */
export function shortDate(isoDay: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDay) ? isoDay.split('-').reverse().join('/') : isoDay
}
