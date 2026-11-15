import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import { composeDocumentContent } from '@/lib/composeDocument'
import type { Job } from '@/lib/types'
import { formatToTwilioE164 } from '@/lib/phone'
import {
  emailHandoffBody,
  emailHandoffUrl,
  handoffQrSvg,
  smsHandoffUrl,
  textHandoffBody,
  textHandoffUrl,
} from './phoneHandoff'

/** libphonenumber-js loads without its metadata under tsx (see calls.test.ts). */
const phoneSkip = formatToTwilioE164('0412 345 678') ? false : 'phone metadata does not load under tsx'

const LINK = 'https://app.biohazards.net/api/print/abc'

test('the text QR carries the short message on an sms link', () => {
  const body = textHandoffBody('Ada', LINK)
  assert.equal(body, 'Hi Ada, here is your document: ' + LINK)
  const url = smsHandoffUrl('+61412345678', body)
  assert.equal(url, `sms:+61412345678?&body=${encodeURIComponent(body)}`)
  assert.equal(decodeURIComponent(url.split('?&body=')[1] ?? ''), body)
  assert.equal(textHandoffUrl('not a phone', 'Ada', LINK), null)
  assert.equal(textHandoffUrl('   ', 'Ada', LINK), null)
  assert.equal(textHandoffUrl(undefined, 'Ada', LINK), null)
})

test('a job phone becomes that sms link, and a bad phone does not', { skip: phoneSkip }, () => {
  const link = textHandoffUrl('0412 345 678', 'Ada', LINK)
  assert.ok(link)
  assert.equal(link.to, '+61412345678')
  assert.equal(link.url, smsHandoffUrl('+61412345678', textHandoffBody('Ada', LINK)))
})

test('the email QR uses the same subject and body as the Email button', () => {
  const subject = 'Quote — Ada Client'
  const link = emailHandoffUrl(' ada@example.com ', subject, 'Ada', LINK)
  assert.ok(link)
  assert.equal(link.to, 'ada@example.com')
  const body = emailHandoffBody('Ada', LINK)
  assert.equal(body, `Hi Ada,\n\nPlease find your document at the link below:\n\n${LINK}\n\nKind regards`)
  assert.equal(
    link.url,
    `mailto:ada@example.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  )
  assert.equal(emailHandoffUrl('  ', subject, 'Ada', LINK), null)
  assert.equal(emailHandoffUrl(undefined, subject, 'Ada', LINK), null)
})

test('the QR is a white square of modules', () => {
  const svg = handoffQrSvg('sms:+61412345678?&body=Hi')
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  assert.match(svg, /fill="#fff"/)
  assert.match(svg, /<rect x="0" y="0"/)
})

function letter(client: { client_name?: string; client_email?: string; client_phone?: string; printUrl?: string }, bar: boolean) {
  const job = {
    id: 'abcdef12-0000-0000-0000-000000000000',
    client_name: 'Ada Client',
    site_address: '1 Example Street',
    assessment_data: { company_letterhead: { body_html: '<p>Hello.</p>', images: [] } },
  } as unknown as Job
  return buildPrintHTML(
    'company_letterhead',
    composeDocumentContent('company_letterhead', job).content,
    [],
    [],
    null,
    job.id,
    'http://localhost',
    client,
    bar ? undefined : { screenActionBar: false },
  )
}

test('the screen bar offers a QR for text and for email, and print hides the bar', () => {
  const html = letter({
    client_name: 'Ada Client',
    client_email: 'ada@example.com',
    client_phone: '0412 345 678',
    printUrl: LINK,
  }, true)
  const barAt = html.indexOf('class="action-bar"')
  const docAt = html.indexOf('class="sow-root')
  assert.ok(barAt >= 0 && docAt > barAt)
  const bar = html.slice(barAt, docAt)
  assert.match(bar, /Email from phone/)
  assert.match(bar, /Opens Mail to ada@example\.com/)
  if (phoneSkip) {
    assert.equal(bar.includes('Text from phone'), false)
  } else {
    assert.match(bar, /Text from phone/)
    assert.match(bar, /Opens Messages to \+61412345678/)
  }
  assert.match(bar, /id="ab-handoff"/)
  assert.match(html, /@media print[\s\S]*\.action-bar,[\s\S]*?\.ab-handoff \{ display: none !important; \}/)

  const hidden = letter({
    client_name: 'Ada Client',
    client_email: 'ada@example.com',
    client_phone: '0412 345 678',
    printUrl: LINK,
  }, false)
  assert.equal(hidden.includes('Text from phone'), false)
  assert.equal(hidden.includes('id="ab-handoff"'), false)

  const emailOnly = letter({ client_name: 'Ada Client', client_email: 'ada@example.com', client_phone: 'nope', printUrl: LINK }, true)
  assert.equal(emailOnly.includes('Text from phone'), false)
  assert.match(emailOnly, /Email from phone/)
})
