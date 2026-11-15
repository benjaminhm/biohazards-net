/*
 * lib/email/documentEmail.ts
 *
 * The email a client document goes out in, laid out like a Xero invoice email:
 * the brand name, the document and its reference, the message staff wrote, a
 * summary card, a button to open the document, optional pay buttons, the
 * other documents with a View link each, and the brand's phone and email.
 * Built for the Statement of Accounts first; quotes and agreements can use the
 * same layout.
 *
 * The message is written or approved by a person in the send window
 * (docs/ai-product-principles.md); nothing here writes wording for the client.
 *
 * Email-safe: tables and inline styles only, no scripts or images, dark text
 * on white, 560px wide at most. Pure: no network, so it can be tested.
 */

export interface DocumentEmailRow {
  label: string
  value: string
  /** The figure the client most needs, e.g. the balance due. */
  strong?: boolean
}

export interface DocumentEmailLink {
  label: string
  href: string
}

export interface DocumentEmailDocument {
  name: string
  href: string
  /** A short line under the name, e.g. "PDF attached". */
  note?: string
}

export interface DocumentEmailInput {
  brandLabel: string
  /** "Statement of Accounts". */
  title: string
  /** "SOA-20261114-9207". Shown with the title. */
  reference?: string | null
  /** Written or approved by staff. Blank lines separate paragraphs. */
  message: string
  /** Shown by some mail apps beside the subject. */
  preheader?: string
  summary?: DocumentEmailRow[]
  primary: DocumentEmailLink
  /** Pay buttons, one per invoice. Links that are not web addresses are left out. */
  secondary?: DocumentEmailLink[]
  /** Short lines under the pay buttons, e.g. why an invoice has no pay link yet. */
  notes?: string[]
  documentsHeading?: string
  documents?: DocumentEmailDocument[]
  /** Under the copy-this-link line, e.g. that the link is private and when it stops working. */
  linkNote?: string
  contact?: { phone?: string | null; email?: string | null }
}

export const EMAIL_ACCENT = '#FF6B35'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const TEXT = '#111111'
const MUTED = '#555555'
const RULE = '#e5e5e5'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only web addresses become links; anything else could run or mislead in a mail app. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(href)) return null
  return href
}

