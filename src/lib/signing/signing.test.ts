import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import { emptySurfaceAreaCleaningCapture, surfaceAreaCleaningQuoteContent } from '@/lib/surfaceAreaCleaningQuote'
import {
  PASSCODE_ALPHABET,
  PASSCODE_MAX_ATTEMPTS,
  SIGNATURE_MAX_BYTES,
  buildSigningLinks,
  cleanSignerName,
  defaultMessage,
  defaultSubject,
  docketHtml,
  hashSigningTokenSafe,
  insertAtBodyEnd,
  isEmail,
  isUnlocked,
  linkMessage,
  linkState,
  messageToHtml,
  paymentReadyMessage,
  newPasscode,
  newSigningToken,
  normalizePasscode,
  passcodeAttempt,
  resolveSender,
  sha256Hex,
  signaturePngError,
  signedDateLabel,
  signerNameError,
  signingExpiry,
  unlockCookieName,
  unlockCookieValue,
} from '@/lib/signing/core'
import { fillSignSlots, hasSignSlots, signatureBlockHtml } from '@/lib/signing/slots'
import { passcodeGatePage, payPanelHtml, signedViewHtml, signingShellHtml } from '@/lib/signing/shell'
import {
  cleanBankDetails,
  depositAmount,
  depositPartPaid,
  depositSettled,
  parseDepositPercent,
  payStage,
  paymentReference,
  signedNext,
  staffCheckNote,
  type PayPanel,
  type StaffInvoiceView,
} from '@/lib/signing/pay'
import { xeroPayUrl } from '@/lib/xero/payments'
import { documentHostTradingName } from '@/lib/tradingNames'

/** A PNG data URL of roughly the given size (valid header, filler body). */
function png(bytes = 400): string {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return `data:image/png;base64,${Buffer.concat([magic, Buffer.alloc(bytes, 7)]).toString('base64')}`
}

function quoteHtml(client: Record<string, unknown>): string {
  const content = surfaceAreaCleaningQuoteContent({
    reference: 'SACQ-TEST',
    clientName: 'Acme Pty Ltd',
    siteAddress: '1 Example Street',
    capture: { ...emptySurfaceAreaCleaningCapture(), estimated_m2: 20, rate_per_m2: 50 },
  })
  return buildPrintHTML(
    'surface_area_cleaning_quote',
    content as unknown as Record<string, unknown>,
    [], [], null, 'job', 'http://localhost', client, { screenActionBar: false },
  )
}

test('the link carries the token and only its hash is kept', () => {
  const a = newSigningToken()
  const b = newSigningToken()
  assert.notEqual(a.token, b.token)
  assert.equal(a.hash, sha256Hex(a.token))
  assert.equal(hashSigningTokenSafe(a.token), a.hash)
  assert.doesNotMatch(a.hash, new RegExp(a.token))
})

test('anything that is not a token is turned away before the database is asked', () => {
  assert.equal(hashSigningTokenSafe(''), null)
  assert.equal(hashSigningTokenSafe('short'), null)
  assert.equal(hashSigningTokenSafe(`${'a'.repeat(42)}/`), null)
  assert.equal(hashSigningTokenSafe('a'.repeat(44)), null)
})

test('a link is open until it is signed, declined, cancelled or 30 days old', () => {
  const sent = new Date('2026-11-11T00:00:00Z')
  const expires_at = signingExpiry(sent).toISOString()
  assert.equal(expires_at, '2026-12-11T00:00:00.000Z')
  assert.equal(linkState({ status: 'sent', expires_at }, new Date('2026-11-20T00:00:00Z')), 'open')
  assert.equal(linkState({ status: 'viewed', expires_at }, new Date('2026-12-10T23:59:59Z')), 'open')
  assert.equal(linkState({ status: 'viewed', expires_at }, new Date('2026-12-11T00:00:00Z')), 'expired')
  assert.equal(linkState({ status: 'signed', expires_at }, new Date('2027-06-01T00:00:00Z')), 'signed')
  assert.equal(linkState({ status: 'declined', expires_at }, sent), 'declined')
  assert.equal(linkState({ status: 'voided', expires_at }, sent), 'voided')
})

test('FCQ quotes go from the FCQ address and replies come back to it', () => {
  const sender = resolveSender('forensic_cleaning_qld', { RESEND_FROM_EMAIL: 'shared@example.com' }, 'office@example.com')
  assert.equal(sender.from, 'Forensic Cleaning QLD <admin@forensiccleaningqld.com.au>')
  assert.equal(sender.replyTo, 'admin@forensiccleaningqld.com.au')
  assert.equal(sender.usesBrandAddress, true)
})

test('a brand with no address of its own keeps its name, uses the shared address, and replies go to Settings', () => {
  for (const [id, label] of [
    ['hoarding_cleaning_qld', 'Hoarding Clearance QLD'],
    ['brisbane_biohazard_cleaning', 'Biohazard Cleaning QLD'],
  ] as const) {
    const sender = resolveSender(id, { RESEND_FROM_EMAIL: 'shared@example.com' }, ' office@example.com ')
    assert.equal(sender.from, `${label} <shared@example.com>`)
    assert.equal(sender.replyTo, 'office@example.com')
    assert.equal(sender.usesBrandAddress, false)
  }
  assert.equal(resolveSender('hoarding_cleaning_qld', {}, null).replyTo, null)
})

test('the unverified-domain override changes the address but not the brand name or the reply address', () => {
  const sender = resolveSender(
    'forensic_cleaning_qld',
    { RESEND_FROM_ACCOUNTS: 'accounts@example.com', RESEND_FROM_EMAIL: 'shared@example.com' },
    null,
  )
  assert.equal(sender.from, 'Forensic Cleaning QLD <accounts@example.com>')
  assert.equal(sender.replyTo, 'admin@forensiccleaningqld.com.au')
  assert.equal(sender.usesBrandAddress, false)
})

