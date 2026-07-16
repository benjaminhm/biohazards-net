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

export const TRADING_NAME_OPTIONS: TradingNameOption[] = [
  {
    id: 'brisbane_biohazard_cleaning',
    label: 'Brisbane Biohazard Cleaning',
    // Email + logo stay whatever is on company_profile (Settings).
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
