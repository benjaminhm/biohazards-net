import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import { emptySurfaceAreaCleaningCapture, surfaceAreaCleaningQuoteContent } from '@/lib/surfaceAreaCleaningQuote'
import {
  SIGNATURE_MAX_BYTES,
  cleanSignerName,
  defaultMessage,
  docketHtml,
  hashSigningTokenSafe,
  insertAtBodyEnd,
  isEmail,
  linkState,
  messageToHtml,
  newSigningToken,
  resolveSender,
  sha256Hex,
  signaturePngError,
  signedDateLabel,
  signerNameError,
  signingExpiry,
} from '@/lib/signing/core'
import { fillSignSlots, hasSignSlots, signatureBlockHtml } from '@/lib/signing/slots'
import { signingShellHtml } from '@/lib/signing/shell'

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
  assert.match(message, /our trauma cleaning for 1 Example Street\./)
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
    dateLabel: '11 November 2026',
    consented: false,
  })
  assert.doesNotMatch(shell, /<script>alert\(1\)/)
  assert.match(shell, /Trauma &lt;Cleaning&gt; BCQ-1/)
  assert.match(shell, /"toName":"\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e"/)
  assert.match(shell, new RegExp(`/api/sign/${'A'.repeat(43)}/pdf`))
})
