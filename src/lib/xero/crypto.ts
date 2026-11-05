/*
 * lib/xero/crypto.ts
 *
 * AES-256-GCM for Xero tokens at rest. XERO_TOKEN_KEY is 32 bytes, given as
 * 64 hex characters or base64. Stored form: v1:<iv b64>:<tag b64>:<cipher b64>.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function keyFrom(raw: string | undefined): Buffer {
  const value = raw?.trim() ?? ''
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('XERO_TOKEN_KEY must be 32 bytes (64 hex characters or base64)')
  return key
}

export function encryptToken(plain: string, rawKey = process.env.XERO_TOKEN_KEY): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(rawKey), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':')
}

export function decryptToken(stored: string, rawKey = process.env.XERO_TOKEN_KEY): string {
  const [version, iv, tag, body] = stored.split(':')
  if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('Unrecognised token format')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(rawKey), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
}