test('the starting message greets the client by first name and is signed by the brand', () => {
  const message = defaultMessage({
    clientName: 'Jane Smith',
    title: 'Trauma Cleaning',
    siteAddress: '1 Example Street',
    staffFirstName: '',
    brandLabel: 'Forensic Cleaning QLD',
  })
  assert.match(message, /^Hi Jane,/)
  assert.match(message, /Please find our quote for 1 Example Street: Trauma Cleaning\./)
  assert.match(message, /Kind regards,\nForensic Cleaning QLD$/)
})

test('the message is emailed as typed, with anything that looks like HTML made harmless', () => {
  const html = messageToHtml('Hi Jane,\n\nLine one\nLine two <b>bold</b>')
  assert.equal((html.match(/<p /g) ?? []).length, 2)
  assert.match(html, /Line one<br>Line two &lt;b&gt;bold&lt;\/b&gt;/)
})

test('only a real PNG of a sensible size is taken as a signature', () => {
  assert.equal(signaturePngError(png()), null)
  assert.equal(signaturePngError(''), 'Add your signature')
  assert.equal(signaturePngError(null), 'Add your signature')
  assert.equal(signaturePngError(png(10)), 'Add your signature')
  assert.equal(signaturePngError('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), 'Signature image is not valid')
  assert.equal(signaturePngError(`${png()}" onerror="alert(1)`), 'Signature image is not valid')
  assert.equal(signaturePngError(`data:image/png;base64,${Buffer.alloc(400, 1).toString('base64')}`), 'Signature image is not valid')
  assert.equal(signaturePngError(png(SIGNATURE_MAX_BYTES + 1)), 'Signature image is too large')
})

test('a signer name is tidied and must be a name', () => {
  assert.equal(cleanSignerName('  Jane \n\t Smith  '), 'Jane Smith')
  assert.equal(cleanSignerName(42), '')
  assert.equal(signerNameError('J'), 'Enter your full name')
  assert.equal(signerNameError('Jane Smith'), null)
  assert.equal(signerNameError('x'.repeat(121)), 'Name is too long')
})

test('email addresses that could carry a second recipient or a header are refused', () => {
  assert.equal(isEmail('jane@example.com'), true)
  assert.equal(isEmail('jane@example.com, other@example.com'), false)
  assert.equal(isEmail('Jane <jane@example.com>'), false)
  assert.equal(isEmail('jane@example'), false)
})

test('the date on the document is the Brisbane date, not the UTC one', () => {
  // 11 Nov 2026 20:30 UTC is already 12 Nov in Brisbane.
  assert.equal(signedDateLabel('2026-11-11T20:30:00Z'), '12 November 2026')
})

test('a quote sent for signing ends with the three fields instead of the email accept box', () => {
  const html = quoteHtml({ client_name: 'Acme', signatureBlock: true, quoteAcceptDocumentId: 'doc' })
  assert.equal(hasSignSlots(html), true)
  assert.doesNotMatch(html, /quote-accept-form/)
  for (const slot of ['signature', 'name', 'date']) {
    assert.equal(html.split(`data-sign-slot="${slot}"`).length, 2, `${slot} appears once`)
  }
})

test('the ordinary quote link is unchanged: accept box, no signature fields', () => {
  const html = quoteHtml({ client_name: 'Acme', quoteAcceptDocumentId: 'doc' })
  assert.equal(hasSignSlots(html), false)
  assert.match(html, /quote-accept-form/)
  assert.equal(hasSignSlots(quoteHtml({ client_name: 'Acme' })), false)
})

test('signing fills the fields, and a name cannot inject markup', () => {
  const html = quoteHtml({ client_name: 'Acme', signatureBlock: true })
  const signature = png()
  const signed = fillSignSlots(html, { signaturePng: signature, name: 'Jane <script>alert(1)</script> $& Smith', dateLabel: '11 November 2026' })
  assert.match(signed, new RegExp(`data-sign-slot="signature"><img src="${signature.replace(/[+/=]/g, '\\$&')}" alt="Signature"></div>`))
  assert.match(signed, /data-sign-slot="name">Jane &lt;script&gt;alert\(1\)&lt;\/script&gt; \$&amp; Smith<\/div>/)
  assert.match(signed, /data-sign-slot="date">11 November 2026<\/div>/)
  assert.equal(hasSignSlots(signed), false)
  assert.equal(signed.length > html.length, true)
})

test('a document without the fields is never passed off as signed', () => {
  const html = quoteHtml({ client_name: 'Acme' })
  assert.throws(
    () => fillSignSlots(html, { signaturePng: png(), name: 'Jane Smith', dateLabel: '11 November 2026' }),
    /Signature field "signature" is missing/,
  )
  assert.equal(hasSignSlots(signatureBlockHtml()), true)
})

test('the docket records what was signed, by whom and how, with untrusted text escaped', () => {
  const frozen = quoteHtml({ client_name: 'Acme', signatureBlock: true })
  const docket = docketHtml({
    requestId: '11111111-2222-4333-8444-555555555555',
    brandLabel: 'Forensic Cleaning QLD',
    documentTitle: 'Gross Filth and Squalor',
    reference: 'SACQ-TEST',
    docSha256: sha256Hex(frozen),
    fromAddress: 'Forensic Cleaning QLD <admin@forensiccleaningqld.com.au>',
    sentByName: 'Sam',
    toName: 'Jane Smith',
    toEmail: 'jane@example.com',
    deliveryMethod: 'email',
    passcodeVerifiedAt: null,
    signerName: 'Jane <b>Smith</b>',
    signatureMethod: 'typed',
    signaturePng: png(),
    sentAt: '2026-11-11T00:00:00Z',
    firstViewedAt: '2026-11-11T01:00:00Z',
    consentedAt: '2026-11-11T01:00:30Z',
    signedAt: '2026-11-11T01:02:03Z',
    signerIp: '203.0.113.7',
    signerUserAgent: 'Mozilla/5.0 <img src=x onerror=alert(1)>',
  })
  assert.match(docket, new RegExp(sha256Hex(frozen)))
  assert.match(docket, /Forensic Cleaning QLD &lt;admin@forensiccleaningqld\.com\.au&gt;/)
  assert.match(docket, /Jane Smith &lt;jane@example\.com&gt;/)
  assert.match(docket, /Jane &lt;b&gt;Smith&lt;\/b&gt;/)
  assert.match(docket, /Typed and adopted by the signer/)
  assert.match(docket, /11 Nov 2026, 11:02:03 AEST/)
  assert.match(docket, /203\.0\.113\.7/)
  assert.doesNotMatch(docket, /<img src=x/)

  const copy = insertAtBodyEnd(frozen, docket)
  assert.equal(copy.indexOf('class="sign-docket"') > copy.indexOf('id="sign-block"'), true)
  assert.equal(copy.indexOf('class="sign-docket"') < copy.indexOf('id="sow-photo-zoom"'), true)
})

test('the signing page cannot be broken out of by a name', () => {
  const shell = signingShellHtml({
    token: 'A'.repeat(43),
    brandLabel: 'Forensic Cleaning QLD',
    documentTitle: 'Trauma <Cleaning>',
    reference: 'BCQ-1',
    toName: '</script><script>alert(1)</script>',
    toEmail: 'jane@example.com',
    pdfUrl: `/api/sign/${'A'.repeat(43)}/pdf`,
    dateLabel: '11 November 2026',
    consented: false,
    deposit: null,
  })
  assert.doesNotMatch(shell, /<script>alert\(1\)/)
  assert.match(shell, /Trauma &lt;Cleaning&gt; BCQ-1/)
  assert.match(shell, /"toName":"\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e"/)
  assert.match(shell, new RegExp(`/api/sign/${'A'.repeat(43)}/pdf`))
})

test('a passcode is four characters that cannot be misread and never spell a word', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 300; i++) {
    const code = newPasscode()
    assert.match(code, /^[BCDFGHJKMNPQRSTVWXYZ23456789]{4}$/)
    seen.add(code)
  }
  assert.equal(seen.size > 290, true)
  assert.doesNotMatch(PASSCODE_ALPHABET, /[AEIOUL01]/)
})

