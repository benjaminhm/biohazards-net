/*
 * lib/photoUploadLink.ts
 *
 * Temporary phone upload links for a job's photo folder (migration 076). Staff
 * show a QR code on the Photos tab; whoever opens it can add photos to that one
 * job until the link expires or is stopped. The token is the only credential,
 * so it is long and random, and it cannot view, change or delete anything.
 */

export const UPLOAD_LINK_TTL_MS = 2 * 60 * 60 * 1000
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/

export interface UploadLinkRow {
  id: string
  token: string
  org_id: string
  job_id: string
  created_by_person_id: string | null
  created_by_name: string
  expires_at: string
  revoked_at: string | null
}

export type UploadLinkState = 'open' | 'expired' | 'stopped'

export function newUploadToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

export function isUploadTokenShape(v: unknown): v is string {
  return typeof v === 'string' && TOKEN_PATTERN.test(v)
}

export function uploadLinkState(link: Pick<UploadLinkRow, 'expires_at' | 'revoked_at'>, now = Date.now()): UploadLinkState {
  if (link.revoked_at) return 'stopped'
  const expires = Date.parse(link.expires_at)
  return Number.isFinite(expires) && expires > now ? 'open' : 'expired'
}

/**
 * The address the QR code opens. On the live site it is the photo host's short
 * path; anywhere else (local, preview) it is the same origin's /photo path.
 */
export function uploadLinkUrl(token: string, appOrigin: string): string {
  let host = ''
  try {
    host = new URL(appOrigin).hostname
  } catch {}
  if (host === 'app.biohazards.net' || host === 'biohazards.net') return `https://photo.biohazards.net/drop/${token}`
  return `${appOrigin.replace(/\/$/, '')}/photo/drop/${token}`
}
