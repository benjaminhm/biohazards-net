/*
 * lib/twilioSender.ts
 *
 * Server-side resolution of approved Twilio/ACMA Alphanumeric Sender IDs for
 * one-way transactional SMS (e.g. 'FCQ' for Forensic Cleaning QLD) and shared
 * Twilio error formatting.
 *
 * Alphanumeric Sender IDs are one-way only — recipients cannot reply to them.
 * Two-way staff SMS chat stays on TWILIO_PHONE_NUMBER (/api/sms/send).
 */
import { tradingNameOption } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

/** Twilio / ACMA Alphanumeric Sender ID: 1–11 chars, alphanumeric (and space), must include a letter. */
const ALPHANUMERIC_SENDER_RE = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 ]{0,10}$/

/**
 * Return the approved Alphanumeric Sender ID for a job's trading name, or null
 * if that brand does not have one approved yet.
 *
 * Checks `TWILIO_<SHORT>_SENDER_ID` (e.g. `TWILIO_FCQ_SENDER_ID`) first so an
 * env var can override or disable (if set to empty string) without a code
 * deploy, then falls back to `smsSenderId` on the brand in `tradingNames.ts`.
 */
export function resolveBrandSmsSenderId(
  tradingName: TradingNameId | null | undefined,
): string | null {
  const option = tradingNameOption(tradingName)
  if (!option) return null

  const envKey = `TWILIO_${option.short.toUpperCase()}_SENDER_ID`
  const envVal = process.env[envKey]
  const raw = envVal !== undefined ? envVal.trim() : (option.smsSenderId?.trim() ?? '')
  if (!raw) return null
  return ALPHANUMERIC_SENDER_RE.test(raw) ? raw : null
}

/** Twilio Node SDK throws RestException-like objects with code, message, status. */
export function formatTwilioSendError(err: unknown, fromSender?: string): string {
  if (err && typeof err === 'object') {
    const o = err as { code?: number; message?: string; status?: number }
    const msg = o.message ?? ''
    const code = o.code
    const status = o.status

    if (status === 401 || msg === 'Authenticate' || code === 20003) {
      return 'Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.'
    }
    if (code === 21211) {
      return 'The recipient mobile number is not valid. Check the number and try again.'
    }
    if (code === 21614) {
      return 'This number cannot receive SMS (it may be a landline). Enter a mobile number.'
    }
    if (code === 21212 || code === 21612 || /invalid.*from|from.*invalid|alphanumeric/i.test(msg)) {
      const label = fromSender ? `"${fromSender}"` : 'this Sender ID'
      return `Twilio rejected Sender ID ${label}${code ? ` (Twilio ${code})` : ''}. Check that it matches the approved Alphanumeric Sender ID in Twilio Console.`
    }
    if (code === 21608 || /unverified/i.test(msg)) {
      return 'Twilio trial accounts can only text verified numbers. Verify the destination in Twilio Console or upgrade the account.'
    }
    if (msg) return code ? `${msg} (Twilio ${code})` : msg
  }
  if (err instanceof Error) return err.message
  return 'Failed to send SMS'
}
