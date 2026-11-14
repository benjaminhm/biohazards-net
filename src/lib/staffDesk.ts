/*
 * What a signed-in session may open.
 * The desk is for admins and managers. There are no technician screens, so a
 * member session, or a missing role (inactive membership), is logged out.
 */
export type DeskDecision = 'allow' | 'signed-out'

export function decideStaffAccess(role: string | null): DeskDecision {
  if (!role || role === 'member') return 'signed-out'
  return 'allow'
}
