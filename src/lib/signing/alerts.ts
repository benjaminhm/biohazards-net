/**
 * Staff alert wording for a client's signing link. Fixed text, never AI
 * (docs/ai-product-principles.md). These go to the team only, not the client.
 */

export interface OpenedAlertInput {
  clientName: string
  clientEmail: string | null
  /** For example "Biohazard Cleaning Quote BCQ-104" or two quotes joined. */
  documentLine: string
  /** Inc GST. Null when the link carries no total. */
  total: number | null
  siteAddress: string
  jobUrl: string
}

function totalText(total: number | null): string {
  if (total == null || !Number.isFinite(total)) return ''
  return ` $${total.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function who(input: Pick<OpenedAlertInput, 'clientName' | 'clientEmail'>): string {
  const name = input.clientName.trim() || 'The client'
  return input.clientEmail ? `${name} (${input.clientEmail})` : name
}

/** The text message, the first time the client opens the link. */
export function openedAlertSms(input: OpenedAlertInput): string {
  return `Quote opened: ${who(input)} — ${input.documentLine}${totalText(input.total)}${input.siteAddress ? ` — ${input.siteAddress}` : ''}. Not signed yet. ${input.jobUrl}`
}

/** The email subject. */
export function openedAlertSubject(input: Pick<OpenedAlertInput, 'clientName' | 'documentLine'>): string {
  return `Quote opened — ${input.clientName.trim() || 'Client'} — ${input.documentLine}`
}

/** The email's plain text. */
export function openedAlertText(input: OpenedAlertInput): string {
  return `${who(input)} opened ${input.documentLine}${totalText(input.total)}. It is not signed yet.${input.siteAddress ? `\n\n${input.siteAddress}` : ''}\n\n${input.jobUrl}`
}
