/*
 * lib/xero/contacts.ts
 *
 * Reading contacts from Xero for the staff check on a signed quote: who in
 * Xero might already be the person who signed, and who the job's invoice is
 * made out to now. Reads only. A contact is created in one place, the invoice
 * sync (lib/xero/sync.ts), and only when a person has asked for it.
 */
import type { createServiceClient } from '@/lib/supabase'
import { xeroRequest, type XeroConnection } from '@/lib/xero/client'
import { rankContacts, type ContactCandidate, type XeroContactLite } from '@/lib/xero/invoice'

type Supabase = ReturnType<typeof createServiceClient>

/**
 * Contacts in Xero that match the signer's email or one of the names given
 * (their own, and the company's when they signed for one). Throws when Xero
 * cannot be reached, so the caller can say the list is not available rather
 * than show an empty one.
 */
export async function findContactCandidates(
  supabase: Supabase,
  conn: XeroConnection,
  who: { email: string; names: string[] },
): Promise<ContactCandidate[]> {
  const terms = [...new Set([who.email, ...who.names].map(t => t.trim()).filter(Boolean))]
  const found: XeroContactLite[] = []
  for (const term of terms) {
    const res = await xeroRequest<{ Contacts?: XeroContactLite[] }>(
      supabase, conn, 'GET', `/Contacts?searchTerm=${encodeURIComponent(term)}`,
    )
    found.push(...(res.Contacts ?? []))
  }
  return rankContacts(found, who)
}

/** One contact's name and email, or null when Xero does not have it (or cannot be reached). */
export async function loadContact(
  supabase: Supabase,
  conn: XeroConnection,
  contactId: string,
): Promise<{ id: string; name: string; email: string; archived: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) return null
  try {
    const res = await xeroRequest<{ Contacts?: XeroContactLite[] }>(supabase, conn, 'GET', `/Contacts/${contactId}`)
    const c = res.Contacts?.[0]
    if (!c?.ContactID) return null
    return {
      id: c.ContactID,
      name: (c.Name ?? '').trim(),
      email: (c.EmailAddress ?? '').trim(),
      archived: c.ContactStatus === 'ARCHIVED',
    }
  } catch {
    return null
  }
}
