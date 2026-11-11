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
  docketHtml,
  hashSigningTokenSafe,
  insertAtBodyEnd,
  isEmail,
  isUnlocked,
  linkMessage,
  linkState,
  messageToHtml,
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
import { passcodeGatePage, signingShellHtml } from '@/lib/signing/shell'
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
    ['hoarding_cleaning_qld', 'Hoarding Cleaning QLD'],
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

test('only the FCQ document host is treated as a document host', () => {
  assert.equal(documentHostTradingName('document.forensiccleaningqld.com.au'), 'forensic_cleaning_qld')
  assert.equal(documentHostTradingName('Document.ForensicCleaningQLD.com.au:443'), 'forensic_cleaning_qld')
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
    'Hi Jane, here is your quote from Forensic Cleaning QLD for 1 Example Street to review and sign:',
    'https://document.forensiccleaningqld.com.au/abc',
    '',
    'Passcode: K7M4',
    '',
    'Kind regards,',
    'Ben',
  ].join('\n'))
  assert.match(linkMessage({ clientName: '', siteAddress: null, staffFirstName: '', brandLabel: 'Forensic Cleaning QLD', link: 'x', passcode: 'K7M4' }),
    /^Hi there, here is your quote from Forensic Cleaning QLD to review and sign:\nx\n\nPasscode: K7M4\n\nKind regards,\nForensic Cleaning QLD$/)
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
  })
  assert.match(shell, /<span>For:<\/span> Jane Smith<\/div>/)
  assert.match(shell, /Download your signed copy of Trauma Cleaning BCQ-1 now/)
  assert.doesNotMatch(shell, /emailed to/)
  assert.match(shell, new RegExp(`href="/${'A'.repeat(43)}/pdf"`))
})
