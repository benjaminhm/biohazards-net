/*
 * lib/staffAuth.ts
 *
 * Drop-in replacement for Clerk's auth(). Returns the staff user id from the
 * bh_staff cookie when that person still has an active org membership.
 * An inactive membership is treated as logged out.
 */
import { cookies } from 'next/headers'
import { STAFF_COOKIE, verifyStaffToken } from '@/lib/staffSession'
import { resolveActiveMembership } from '@/lib/membership'

export async function auth(): Promise<{ userId: string | null }> {
  const jar = await cookies()
  const raw = jar.get(STAFF_COOKIE)?.value
  if (!raw) return { userId: null }

  const claims = await verifyStaffToken(raw)
  if (!claims) return { userId: null }

  try {
    const resolved = await resolveActiveMembership(claims.userId)
    if (!resolved.membership) return { userId: null }
  } catch {
    return { userId: null }
  }
  return { userId: claims.userId }
}