test('the passcode is read the way people type it: any case, spaces or dashes', () => {
  assert.equal(normalizePasscode(' k7-m4 '), 'K7M4')
  assert.equal(normalizePasscode('k 7 m 4'), 'K7M4')
  assert.equal(normalizePasscode(7), '')
})

test('the right passcode lets the client in and clears the count of wrong tries', () => {
  const now = new Date('2026-11-11T01:00:00Z')
  const result = passcodeAttempt({ passcode: 'K7M4', passcode_attempts: 3, passcode_verified_at: null }, 'k7m4', now)
  assert.deepEqual(result, { ok: true, patch: { passcode_attempts: 0, passcode_verified_at: '2026-11-11T01:00:00.000Z' } })
  // The first time it was entered is what the docket records.
  const again = passcodeAttempt({ passcode: 'K7M4', passcode_attempts: 0, passcode_verified_at: '2026-11-10T00:00:00.000Z' }, 'K7M4', now)
  assert.equal(again.ok && again.patch.passcode_verified_at, '2026-11-10T00:00:00.000Z')
})

test('five wrong passcodes in a row lock the link, and the client is told how many tries are left', () => {
  const now = new Date('2026-11-11T01:00:00Z')
  let attempts = 0
  for (let n = 1; n <= PASSCODE_MAX_ATTEMPTS; n++) {
    const result = passcodeAttempt({ passcode: 'K7M4', passcode_attempts: attempts, passcode_verified_at: null }, 'XXXX', now)
    assert.equal(result.ok, false)
    if (result.ok) return
    attempts = result.patch.passcode_attempts
    assert.equal(attempts, n)
    assert.equal(result.triesLeft, PASSCODE_MAX_ATTEMPTS - n)
    assert.equal(result.locked, n === PASSCODE_MAX_ATTEMPTS)
    assert.equal(result.patch.passcode_locked_at, n === PASSCODE_MAX_ATTEMPTS ? '2026-11-11T01:00:00.000Z' : undefined)
  }
  assert.equal(passcodeAttempt({ passcode: 'K7M4', passcode_attempts: 0, passcode_verified_at: null }, '', now).ok, false)
})

test('a locked link stays shut even after signing, and a cancelled one says cancelled', () => {
  const expires_at = '2026-12-11T00:00:00.000Z'
  const now = new Date('2026-11-20T00:00:00Z')
  const passcode_locked_at = '2026-11-12T00:00:00Z'
  assert.equal(linkState({ status: 'viewed', expires_at, passcode_locked_at }, now), 'locked')
  assert.equal(linkState({ status: 'signed', expires_at, passcode_locked_at }, now), 'locked')
  assert.equal(linkState({ status: 'voided', expires_at, passcode_locked_at }, now), 'voided')
  assert.equal(linkState({ status: 'sent', expires_at, passcode_locked_at: null }, now), 'open')
})

