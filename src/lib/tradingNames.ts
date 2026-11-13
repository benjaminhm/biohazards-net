/*
 * Per-job trading names ("brands") under one ABN.
 *
 * company_profile stays the org source of truth for shared details (ABN, address,
 * phone, licence, logo). applyTradingBrand() overlays the job's trading name
 * (display name + brand email) for composed / printed client documents.
 *
 * Adding a brand is one entry in BRANDS below. The ids, the TypeScript type,
 * the pickers, the queue headings, the portal terms and the validation on every
 * write all come from that list, and the database accepts any id (migration 073).
 * Outside the code a new brand still needs its domains connected: the document
 * and accounts hosts in Vercel and DNS, and the email domain in Resend before
 * sendsFromEmail is turned on.
 *
 * Never change or remove an id that jobs or accounts already use: the id is
 * what is stored on them.
 */
import type { CompanyProfile } from '@/lib/types'

interface BrandDetails {
  label: string
  /** Staff shorthand for headings where the full name is too long (Job Manager). Not printed on documents. */
  short: string
  /**
   * The brand's own inbox. When set it is the email printed on client-facing
   * documents (in place of company_profile.email) and where client replies and
   * the office copy of a signed quote go.
   */
  email?: string
  /**
   * True once the brand's domain is verified with the mail provider (Resend),
   * so mail is sent from `email`. Until then mail goes out under the brand's
   * name from the shared address, and replies still come to `email`: Resend
   * refuses a send from an unverified domain outright.
   */
  sendsFromEmail?: boolean
  /**
   * When true, do not inherit company_profile.logo_url — use a typographic
   * wordmark (company name) on documents instead. Swap for a real asset later
   * by setting logo_url on the option or uploading a brand logo.
   */
  useWordmark?: boolean
  /**
   * Host serving this brand's commercial accounts portal. Middleware matches on
   * it to route the request to /portal; omit until the domain is live in Vercel
   * and DNS, otherwise the host resolves to nothing.
   */
  accountsHost?: string
  /**
   * Host serving the standalone PIN-authenticated photo capture app
   * (e.g. photo.forensiccleaningqld.com.au).
   */
  photoHost?: string
  /**
   * Host where clients open a document they have been sent to view or sign
   * (e.g. document.forensiccleaningqld.com.au/<private code>). Only those
   * pages are reachable on it. Links fall back to the app address until the
   * host is connected in Vercel and DNS (lib/signing/links.ts checks).
   */
  documentHost?: string
}

/** Default reply-to on Authorisation to Proceed when Settings email is empty. */
export const DEFAULT_AUTH_REPLY_EMAIL = 'admin@biohazardcleaningqld.com.au'

/** The one list of brands, in the order staff see them. */
const BRANDS = [
  {
    // Stored id predates the rename to Biohazard Cleaning QLD; existing jobs reference it.
    id: 'brisbane_biohazard_cleaning',
    label: 'Biohazard Cleaning QLD',
    short: 'BCQ',
    // The logo stays whatever is on company_profile (Settings). The domain is
    // not verified in Resend yet, so mail is sent from the shared address.
    email: 'admin@biohazardcleaningqld.com.au',
    documentHost: 'document.biohazardcleaningqld.com.au',
  },
  {
    id: 'forensic_cleaning_qld',
    label: 'Forensic Cleaning QLD',
    short: 'FCQ',
    email: 'admin@forensiccleaningqld.com.au',
    sendsFromEmail: true,
    useWordmark: true,
    accountsHost: 'accounts.forensiccleaningqld.com.au',
    photoHost: 'photo.forensiccleaningqld.com.au',
    documentHost: 'document.forensiccleaningqld.com.au',
  },
  {
    // Stored id predates the correction to Hoarding Clearance QLD; existing jobs reference it.
    id: 'hoarding_cleaning_qld',
    label: 'Hoarding Clearance QLD',
    short: 'HCQ',
    // The domain is not verified in Resend yet, so mail is sent from the shared
    // address. It also had no mail (MX) records when this address was set
    // (Nov 2026): replies bounce until the mailbox is set up.
    email: 'admin@hoardingclearanceqld.com.au',
    useWordmark: true,
    documentHost: 'document.hoardingclearanceqld.com.au',
  },
] as const satisfies readonly ({ id: string } & BrandDetails)[]

/** The id stored on jobs and accounts (jobs.trading_name, client_accounts.trading_name). */
export type TradingNameId = (typeof BRANDS)[number]['id']

export interface TradingNameOption extends BrandDetails {
  id: TradingNameId
}

export const TRADING_NAME_OPTIONS: TradingNameOption[] = [...BRANDS]

export const TRADING_NAME_IDS: readonly TradingNameId[] = TRADING_NAME_OPTIONS.map(o => o.id)

