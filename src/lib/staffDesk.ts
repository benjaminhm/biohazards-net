/*
 * What a signed-in session may open.
 * Members (technicians) stay on the phone screen. Everyone else keeps the desk.
 * A missing role means the membership is inactive and the session is logged out.
 */
export type DeskDecision = 'allow' | 'redirect' | 'forbid' | 'signed-out'

/** First screen after the magic link. Members are technicians. Everyone else is the desk. */
export function staffHomePath(role: string | null): string {
  return role === 'member' ? '/tech' : '/'
}

export function decideStaffAccess(role: string | null, pathname: string): DeskDecision {
  if (!role) return 'signed-out'
  if (role !== 'member') return 'allow'
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'allow'
  if (pathname === '/api/me' || pathname === '/api/me/') return 'allow'
  if (pathname === '/api/tech' || pathname.startsWith('/api/tech/')) return 'allow'
  if (pathname.startsWith('/api/')) return 'forbid'
  return 'redirect'
}