test('a browser is let in only with the cookie made from both the link and the passcode', () => {
  const token = 'A'.repeat(43)
  const name = unlockCookieName(token)
  const good = `other=1; ${name}=${unlockCookieValue(token, 'K7M4')}; x=y`
  assert.equal(isUnlocked(good, token, 'K7M4'), true)
  assert.equal(isUnlocked(null, token, 'K7M4'), false)
  assert.equal(isUnlocked(`${name}=${unlockCookieValue(token, 'K7M5')}`, token, 'K7M4'), false)
  assert.equal(isUnlocked(`${name}=K7M4`, token, 'K7M4'), false)
  // The cookie for one link does not open another.
  const other = 'B'.repeat(43)
  assert.equal(isUnlocked(`${unlockCookieName(other)}=${unlockCookieValue(token, 'K7M4')}`, other, 'K7M4'), false)
  // Links the system emailed have no passcode and need no cookie.
  assert.equal(isUnlocked(null, token, null), true)
  assert.doesNotMatch(name, /A{10}/)
})

test('on a document host the address is just the private code, with no "sign" in it', () => {
  const token = 'A'.repeat(43)
  const branded = buildSigningLinks(token, 'https://app.biohazards.net', 'document.forensiccleaningqld.com.au')
  assert.equal(branded.page, `https://document.forensiccleaningqld.com.au/${token}`)
  assert.equal(branded.pdf, `https://document.forensiccleaningqld.com.au/${token}/pdf`)
  assert.doesNotMatch(branded.page + branded.pdf, /sign/)
  const plain = buildSigningLinks(token, 'https://app.biohazards.net/', null)
  assert.equal(plain.page, `https://app.biohazards.net/sign/${token}`)
  assert.equal(plain.pdf, `https://app.biohazards.net/api/sign/${token}/pdf`)
  assert.equal(plain.host, 'app.biohazards.net')
})

test('each brand has its own document host, and nothing else is treated as one', () => {
  assert.equal(documentHostTradingName('document.forensiccleaningqld.com.au'), 'forensic_cleaning_qld')
  assert.equal(documentHostTradingName('Document.ForensicCleaningQLD.com.au:443'), 'forensic_cleaning_qld')
  assert.equal(documentHostTradingName('document.biohazardcleaningqld.com.au'), 'brisbane_biohazard_cleaning')
  assert.equal(documentHostTradingName('document.hoardingclearanceqld.com.au'), 'hoarding_cleaning_qld')
  assert.equal(documentHostTradingName('biohazardcleaningqld.com.au'), null)
  assert.equal(documentHostTradingName('www.hoardingclearanceqld.com.au'), null)
  assert.equal(documentHostTradingName('accounts.forensiccleaningqld.com.au'), null)
  assert.equal(documentHostTradingName('app.biohazards.net'), null)
  assert.equal(documentHostTradingName(null), null)
})

test('the message to paste has the greeting, the link on its own line, and the passcode', () => {
  const message = linkMessage({
    clientName: 'Jane Smith',
    siteAddress: '1 Example Street',
    staffFirstName: 'Ben',
    brandLabel: 'Forensic Cleaning QLD',
    link: 'https://document.forensiccleaningqld.com.au/abc',
    passcode: 'K7M4',
  })
  assert.equal(message, [
    'Hi Jane, your documents from Forensic Cleaning QLD for 1 Example Street are ready to view here:',
    'https://document.forensiccleaningqld.com.au/abc',
    '',
    'Passcode: K7M4',
    '',
    'Kind regards,',
    'Ben',
  ].join('\n'))
  assert.match(linkMessage({ clientName: '', siteAddress: null, staffFirstName: '', brandLabel: 'Forensic Cleaning QLD', link: 'x', passcode: 'K7M4' }),
    /^Hi there, your documents from Forensic Cleaning QLD are ready to view here:\nx\n\nPasscode: K7M4\n\nKind regards,\nForensic Cleaning QLD$/)
})

test('the docket for a link staff sent themselves claims only what the system saw', () => {
  const docket = docketHtml({
    requestId: '11111111-2222-4333-8444-555555555555',
    brandLabel: 'Forensic Cleaning QLD',
    documentTitle: 'Trauma Cleaning',
    reference: 'BCQ-1',
    docSha256: 'f'.repeat(64),
    fromAddress: 'Forensic Cleaning QLD <admin@forensiccleaningqld.com.au>',
    sentByName: 'Ben',
    toName: 'Jane Smith',
    toEmail: null,
    deliveryMethod: 'link',
    passcodeVerifiedAt: '2026-11-11T01:00:10Z',
    signerName: 'Jane Smith',
    signatureMethod: 'drawn',
    signaturePng: png(),
    sentAt: '2026-11-11T00:00:00Z',
    firstViewedAt: '2026-11-11T01:00:12Z',
    consentedAt: '2026-11-11T01:00:30Z',
    signedAt: '2026-11-11T01:02:03Z',
    signerIp: '203.0.113.7',
    signerUserAgent: 'Mozilla/5.0',
  })
  assert.match(docket, /Private link and passcode, sent to the signer by staff/)
  assert.match(docket, /Private link, opened with a passcode entered by the signer/)
  assert.match(docket, /Passcode entered<\/th><td>11 Nov 2026, 11:00:10 AEST/)
  assert.match(docket, /Prepared by<\/th><td>Ben, Forensic Cleaning QLD/)
  assert.doesNotMatch(docket, /Sent from|Sent to|emailed to the address/)
  assert.doesNotMatch(docket, /K7M4/)
})

test('the passcode screen shows the brand and nothing about the client or the document', () => {
  const gate = passcodeGatePage({ token: 'A'.repeat(43), brandLabel: 'Forensic Cleaning QLD', length: 4 })
  assert.match(gate, /Enter your passcode/)
  assert.match(gate, /Forensic Cleaning QLD/)
  assert.match(gate, /maxlength="4"/)
  assert.doesNotMatch(gate, /sow-root|sign-block/)
})