function paragraphs(message: string): string {
  return message
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: ${TEXT};">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** A button Outlook draws too: the colour sits on the cell, not only the link. */
function buttonHtml(link: DocumentEmailLink, href: string, kind: 'primary' | 'secondary'): string {
  const primary = kind === 'primary'
  const cell = primary
    ? `background-color: ${EMAIL_ACCENT}; border-radius: 8px;`
    : `background-color: #ffffff; border: 2px solid ${EMAIL_ACCENT}; border-radius: 8px;`
  const colour = primary ? '#ffffff' : TEXT
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate;">
<tr><td align="center" ${primary ? `bgcolor="${EMAIL_ACCENT}" ` : ''}style="${cell}">
<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display: block; padding: ${primary ? '14px' : '12px'} 20px; font-family: ${FONT}; font-size: 15px; font-weight: 700; line-height: 1.3; color: ${colour}; text-decoration: none; border-radius: 8px;">${escapeHtml(link.label)}</a>
</td></tr></table>`
}

function summaryHtml(rows: DocumentEmailRow[]): string {
  const body = rows.map((row, i) => {
    const top = i === 0 ? '' : `border-top: 1px solid ${RULE};`
    const size = row.strong ? '20px' : '15px'
    const weight = row.strong ? '700' : '400'
    return `<tr>
<td style="${top} padding: 12px 16px; font-family: ${FONT}; font-size: 14px; line-height: 1.4; color: ${row.strong ? TEXT : MUTED}; font-weight: ${row.strong ? '700' : '400'};">${escapeHtml(row.label)}</td>
<td align="right" style="${top} padding: 12px 16px; font-family: ${FONT}; font-size: ${size}; line-height: 1.3; color: ${TEXT}; font-weight: ${weight}; white-space: nowrap;">${escapeHtml(row.value)}</td>
</tr>`
  }).join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate; border: 1px solid ${RULE}; border-radius: 10px; background-color: #fafafa; margin: 8px 0 24px;">${body}</table>`
}

function documentsHtml(heading: string, docs: { doc: DocumentEmailDocument; href: string }[]): string {
  const rows = docs.map(({ doc, href }, i) => `<tr>
<td style="${i === 0 ? '' : `border-top: 1px solid ${RULE};`} padding: 12px 0; font-family: ${FONT}; font-size: 14px; line-height: 1.4; color: ${TEXT};">
<div style="font-weight: 600;">${escapeHtml(doc.name)}</div>${doc.note ? `<div style="font-size: 12px; color: ${MUTED}; margin-top: 2px;">${escapeHtml(doc.note)}</div>` : ''}
</td>
<td align="right" style="${i === 0 ? '' : `border-top: 1px solid ${RULE};`} padding: 12px 0 12px 12px; font-family: ${FONT}; font-size: 14px; white-space: nowrap;">
<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="color: ${TEXT}; font-weight: 700; text-decoration: underline;">View</a>
</td>
</tr>`).join('')
  return `<div style="margin: 28px 0 0; font-family: ${FONT}; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${MUTED};">${escapeHtml(heading)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 4px;">${rows}</table>`
}

function contactParts(contact: DocumentEmailInput['contact']): { phone: string; email: string } {
  return { phone: contact?.phone?.trim() ?? '', email: contact?.email?.trim() ?? '' }
}

export function documentEmailHeading(input: Pick<DocumentEmailInput, 'title' | 'reference'>): string {
  const ref = input.reference?.trim()
  return ref ? `${input.title} ${ref}` : input.title
}

export function renderDocumentEmailHtml(input: DocumentEmailInput): string {
  const primaryHref = safeHref(input.primary.href)
  const secondary = (input.secondary ?? []).flatMap(link => {
    const href = safeHref(link.href)
    return href ? [{ link, href }] : []
  })
  const docs = (input.documents ?? []).flatMap(doc => {
    const href = safeHref(doc.href)
    return href ? [{ doc, href }] : []
  })
  const { phone, email } = contactParts(input.contact)
  const phoneHref = phone.replace(/[^\d+]/g, '')
  const contactLine = [
    phone ? `<a href="tel:${escapeHtml(phoneHref)}" style="color: ${MUTED}; text-decoration: none;">${escapeHtml(phone)}</a>` : '',
    email ? `<a href="mailto:${escapeHtml(email)}" style="color: ${MUTED}; text-decoration: none;">${escapeHtml(email)}</a>` : '',
  ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ')
  const preheader = input.preheader?.trim()

  const blocks: string[] = []
  blocks.push(paragraphs(input.message))
  if (input.summary?.length) blocks.push(summaryHtml(input.summary))
  if (primaryHref) blocks.push(`<div style="margin: 0 0 12px;">${buttonHtml(input.primary, primaryHref, 'primary')}</div>`)
  for (const { link, href } of secondary) blocks.push(`<div style="margin: 0 0 10px;">${buttonHtml(link, href, 'secondary')}</div>`)
  for (const note of input.notes ?? []) {
    blocks.push(`<p style="margin: 4px 0 10px; font-family: ${FONT}; font-size: 13px; line-height: 1.5; color: ${MUTED};">${escapeHtml(note)}</p>`)
  }
  if (docs.length) blocks.push(documentsHtml(input.documentsHeading ?? 'Documents', docs))
  if (primaryHref) {
    blocks.push(`<p style="margin: 28px 0 0; font-family: ${FONT}; font-size: 13px; line-height: 1.6; color: ${MUTED};">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(primaryHref)}" style="color: ${MUTED}; word-break: break-all;">${escapeHtml(primaryHref)}</a></p>`)
  }
  if (input.linkNote?.trim()) {
    blocks.push(`<p style="margin: 12px 0 0; font-family: ${FONT}; font-size: 13px; line-height: 1.6; color: ${MUTED};">${escapeHtml(input.linkNote.trim())}</p>`)
  }

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(documentEmailHeading(input))}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; -webkit-text-size-adjust: 100%;">
${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #f4f4f4;">${escapeHtml(preheader)}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f4f4f4" style="background-color: #f4f4f4;">
<tr><td align="center" style="padding: 24px 12px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff" style="max-width: 560px; background-color: #ffffff; border-top: 4px solid ${EMAIL_ACCENT}; border-radius: 4px;">
<tr><td style="padding: 28px 24px 8px; font-family: ${FONT};">
<div style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${TEXT};">${escapeHtml(input.brandLabel)}</div>
<h1 style="margin: 14px 0 20px; font-family: ${FONT}; font-size: 22px; line-height: 1.3; font-weight: 700; color: ${TEXT};">${escapeHtml(input.title)}${input.reference?.trim() ? ` <span style="font-weight: 400; color: ${MUTED};">${escapeHtml(input.reference.trim())}</span>` : ''}</h1>
</td></tr>
<tr><td style="padding: 0 24px 28px; font-family: ${FONT};">
${blocks.join('\n')}
</td></tr>
<tr><td style="padding: 18px 24px 24px; border-top: 1px solid ${RULE}; font-family: ${FONT}; font-size: 12px; line-height: 1.6; color: ${MUTED};">
<div style="font-weight: 700; color: ${TEXT};">${escapeHtml(input.brandLabel)}</div>
${contactLine ? `<div>${contactLine}</div>` : ''}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`
}

export function renderDocumentEmailText(input: DocumentEmailInput): string {
  const lines: string[] = [input.brandLabel, documentEmailHeading(input), '', input.message.replace(/\r\n/g, '\n').trim()]
  if (input.summary?.length) {
    lines.push('')
    for (const row of input.summary) lines.push(`${row.label}: ${row.value}`)
  }
  const primaryHref = safeHref(input.primary.href)
  if (primaryHref) lines.push('', `${input.primary.label}: ${primaryHref}`)
  for (const link of input.secondary ?? []) {
    const href = safeHref(link.href)
    if (href) lines.push('', `${link.label}: ${href}`)
  }
  for (const note of input.notes ?? []) lines.push('', note)
  const docs = (input.documents ?? []).filter(doc => safeHref(doc.href))
  if (docs.length) {
    lines.push('', `${input.documentsHeading ?? 'Documents'}:`)
    for (const doc of docs) lines.push(`- ${doc.name}${doc.note ? ` (${doc.note})` : ''}: ${safeHref(doc.href)}`)
  }
  if (input.linkNote?.trim()) lines.push('', input.linkNote.trim())
  const { phone, email } = contactParts(input.contact)
  lines.push('', input.brandLabel)
  const contact = [phone, email].filter(Boolean).join(' · ')
  if (contact) lines.push(contact)
  return lines.join('\n')
}

export function renderDocumentEmail(input: DocumentEmailInput): { html: string; text: string } {
  return { html: renderDocumentEmailHtml(input), text: renderDocumentEmailText(input) }
}
