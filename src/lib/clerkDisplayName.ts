/*
 * Snapshot names for audit columns on create/update (Clerk).
 */
import { clerkClient } from '@clerk/nextjs/server'

/** First name for progress note attribution; fallback to email local-part. */
export async function getClerkFirstName(userId: string): Promise<string> {
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const fn = user.firstName?.trim()
    if (fn) return fn
    const email = user.emailAddresses[0]?.emailAddress
    if (email) return email.split('@')[0] ?? 'User'
    return 'User'
  } catch {
    return 'User'
  }
}
