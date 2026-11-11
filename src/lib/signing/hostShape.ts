/*
 * lib/signing/hostShape.ts
 *
 * The two facts the proxy needs about client document links. Kept apart from
 * core.ts so the proxy, which runs on every request, does not load the rest of
 * the signing code.
 */

/** A link token is 32 random bytes in URL-safe base64: always 43 characters. */
export function isSigningTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/** Sent on the home page of a document host, so the app can tell the host is connected. */
export const DOCUMENT_HOST_HEADER = 'x-bh-document-host'