export function isTradingNameId(value: unknown): value is TradingNameId {
  return typeof value === 'string' && (TRADING_NAME_IDS as readonly string[]).includes(value)
}

/** The staff shorthands as a phrase, e.g. "BCQ, FCQ or HCQ". */
export function tradingNameShortList(): string {
  const shorts = TRADING_NAME_OPTIONS.map(o => o.short)
  if (shorts.length <= 1) return shorts.join('')
  return `${shorts.slice(0, -1).join(', ')} or ${shorts[shorts.length - 1]}`
}

export function tradingNameOption(id: TradingNameId | null | undefined): TradingNameOption | null {
  if (!id) return null
  return TRADING_NAME_OPTIONS.find(o => o.id === id) ?? null
}

/**
 * Map a request host to the trading brand whose accounts portal it serves.
 * Returns null for every other host, which is what keeps the portal off the
 * staff app and the public websites.
 */
export function accountsHostTradingName(host: string | null | undefined): TradingNameId | null {
  const normalised = (host ?? '').split(':')[0].trim().toLowerCase()
  if (!normalised) return null
  const match = TRADING_NAME_OPTIONS.find(o => o.accountsHost?.toLowerCase() === normalised)
  return match?.id ?? null
}

/** Map a request host to the trading brand whose client document links it serves. */
export function documentHostTradingName(host: string | null | undefined): TradingNameId | null {
  const normalised = (host ?? '').split(':')[0].trim().toLowerCase()
  if (!normalised) return null
  const match = TRADING_NAME_OPTIONS.find(o => o.documentHost?.toLowerCase() === normalised)
  return match?.id ?? null
}

/**
 * True when the request host is a standalone photo capture host
 * (e.g. photo.forensiccleaningqld.com.au or photo.biohazards.net).
 */
export function isPhotoCaptureHost(host: string | null | undefined): boolean {
  const normalised = (host ?? '').split(':')[0].trim().toLowerCase()
  if (!normalised) return false
  if (normalised === 'photo.biohazards.net' || normalised === 'photo.forensiccleaningqld.com.au') return true
  return TRADING_NAME_OPTIONS.some(o => o.photoHost?.toLowerCase() === normalised)
}

/** True when the request host is the job notepad (notes.biohazards.net). */
export function isNotesCaptureHost(host: string | null | undefined): boolean {
  return (host ?? '').split(':')[0].trim().toLowerCase() === 'notes.biohazards.net'
}

/** Absolute base URL of a brand's accounts portal, for links in emails. */
export function accountsPortalBaseUrl(id: TradingNameId | null | undefined): string | null {
  const host = tradingNameOption(id)?.accountsHost
  if (host) return `https://${host}`
  // Local dev serves the portal from the app origin at /portal.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl && /localhost|127\.0\.0\.1/.test(appUrl)) return appUrl
  return null
}

/** The brand address mail can be sent from, or null when it must go from the shared address. */
export function tradingSendingEmail(id: TradingNameId | null | undefined): string | null {
  const option = tradingNameOption(id)
  return (option?.sendsFromEmail && option.email?.trim()) || null
}

export function tradingNameLabel(id: TradingNameId | null | undefined): string | null {
  if (!id) return null
  return TRADING_NAME_OPTIONS.find(o => o.id === id)?.label ?? null
}

/**
 * Email clients should use when returning a signed Authorisation to Proceed.
 * Prefer the trading-name brand email; fall back to company Settings, then BBC default.
 */
export function tradingAuthReplyEmail(
  tradingName: TradingNameId | null | undefined,
  companyEmail?: string | null,
): string {
  if (isTradingNameId(tradingName)) {
    const branded = TRADING_NAME_OPTIONS.find(o => o.id === tradingName)?.email?.trim()
    if (branded) return branded
  }
  const fromCompany = (companyEmail ?? '').trim()
  return fromCompany || DEFAULT_AUTH_REPLY_EMAIL
}

/** Overlay trading-name brand onto company profile for document composition. */
export function applyTradingBrand(
  company: CompanyProfile | null,
  tradingName: TradingNameId | null | undefined,
): CompanyProfile | null {
  if (!company && !tradingName) return null
  const option = tradingName
    ? TRADING_NAME_OPTIONS.find(o => o.id === tradingName)
    : undefined
  if (!option) return company

  const base: CompanyProfile = company ?? {
    id: '',
    name: option.label,
    abn: '',
    phone: '',
    email: option.email ?? '',
    address: '',
    licence: '',
    tagline: '',
    logo_url: null,
    subdomain: null,
    custom_domain: null,
    updated_at: '',
  }

  return {
    ...base,
    name: option.label,
    email: option.email?.trim() || base.email,
    // FCQ (and any wordmark brand) must not show the other trading name's logo.
    logo_url: option.useWordmark ? null : base.logo_url,
  }
}
