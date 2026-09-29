import { proseHasPrintableContent } from '@/lib/richTextPrint'

/**
 * One engagement agreement for contents clearance and surface cleaning.
 * The contents-clearance copy wins when it has text. Otherwise the surface-cleaning copy is used.
 * An edit is written back to both, so the next quote of either kind starts from the latest text.
 */
export function sharedEngagementAgreement(primary: unknown, secondary: unknown): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const first = text(primary)
  const second = text(secondary)
  if (proseHasPrintableContent(first)) return first
  if (proseHasPrintableContent(second)) return second
  return first || second
}

export function withSharedEngagement<T extends { engagement_agreement: string }>(
  standards: T,
  engagement: string,
): T {
  return { ...standards, engagement_agreement: engagement }
}
