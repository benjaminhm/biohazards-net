/*
 * Snapshot names for audit columns on create/update.
 * Comes from STAFF_DISPLAY_NAME, then the allowlisted email's local-part.
 */
import { staffFirstName } from '@/lib/staffLogin'

export async function getStaffFirstName(_userId: string): Promise<string> {
  return staffFirstName()
}