test('with no client email the signing page offers the download instead of promising an email', () => {
  const shell = signingShellHtml({
    token: 'A'.repeat(43),
    brandLabel: 'Forensic Cleaning QLD',
    documentTitle: 'Trauma Cleaning',
    reference: 'BCQ-1',
    toName: 'Jane Smith',
    toEmail: null,
    pdfUrl: `/${'A'.repeat(43)}/pdf`,
    dateLabel: '11 November 2026',
    consented: false,
    deposit: null,
  })
  assert.match(shell, /<span>For:<\/span> Jane Smith<\/div>/)
  assert.match(shell, /Download your signed copy of Trauma Cleaning BCQ-1 now/)
  assert.doesNotMatch(shell, /emailed to/)
  assert.match(shell, new RegExp(`href="/${'A'.repeat(43)}/pdf"`))
})

// ── View first, then sign, then pay ──────────────────────────────────────────

const TOKEN = 'A'.repeat(43)

function shellFor(deposit: { amountLabel: string; percentLabel: string } | null): string {
  return signingShellHtml({
    token: TOKEN,
    brandLabel: 'Forensic Cleaning QLD',
    documentTitle: 'Trauma Cleaning',
    reference: 'BCQ-1',
    toName: 'Jane Smith',
    toEmail: 'jane@example.com',
    pdfUrl: `/${TOKEN}/pdf`,
    dateLabel: '11 November 2026',
    consented: false,
    deposit,
  })
}

function panel(over: Partial<PayPanel> = {}): PayPanel {
  return {
    brandLabel: 'Forensic Cleaning QLD',
    stage: 'ready',
    percent: 50,
    deposit: 1650,
    total: 3300,
    reference: 'BCQ-1',
    bank: { accountName: 'Example Pty Ltd', bsb: '064-000', accountNumber: '12345678' },
    cardUrl: null,
    invoiceNumber: '',
    paid: 0,
    paidOn: null,
    jobDeposits: 1650,
    ...over,
  }
}

test('what the client is sent asks them to view the document, not to sign it', () => {
  const who = { clientName: 'Jane Smith', siteAddress: '1 Example Street', staffFirstName: 'Ben', brandLabel: 'Forensic Cleaning QLD' }
  const subject = defaultSubject('Forensic Cleaning QLD', 'Trauma Cleaning', 'BCQ-1')
  const message = defaultMessage({ ...who, title: 'Trauma Cleaning' })
  assert.equal(subject, 'Trauma Cleaning BCQ-1 from Forensic Cleaning QLD — ready to view')
  const pasted = linkMessage({ ...who, link: 'https://example.com/x', passcode: 'K7M4' })
  assert.match(subject, /ready to view$/)
  assert.match(message, /You can view it online using the button below\./)
  assert.match(pasted, /are ready to view here:/)
  for (const text of [subject, message, pasted]) assert.doesNotMatch(text, /\bsign/i)
})

test('the document is in view on arrival: nothing covers it until the client chooses to sign', () => {
  const shell = shellFor(null)
  // No overlay is open in the page as served; the script opens the consent one only from "Next: sign".
  assert.doesNotMatch(shell, /class="sg-overlay sg-on"/)
  assert.match(shell, /id="sg-next">Next: sign<\/button>/)
  assert.match(shell, /<li data-step="view" class="sg-now" aria-current="step"><b>1<\/b>View<\/li><li data-step="sign"><b>2<\/b>Sign<\/li><\/ol>/)
  assert.match(shell, /id="sg-consent-h">Sign this document</)
  assert.match(shell, /id="sg-agree-cancel">Not yet</)
  assert.doesNotMatch(shell, /data-step="pay"|id="sg-done-next"|The next step is your deposit/)
})

test('with a deposit the steps end at Pay deposit, and the signed message says there is nothing to pay yet', () => {
  const shell = shellFor({ amountLabel: '$1,650.00', percentLabel: '50%' })
  assert.match(shell, /<li data-step="pay"><b>3<\/b>Pay deposit<\/li><\/ol>/)
  assert.match(shell, /The next step is your deposit of <strong>\$1,650\.00<\/strong> \(50%\)\. There is nothing to pay yet: Forensic Cleaning QLD will check the details, prepare your invoice and let you know when it is ready\./)
  assert.match(shell, /id="sg-done-next">Continue</)
  assert.doesNotMatch(shell, /Next: pay deposit/)
})

test('the deposit percentage is a share of the total, to the cent', () => {
  assert.deepEqual(parseDepositPercent(50), { ok: true, percent: 50 })
  assert.deepEqual(parseDepositPercent(' 33.333 '), { ok: true, percent: 33.33 })
  assert.deepEqual(parseDepositPercent(''), { ok: true, percent: null })
  assert.deepEqual(parseDepositPercent(null), { ok: true, percent: null })
  assert.deepEqual(parseDepositPercent(0), { ok: true, percent: null })
  for (const bad of [101, -1, 'half', '50%', Number.NaN, {}, true]) {
    assert.equal(parseDepositPercent(bad).ok, false, String(bad))
  }
  assert.equal(depositAmount(3300, 50), 1650)
  assert.equal(depositAmount(1234.56, 30), 370.37)
  assert.equal(depositAmount(999.99, 33.33), 333.3)
  assert.equal(depositAmount(3300, 100), 3300)
  assert.equal(depositAmount(3300, null), null)
  assert.equal(depositAmount(null, 50), null)
  assert.equal(depositAmount(0, 50), null)
  assert.equal(depositAmount('abc', 50), null)
})

