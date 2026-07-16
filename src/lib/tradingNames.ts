/*
 * Per-job trading names under one ABN.
 *
 * company_profile stays the org source of truth for shared details (ABN, address,
 * phone, licence, logo). applyTradingBrand() overlays the job's trading name
 * (display name + brand email) for composed / printed client documents.
 */
import type { CompanyProfile } from '@/lib/types'

export const TRADING_NAME_IDS = [
  'brisbane_biohazard_cleaning',
  'forensic_cleaning_qld',
] as const

export type TradingNameId = (typeof TRADING_NAME_IDS)[number]

export interface TradingNameOption {
  id: TradingNameId
  label: string
  /** When set, overrides company_profile.email on client-facing documents. */
  email?: string
  /**
   * When true, do not inherit company_profile.logo_url — use a typographic
   * wordmark (company name) on documents instead. Swap for a real asset later
   * by setting logo_url on the option or uploading a brand logo.
   */
  useWordmark?: boolean
}

/** Default reply-to on Authorisation to Proceed when Settings email is empty. */
export const DEFAULT_AUTH_REPLY_EMAIL = 'admin@brisbanebiohazardcleaning.com.au'

export const TRADING_NAME_OPTIONS: TradingNameOption[] = [
  {
    id: 'brisbane_biohazard_cleaning',
    label: 'Brisbane Biohazard Cleaning',
    // Letterhead email/logo stay whatever is on company_profile (Settings).
    // Auth-to-proceed reply falls back via DEFAULT_AUTH_REPLY_EMAIL.
  },
  {
    id: 'forensic_cleaning_qld',
    label: 'Forensic Cleaning QLD',
    email: 'admin@forensiccleaningqld.com.au',
    useWordmark: true,
  },
]

export function isTradingNameId(value: unknown): value is TradingNameId {
  return typeof value === 'string' && (TRADING_NAME_IDS as readonly string[]).includes(value)
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
