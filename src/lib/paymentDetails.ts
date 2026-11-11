/*
 * lib/paymentDetails.ts
 *
 * The bank account clients are told to pay into (shown on the pay step after
 * a quote is signed). Kept in its own table, org_payment_details, away from
 * company_profile: that row is readable by the public website and writable by
 * any signed-in staff member, and this must be neither. Only admins can change
 * it (see /api/payment-details), and who changed it last is recorded.
 *
 * Server only.
 */
import type { createServiceClient } from '@/lib/supabase'
import { cleanBankDetails } from '@/lib/signing/pay'
import type { BankDetails } from '@/lib/signing/pay'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface SavedBankDetails {
  details: BankDetails | null
  updatedAt: string | null
}

/**
 * The organisation's bank details, or null when none are saved (or what is
 * saved is not a whole, valid account: a client is never shown half of one).
 */
export async function loadBankDetails(supabase: ServiceClient, orgId: string): Promise<SavedBankDetails> {
  const { data, error } = await supabase
    .from('org_payment_details')
    .select('account_name, bsb, account_number, updated_at')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error || !data) return { details: null, updatedAt: null }
  const cleaned = cleanBankDetails({
    accountName: data.account_name,
    bsb: data.bsb,
    accountNumber: data.account_number,
  })
  return {
    details: cleaned.ok ? cleaned.details : null,
    updatedAt: (data.updated_at as string | null) ?? null,
  }
}

/** Save (or, with null, clear) the bank details. The caller has already checked the person is an admin. */
export async function saveBankDetails(
  supabase: ServiceClient,
  orgId: string,
  details: BankDetails | null,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('org_payment_details').upsert(
    {
      org_id: orgId,
      account_name: details?.accountName ?? '',
      bsb: details?.bsb ?? '',
      account_number: details?.accountNumber ?? '',
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  )
  if (error) {
    const notMigrated = /does not exist|schema cache/i.test(error.message)
    return { ok: false, error: notMigrated ? 'Payment details are not set up yet: migration 070 needs to be applied.' : error.message }
  }
  return { ok: true }
}