test('the signed alert tells staff nothing is invoiced until they have checked it', () => {
  const next = 'Nothing has been invoiced yet. Open the job, check who signed and what they accepted on the quote in Documents, then create the invoice from there.'
  assert.equal(
    staffCheckNote(3300, 30),
    `${next} Deposit to ask for: $990.00 (30%). The client sees no payment details until the invoice is approved in Xero.`,
  )
  // No deposit on the link: the check is still needed before anything is invoiced.
  assert.equal(staffCheckNote(3300, null), next)
  assert.equal(staffCheckNote(null, 50), next)
})

test('the client is shown how to pay only after the staff check and an approved invoice', () => {
  // Signed, not checked: nothing to pay with, whatever Xero says.
  for (const invoiceStatus of ['', 'DRAFT', 'AUTHORISED', 'PAID']) {
    assert.equal(payStage({ confirmed: false, xeroConnected: true, invoiceStatus }), 'preparing', invoiceStatus)
  }
  assert.equal(payStage({ confirmed: false, xeroConnected: false, invoiceStatus: '' }), 'preparing')
  // Checked, invoice not approved yet.
  for (const invoiceStatus of ['', 'CLAIMED', 'DRAFT', 'SUBMITTED']) {
    assert.equal(payStage({ confirmed: true, xeroConnected: true, invoiceStatus }), 'preparing', invoiceStatus)
  }
  // Checked and approved.
  assert.equal(payStage({ confirmed: true, xeroConnected: true, invoiceStatus: 'AUTHORISED' }), 'ready')
  assert.equal(payStage({ confirmed: true, xeroConnected: true, invoiceStatus: 'PAID' }), 'ready')
  // Without Xero there is no invoice to wait for: the check opens it.
  assert.equal(payStage({ confirmed: true, xeroConnected: false, invoiceStatus: '' }), 'ready')
  // A voided invoice is not something to pay.
  assert.equal(payStage({ confirmed: true, xeroConnected: true, invoiceStatus: 'VOIDED' }), 'contact')
  assert.equal(payStage({ confirmed: true, xeroConnected: true, invoiceStatus: 'DELETED' }), 'contact')
})

