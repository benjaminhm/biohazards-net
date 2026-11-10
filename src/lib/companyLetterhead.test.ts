import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrintHTML } from '@/lib/printDocument'
import { composeDocumentContent } from '@/lib/composeDocument'
import { normalizeCompanyLetterheadCapture } from '@/lib/companyLetterhead'
import type { CompanyProfile, Job } from '@/lib/types'

test('letterhead capture keeps the letter and http images only', () => {
  const capture = normalizeCompanyLetterheadCapture({
    body_html: '<p>Dear client,</p>',
    images: [
      { id: '1', url: 'https://cdn.example/a.jpg', caption: 'Front room' },
      { id: '2', url: 'javascript:alert(1)', caption: 'no' },
      { url: 'not a url' },
    ],
  })
  assert.equal(capture.body_html, '<p>Dear client,</p>')
  assert.equal(capture.images.length, 1)
  assert.equal(capture.images[0]?.url, 'https://cdn.example/a.jpg')
  assert.equal(capture.images[0]?.caption, 'Front room')
})

test('a generated letterhead is the letter plus the company header and attached image', () => {
  const job = {
    id: 'abcdef12-0000-0000-0000-000000000000',
    client_name: 'Ada Client',
    site_address: '1 Example Street',
    assessment_data: {
      company_letterhead: {
        body_html: '<p>The works at the property are complete.</p>',
        images: [{ id: '1', url: 'https://cdn.example/room.jpg', caption: 'After clean' }],
      },
    },
  } as Job
  const composed = composeDocumentContent('company_letterhead', job)
  assert.equal(composed.source, 'assessment_capture')
  assert.match(String(composed.content.body_html), /works at the property are complete/)
  const html = buildPrintHTML(
    'company_letterhead',
    composed.content,
    [],
    [],
    {
      name: 'Biohazard Cleaning QLD',
      tagline: 'Forensic cleaning',
      abn: '12 345 678 901',
      licence: '123456',
      logo_url: 'https://cdn.example/logo.png',
    } as CompanyProfile,
    job.id,
    'http://localhost',
    { client_name: 'Ada Client' },
    { screenActionBar: false },
  )
  assert.match(html, /class="sow-top"/)
  assert.doesNotMatch(html, /Company Letterhead/)
  assert.doesNotMatch(html, /class="sow-doc-title"/)
  assert.match(html, /class="sow-meta"/)
  assert.match(html, /Biohazard Cleaning QLD/)
  assert.match(html, /ABN 12 345 678 901/)
  assert.match(html, /Ada Client/)
  assert.match(html, /The works at the property are complete/)
  assert.match(html, /https:\/\/cdn\.example\/room\.jpg/)
  assert.match(html, /After clean/)
})
