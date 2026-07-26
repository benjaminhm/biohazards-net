/*
 * lib/portal/application.ts
 *
 * The trade account application: which fields the client owns, how they group
 * on the form, and which must be answered before it can be submitted.
 *
 * Defined once and shared by the portal form, the submit endpoint and the staff
 * review card, so the three can never disagree about what "complete" means —
 * a client being told they are done while staff see gaps is the failure mode
 * this module exists to prevent.
 *
 * Field grouping mirrors how the information is actually gathered: who the
 * entity is, who runs it, who pays, and who vouches for them.
 */
import type { ClientAccount } from '@/lib/types'

/** Every column the client may write. Mirrors CLIENT_EDITABLE_FIELDS. */
export const APPLICATION_FIELDS = [
  'legal_name',
  'trading_as',
  'abn',
  'head_office_address',
  'phone',
  'director_name',
  'director_email',
  'director_phone',
  'finance_contact_name',
  'finance_contact_title',
  'finance_contact_email',
  'finance_contact_phone',
  'billing_email',
  'billing_address',
  'payment_terms',
  'payment_run_days',
  'payment_method',
  'purchase_order_required',
  'reference1_company',
  'reference1_contact',
  'reference1_phone',
  'reference1_email',
  'reference2_company',
  'reference2_contact',
  'reference2_phone',
  'reference2_email',
] as const

export type ApplicationField = (typeof APPLICATION_FIELDS)[number]

/**
 * The columns migration 048 added, as a select list. Staff routes already
 * select the pre-048 account columns, so this only carries the new ones —
 * appending APPLICATION_FIELDS wholesale would duplicate legal_name and friends.
 *
 * Kept as one literal, and interpolated by callers with `as const`, because
 * supabase-js infers the row shape from the select string at the type level and
 * loses it the moment the string is merely `string`.
 */
export const ACCOUNT_APPLICATION_COLUMNS =
  'head_office_address, director_name, director_email, director_phone, finance_contact_name, finance_contact_title, finance_contact_email, finance_contact_phone, payment_terms, payment_run_days, payment_method, purchase_order_required, reference1_company, reference1_contact, reference1_phone, reference1_email, reference2_company, reference2_contact, reference2_phone, reference2_email, application_submitted_at, application_submitted_by_contact_id, application_reopened_at, application_reopened_by_user_id' as const

/**
 * Fields that must be answered before Submit for review is allowed, with the
 * label used in the "still needed" list. Anything not here is genuinely
 * optional — a trade account should not be blocked on a mobile number.
 *
 * Payment terms and pay run days are required despite feeling like detail:
 * they are the whole reason we ask before quoting.
 */
export const REQUIRED_APPLICATION_FIELDS: ReadonlyArray<[ApplicationField, string]> = [
  ['legal_name', 'Registered company name'],
  ['abn', 'ABN'],
  ['head_office_address', 'Head office address'],
  ['director_name', 'Director name'],
  ['director_email', 'Director email'],
  ['finance_contact_name', 'Accounts contact name'],
  ['finance_contact_email', 'Accounts contact email'],
  ['billing_email', 'Invoice email'],
  ['billing_address', 'Billing address'],
  ['payment_terms', 'Payment terms'],
  ['payment_run_days', 'Payment run days'],
  ['reference1_company', 'Reference 1 — company'],
  ['reference1_contact', 'Reference 1 — contact name'],
  ['reference1_phone', 'Reference 1 — phone'],
  ['reference2_company', 'Reference 2 — company'],
  ['reference2_contact', 'Reference 2 — contact name'],
  ['reference2_phone', 'Reference 2 — phone'],
]

type ApplicationSource = Partial<Record<ApplicationField, unknown>>

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim())
}

/** Labels of the required fields still unanswered, in form order. */
export function missingApplicationFields(account: ApplicationSource): string[] {
  return REQUIRED_APPLICATION_FIELDS.filter(([field]) => isBlank(account[field])).map(
    ([, label]) => label
  )
}

export function isApplicationComplete(account: ApplicationSource): boolean {
  return missingApplicationFields(account).length === 0
}

/** True once the client has submitted and before staff reopen it. */
export function isApplicationLocked(
  account: Pick<ClientAccount, 'application_submitted_at'> | { application_submitted_at?: unknown }
): boolean {
  return !!account.application_submitted_at
}

/*
 * Grouping for display. Used by the staff review card so it reads back in the
 * same order the client filled it in, which makes checking submitted details
 * against a credit report far less error-prone than an alphabetical dump.
 */
export const APPLICATION_SECTIONS: ReadonlyArray<{
  title: string
  fields: ReadonlyArray<[ApplicationField, string]>
}> = [
  {
    title: 'Company',
    fields: [
      ['legal_name', 'Registered company name'],
      ['trading_as', 'Trading as'],
      ['abn', 'ABN'],
      ['head_office_address', 'Head office address'],
      ['phone', 'Phone'],
    ],
  },
  {
    title: 'Director',
    fields: [
      ['director_name', 'Name'],
      ['director_email', 'Email'],
      ['director_phone', 'Phone'],
    ],
  },
  {
    title: 'Accounts payable',
    fields: [
      ['finance_contact_name', 'Name'],
      ['finance_contact_title', 'Title'],
      ['finance_contact_email', 'Email'],
      ['finance_contact_phone', 'Phone'],
      ['billing_email', 'Invoice email'],
      ['billing_address', 'Billing address'],
      ['payment_terms', 'Payment terms'],
      ['payment_run_days', 'Payment run days'],
      ['payment_method', 'Payment method'],
      ['purchase_order_required', 'PO required on invoices'],
    ],
  },
  {
    title: 'Trade reference 1',
    fields: [
      ['reference1_company', 'Company'],
      ['reference1_contact', 'Contact'],
      ['reference1_phone', 'Phone'],
      ['reference1_email', 'Email'],
    ],
  },
  {
    title: 'Trade reference 2',
    fields: [
      ['reference2_company', 'Company'],
      ['reference2_contact', 'Contact'],
      ['reference2_phone', 'Phone'],
      ['reference2_email', 'Email'],
    ],
  },
]