test('under a signed quote staff are given one next step at a time', () => {
  const xero = (over: Partial<StaffInvoiceView> = {}): StaffInvoiceView => ({
    xeroConnected: true, number: '', status: '', amountPaid: 0, paidOn: null, payLinkLive: false, ...over,
  })
  const ask = { total: 3300, percent: 50 }

  const unchecked = signedNext({ confirmed: false, ...ask, invoice: xero() })
  assert.equal(unchecked.needsCheck, true)
  assert.equal(unchecked.canSendPayMessage, false)
  assert.match(unchecked.text, /^Not invoiced yet\. Check who signed and what they accepted, then create the invoice in Xero\./)
  assert.match(signedNext({ confirmed: false, ...ask, invoice: xero({ xeroConnected: false }) }).text, /then mark it as checked\./)

  // Staff who are not shown money cannot do the check, and are told who does.
  const teamLead = signedNext({ confirmed: false, total: null, percent: 50, invoice: null })
  assert.equal(teamLead.needsCheck, false)
  assert.equal(teamLead.text, 'Waiting for the office to check this and create the invoice.')
  assert.equal(signedNext({ confirmed: true, total: null, percent: 50, invoice: null }).text, '')

  const missing = signedNext({ confirmed: true, ...ask, invoice: xero() })
  assert.equal(missing.canCreateInvoice, true)
  assert.match(missing.text, /the Xero invoice has not been created yet/)

  const draft = signedNext({ confirmed: true, ...ask, invoice: xero({ status: 'DRAFT', number: 'INV-0042' }) })
  assert.equal(draft.tone, 'todo')
  assert.equal(draft.canSendPayMessage, false)
  assert.equal(draft.text, "Deposit to ask for: $1,650.00 (50%). Next: in Xero, set the deposit request to 50% on draft invoice INV-0042 and approve it. The client's page then shows how to pay.")

  const approved = signedNext({ confirmed: true, ...ask, invoice: xero({ status: 'AUTHORISED', number: 'INV-0042', payLinkLive: true }) })
  assert.equal(approved.canSendPayMessage, true)
  assert.equal(approved.text, "Deposit asked: $1,650.00 (50%). Invoice INV-0042 is approved, and the client's page now shows how to pay, by card or bank transfer. Nothing received yet.")

  const paid = signedNext({ confirmed: true, ...ask, invoice: xero({ status: 'AUTHORISED', number: 'INV-0042', amountPaid: 1650, paidOn: '2026-11-12' }) })
  assert.equal(paid.tone, 'good')
  assert.equal(paid.canSendPayMessage, false)
  assert.equal(paid.text, 'Deposit received: $1,650.00 paid on invoice INV-0042 (12/11/2026). Asked for $1,650.00 (50%).')

  const noXero = signedNext({ confirmed: true, ...ask, invoice: xero({ xeroConnected: false }) })
  assert.equal(noXero.canSendPayMessage, true)
  assert.match(noXero.text, /Xero is not connected, so there is no invoice; the client's page shows the bank details\./)

  const voided = signedNext({ confirmed: true, ...ask, invoice: xero({ status: 'VOIDED', number: 'INV-0042' }) })
  assert.equal(voided.canSendPayMessage, false)
  assert.match(voided.text, /Invoice INV-0042 was voided in Xero, so the client's page shows no way to pay\./)

  // No deposit on the link: the invoice still needs the check, but there is no pay message.
  const noDeposit = signedNext({ confirmed: true, total: 3300, percent: null, invoice: xero({ status: 'AUTHORISED', number: 'INV-0042' }) })
  assert.equal(noDeposit.canSendPayMessage, false)
  assert.equal(noDeposit.text, 'Invoice INV-0042 is approved in Xero.')
})

test('the ready-to-pay message has the amount, the link on its own line, and the passcode when there is one', () => {
  const base = {
    clientName: 'Jane Smith', brandLabel: 'Forensic Cleaning QLD', staffFirstName: 'Ben',
    depositLabel: '$1,650.00', link: 'https://document.forensiccleaningqld.com.au/abc', card: true, bank: true,
  }
  assert.equal(paymentReadyMessage({ ...base, passcode: 'K7M4' }), [
    'Hi Jane, thank you for signing. Your deposit of $1,650.00 to Forensic Cleaning QLD is ready to pay by card or bank transfer here:',
    'https://document.forensiccleaningqld.com.au/abc',
    '',
    'Passcode: K7M4',
    '',
    'Kind regards,',
    'Ben',
  ].join('\n'))
  // A link the system emailed has no passcode, and only the ways to pay that exist are named.
  const emailed = paymentReadyMessage({ ...base, passcode: null, card: false, staffFirstName: '' })
  assert.doesNotMatch(emailed, /Passcode|card/)
  assert.match(emailed, /is ready to pay by bank transfer here:\nhttps:/)
  assert.match(emailed, /Kind regards,\nForensic Cleaning QLD$/)
})

test('bank details are saved whole or not at all', () => {
  assert.deepEqual(cleanBankDetails({ accountName: '  Example  Pty Ltd ', bsb: '064 000', accountNumber: '1234-5678' }), {
    ok: true,
    details: { accountName: 'Example Pty Ltd', bsb: '064-000', accountNumber: '12345678' },
  })
  assert.deepEqual(cleanBankDetails({ accountName: '', bsb: ' ', accountNumber: '' }), { ok: true, details: null })
  assert.deepEqual(cleanBankDetails(null), { ok: true, details: null })
  assert.equal(cleanBankDetails({ accountName: 'Example Pty Ltd', bsb: '06400', accountNumber: '12345678' }).ok, false)
  assert.equal(cleanBankDetails({ accountName: 'Example Pty Ltd', bsb: '064-000', accountNumber: '123' }).ok, false)
  assert.equal(cleanBankDetails({ accountName: 'Example Pty Ltd', bsb: '064-000', accountNumber: '12345678901' }).ok, false)
  assert.equal(cleanBankDetails({ accountName: '', bsb: '064-000', accountNumber: '12345678' }).ok, false)
  assert.equal(cleanBankDetails({ accountName: 'Example Pty Ltd', bsb: '064-00A', accountNumber: '12345678' }).ok, false)
})

test('the payment reference is the quote reference, short enough for a bank', () => {
  assert.equal(paymentReference('BCQ-2026-0042', 'Jane Smith'), 'BCQ-2026-0042')
  assert.equal(paymentReference('', 'Jane Smith'), 'JANE SMITH')
  assert.equal(paymentReference(null, null), 'DEPOSIT')
  assert.equal(paymentReference('SACQ-2026-11-11-EXAMPLE-STREET', null), 'SACQ-2026-11-11-EX')
  assert.equal(paymentReference('<b>Q1</b>', null), 'b Q1 /b')
})

test('a deposit counts as received only when Xero shows the money', () => {
  assert.equal(depositSettled({ paid: 0, jobDeposits: 1650 }), false)
  assert.equal(depositSettled({ paid: 1649.99, jobDeposits: 1650 }), false)
  assert.equal(depositSettled({ paid: 1650, jobDeposits: 1650 }), true)
  assert.equal(depositSettled({ paid: 3300, jobDeposits: 1650 }), true)
  // Two signed quotes on the job: the one invoice has to cover both deposits.
  assert.equal(depositSettled({ paid: 1650, jobDeposits: 2650 }), false)
  assert.equal(depositSettled({ paid: 0, jobDeposits: 0 }), false)
  assert.deepEqual(depositPartPaid({ paid: 500, jobDeposits: 1650, deposit: 1650 }), { received: 500, remaining: 1150 })
  assert.equal(depositPartPaid({ paid: 0, jobDeposits: 1650, deposit: 1650 }), null)
  assert.equal(depositPartPaid({ paid: 500, jobDeposits: 2650, deposit: 1650 }), null)
  assert.equal(depositPartPaid({ paid: 1650, jobDeposits: 1650, deposit: 1650 }), null)
})

test('after signing, the pay step says the invoice is being prepared and shows no way to pay', () => {
  // Even with a pay link and bank details on hand, nothing is shown before the check.
  const html = payPanelHtml(panel({ stage: 'preparing', cardUrl: 'https://in.xero.com/abc123', invoiceNumber: 'INV-0042' }))
  assert.match(html, /Your invoice is being prepared/)
  assert.match(html, /Forensic Cleaning QLD is checking the details and preparing your invoice/)
  assert.match(html, /Your deposit is \$1,650\.00 \(50% of \$3,300\.00 including GST\)\. There is nothing to pay yet\./)
  assert.doesNotMatch(html, /064-000|12345678|Account name|in\.xero\.com|Pay by card|Pay by bank transfer|INV-0042|sg-copy/)
})

test('once the invoice is approved, card and bank transfer are shown together', () => {
  const html = payPanelHtml(panel({ cardUrl: 'https://in.xero.com/abc123', invoiceNumber: 'INV-0042' }))
  assert.match(html, /Pay your deposit/)
  assert.match(html, /<div class="sg-amount">\$1,650\.00<\/div>/)
  assert.match(html, /50% of \$3,300\.00 including GST\./)
  assert.match(html, /<a class="sg-btn sg-btn-wide" href="https:\/\/in\.xero\.com\/abc123" target="_blank" rel="noopener noreferrer">Pay by card<\/a>/)
  assert.match(html, /Opens your invoice INV-0042 from Forensic Cleaning QLD/)
  assert.match(html, /<span>BSB<\/span><strong>064-000<\/strong>/)
  assert.match(html, /<span>Account number<\/span><strong>12345678<\/strong>/)
  assert.match(html, /<span>Reference<\/span><strong>BCQ-1<\/strong><button type="button" class="sg-copy" data-copy="BCQ-1"/)
  assert.equal(html.indexOf('Pay by card') < html.indexOf('Pay by bank transfer'), true)
  assert.doesNotMatch(html, /being prepared/)
})

test('the pay step promises nothing that is not set up', () => {
  // No pay link (Xero not connected): no word about paying by card.
  const bankOnly = payPanelHtml(panel())
  assert.doesNotMatch(bankOnly, /card/i)
  assert.match(bankOnly, /Pay by bank transfer/)
  // No bank details saved: no bank block.
  const cardOnly = payPanelHtml(panel({ bank: null, cardUrl: 'https://in.xero.com/abc123' }))
  assert.doesNotMatch(cardOnly, /bank/i)
  assert.match(cardOnly, />Pay by card<\/a>/)
  // Neither: the brand follows up.
  const neither = payPanelHtml(panel({ bank: null }))
  assert.match(neither, /Forensic Cleaning QLD will be in touch with payment details\./)
  assert.doesNotMatch(neither, /card|bank/i)
  // The invoice was voided in Xero: no way to pay is shown, even with details on hand.
  const voided = payPanelHtml(panel({ stage: 'contact', cardUrl: 'https://in.xero.com/abc123' }))
  assert.match(voided, /Forensic Cleaning QLD will be in touch with payment details\./)
  assert.doesNotMatch(voided, /064-000|in\.xero\.com/)
})

test('only a real Xero address is ever offered as the pay link', () => {
  assert.equal(xeroPayUrl('https://in.xero.com/abc123'), 'https://in.xero.com/abc123')
  assert.equal(xeroPayUrl('https://xero.com/pay'), 'https://xero.com/pay')
  for (const bad of [
    'http://in.xero.com/abc123',
    'https://in.xero.com.evil.example/abc',
    'https://evilxero.com/abc',
    'https://evil.example/?next=in.xero.com',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
    42,
  ]) {
    assert.equal(xeroPayUrl(bad), null, String(bad))
  }
})

test('paid and part-paid deposits are reported as Xero has them', () => {
  const paid = payPanelHtml(panel({ paid: 1650, paidOn: '2026-11-12', cardUrl: 'https://in.xero.com/abc123' }))
  assert.match(paid, /Deposit received/)
  assert.match(paid, /We have received \$1,650\.00 on 12 November 2026\./)
  assert.doesNotMatch(paid, /Pay by card|Pay by bank transfer|064-000/)

  const part = payPanelHtml(panel({ paid: 500 }))
  assert.match(part, /<div class="sg-amount">\$1,150\.00<\/div>/)
  assert.match(part, /Still to pay\. We have received \$500\.00 of your \$1,650\.00 deposit/)
})

test('text on the pay step cannot inject markup', () => {
  const html = payPanelHtml(panel({
    brandLabel: 'Forensic <b>Cleaning</b>',
    reference: '"><img src=x onerror=alert(1)>',
    bank: { accountName: '<script>alert(1)</script>', bsb: '064-000', accountNumber: '12345678' },
    cardUrl: 'https://in.xero.com/a"onmouseover="alert(1)',
    invoiceNumber: '<i>INV</i>',
  }))
  assert.doesNotMatch(html, /<script>|<img |<i>INV|<b>Cleaning|"onmouseover="/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('a signed document opens on the pay step until the deposit is in', () => {
  const base = {
    token: TOKEN,
    pdfUrl: `/${TOKEN}/pdf`,
    brandLabel: 'Forensic Cleaning QLD',
    documentTitle: 'Trauma Cleaning',
    reference: 'BCQ-1',
    signerName: 'Jane <b>Smith</b>',
    signedAtLabel: '11 Nov 2026',
  }
  const due = signedViewHtml({ ...base, pay: panel() })
  assert.match(due, /class="sg-overlay sg-on" id="sg-pay"/)
  assert.match(due, /id="sg-pay-open">Pay deposit</)
  assert.match(due, /<li data-step="sign" class="sg-done"><b>✓<\/b>Sign<\/li><li data-step="pay" class="sg-now" aria-current="step"><b>3<\/b>Pay deposit<\/li>/)
  assert.match(due, /signed by Jane &lt;b&gt;Smith&lt;\/b&gt;, 11 Nov 2026/)
  assert.match(due, new RegExp(`"token":"${TOKEN}","settled":false`))

  // Signed but not yet checked by staff: the step is there, with nothing to pay.
  const waiting = signedViewHtml({ ...base, pay: panel({ stage: 'preparing' }) })
  assert.match(waiting, /class="sg-overlay sg-on" id="sg-pay"/)
  assert.match(waiting, /id="sg-pay-open">Your deposit</)
  assert.match(waiting, /Your invoice is being prepared/)
  assert.doesNotMatch(waiting, /064-000|Pay by card/)

  const paid = signedViewHtml({ ...base, pay: panel({ paid: 1650 }) })
  assert.match(paid, /class="sg-overlay" id="sg-pay"/)
  assert.match(paid, /id="sg-pay-open">Deposit received</)
  assert.match(paid, /<li data-step="pay" class="sg-done"><b>✓<\/b>Pay deposit<\/li>/)

  const none = signedViewHtml({ ...base, pay: null })
  assert.doesNotMatch(none, /data-step="pay"|id="sg-pay|Pay your deposit/)
  assert.match(none, /<li data-step="sign" class="sg-done"><b>✓<\/b>Sign<\/li><\/ol>/)
  assert.match(none, new RegExp(`<a class="sg-btn" href="/${TOKEN}/pdf">Download`))
})
