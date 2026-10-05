import assert from 'node:assert/strict'
import test from 'node:test'
import type { Photo, PostRemediationEvaluationContent } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'
import { orderReportAppendixPhotos, reportAppendixPhotos } from '@/lib/postRemediationEvaluations'

function photo(patch: Partial<Photo>): Photo {
  return {
    id: 'p1',
    job_id: 'job',
    file_url: 'https://example.com/photo.jpg',
    caption: '',
    area_ref: '',
    category: 'after',
    capture_phase: 'progress',
    uploaded_at: '2026-10-05T00:00:00.000Z',
    ...patch,
  }
}

test('report images are progress photos, not assessment photos', () => {
  const photos = reportAppendixPhotos([
    photo({ id: 'after', caption: 'After clean' }),
    photo({ id: 'assess', category: 'assessment', capture_phase: 'assessment', caption: 'Assessment only' }),
    photo({ id: 'hidden', include_in_composed_reports: false, caption: 'Hidden' }),
  ])
  assert.deepEqual(photos.map(p => p.id), ['after'])
})

test('loaded images print at the end of the evaluation', () => {
  const content: PostRemediationEvaluationContent = {
    title: 'Completion Report',
    reference: 'RPT-1',
    source_quote_document_id: 'quote',
    report_format: 'completion_v2',
    scope_lines: [],
    technician_signoff: 'Alex Technician',
    include_photos: true,
  }
  const html = buildPrintHTML(
    'report',
    content as unknown as Record<string, unknown>,
    [photo({ caption: 'Kitchen after' })],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  const signOff = html.indexOf('Sign-off')
  const images = html.indexOf('Photo Documentation')
  assert.ok(signOff > 0)
  assert.ok(images > signOff)
  assert.match(html, /Kitchen after/)
  assert.match(html, /https:\/\/example.com\/photo.jpg/)
})

test('images stay in upload order unless they have been moved', () => {
  const photos = [
    photo({ id: 'later', file_url: 'https://example.com/later.jpg', uploaded_at: '2026-10-02T00:00:00.000Z' }),
    photo({ id: 'first', file_url: 'https://example.com/first.jpg', uploaded_at: '2026-10-01T00:00:00.000Z' }),
  ]
  assert.deepEqual(orderReportAppendixPhotos(photos).map(p => p.id), ['first', 'later'])
  assert.deepEqual(orderReportAppendixPhotos(photos, ['later', 'first']).map(p => p.id), ['later', 'first'])
})

test('a moved image keeps that place in the printed report', () => {
  const content: PostRemediationEvaluationContent = {
    title: 'Completion Report',
    reference: 'RPT-1',
    source_quote_document_id: 'quote',
    report_format: 'completion_v2',
    scope_lines: [],
    include_photos: true,
    report_image_ids: ['later', 'first'],
  }
  const html = buildPrintHTML(
    'report',
    content as unknown as Record<string, unknown>,
    [
      photo({ id: 'first', file_url: 'https://example.com/first.jpg', uploaded_at: '2026-10-01T00:00:00.000Z' }),
      photo({ id: 'later', file_url: 'https://example.com/later.jpg', uploaded_at: '2026-10-02T00:00:00.000Z' }),
    ],
    [],
    null,
    'job',
    'http://localhost',
    undefined,
    { screenActionBar: false },
  )
  const first = html.indexOf('https://example.com/first.jpg')
  const later = html.indexOf('https://example.com/later.jpg')
  assert.ok(later > 0 && first > later)
})
