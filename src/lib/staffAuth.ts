/*
 * lib/staffAuth.ts
 *
 * Drop-in replacement for Clerk's auth(). Returns the staff user id from the
 * bh_staff cookie, and only when that id is still STAFF_USER_ID.
 */
import { cookies } from 'next/headers'
import { STAFF_COOKIE, verifyStaffToken } from '@/lib/staffSession'
import { staffUserId } from '@/lib/staffLogin'

export async function auth(): Promise<{ userId: string | null }> {
  const expected = staffUserId()
  if (!expected) return { userId: null }

  const jar = await cookies()
  const raw = jar.get(STAFF_COOKIE)?.value
  if (!raw) return { userId: null }

  const claims = await verifyStaffToken(raw)
  if (!claims || claims.userId !== expected) return { userId: null }
  return { userId: claims.userId }
}
