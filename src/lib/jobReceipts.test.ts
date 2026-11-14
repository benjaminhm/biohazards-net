import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyDisposalLoad, emptyDisposalVehicle } from './disposalManifest'
import type { DisposalLoad } from './types'
import {
  applyReceiptsToLoads,
  parseReceiptFields,
  receiptFromRow,
  receiptGroups,
  receiptTotals,
  splitAmount,
  suggestReceiptLoads,
  type JobReceipt,
} from './jobReceipts'

function load(photoId: string, at: string, size: [number, number, number] = [2, 1, 1]): DisposalLoad {
  const vehicle = { ...emptyDisposalVehicle('trailer'), length_m: size[0], width_m: size[1], height_m: size[2] }
  return {
    ...emptyDisposalLoad(),
    id: `l_${photoId}`,
    vehicles: [vehicle],
    events: [{ id: `e_${photoId}`, role: 'load', at, place: '', lat: null, lng: null, description: '', photos: [{ id: photoId, url: `https://x/${photoId}.jpg`, note: '' }] }],
  } as DisposalLoad
}

function receipt(id: string, patch: Partial<JobReceipt> = {}): JobReceipt {
  return {
    ...receiptFromRow({ id, job_id: 'j', file_url: 'https://x/r.jpg', uploaded_at: '2026-11-14T00:00:00Z' }, []),
    ...patch,
  }
}

test('amounts split by volume add up to the cent', () => {
  assert.deepEqual(splitAmount(100, [1, 1, 1]), [33.33, 33.33, 33.34])
  assert.deepEqual(splitAmount(312.4, [2, 6]), [78.1, 234.3])
  assert.deepEqual(splitAmount(50, [null, 3]), [25, 25])
})

test('a confirmed receipt sets the tip fee and weight on the loads it covers', () => {
  const loads = [load('p1', '2026-11-14T09:00', [2, 1, 1]), load('p2', '2026-11-14T10:00', [2, 1, 3]), load('p3', '2026-11-14T13:00')]
  const r = receipt('r1', { confirmed_at: '2026-11-14T05:00:00Z', total_inc_gst: 200, weight_kg: 1000, load_photo_ids: ['p1', 'p2'] })
  const next = applyReceiptsToLoads(loads, [r])
  assert.deepEqual(next.map(l => l.dump_fee), [50, 150, null])
  assert.deepEqual(next.map(l => l.weight_kg), [250, 750, null])
  assert.deepEqual(next.map(l => l.receipt_id ?? null), ['r1', 'r1', null])
  assert.equal(applyReceiptsToLoads(next, [r]), next)
})

test('an unconfirmed receipt changes nothing, and unlinking clears what it set', () => {
  const loads = [load('p1', '2026-11-14T09:00')]
  const draft = receipt('r1', { total_inc_gst: 80, load_photo_ids: ['p1'] })
  assert.equal(applyReceiptsToLoads(loads, [draft]), loads)
  const linked = applyReceiptsToLoads(loads, [{ ...draft, confirmed_at: '2026-11-14T05:00:00Z' }])
  assert.equal(linked[0].dump_fee, 80)
  const unlinked = applyReceiptsToLoads(linked, [{ ...draft, confirmed_at: '2026-11-14T05:00:00Z', load_photo_ids: [] }])
  assert.equal(unlinked[0].dump_fee, null)
  assert.equal(unlinked[0].receipt_id, undefined)
})

test('groups and totals count each receipt once', () => {
  const loads = [load('p1', ''), load('p2', ''), load('p3', '')]
  const a = receipt('a', { confirmed_at: 'x', total_inc_gst: 100, gst: 9.09, weight_kg: 500, load_photo_ids: ['p2', 'p1'] })
  const b = receipt('b', { confirmed_at: 'x', total_inc_gst: 40, gst: 3.64, weight_kg: null, load_photo_ids: ['p3'] })
  const groups = receiptGroups(loads, [b, a])
  assert.deepEqual(groups.map(g => [g.receipt.id, g.loadNumbers]), [['a', [1, 2]], ['b', [3]]])
  assert.deepEqual(receiptTotals(groups), { count: 2, total_inc_gst: 140, gst: 12.73, weight_kg: 500 })
})

test('suggested loads: uncovered loads between the previous receipt and this one', () => {
  const loads = [load('p1', '2026-11-14T08:00'), load('p2', '2026-11-14T09:30'), load('p3', '2026-11-14T13:00'), load('p4', '2026-11-14T15:00')]
  const morning = receipt('m', { receipt_at: '2026-11-14T00:00:00Z', load_photo_ids: ['p1'] }) // 10:00 Brisbane
  const afternoon = receipt('a', { receipt_at: '2026-11-14T04:00:00Z' }) // 14:00 Brisbane
  assert.deepEqual(suggestReceiptLoads(afternoon, loads, [morning, afternoon]), ['p3'])
  assert.deepEqual(suggestReceiptLoads(receipt('n'), loads, [morning]), ['p2', 'p3', 'p4'])
})

test('receipt edits must be well formed', () => {
  assert.deepEqual(parseReceiptFields({ supplier: ' Brendale ', total_inc_gst: '$312.40', gst: '' }), { supplier: 'Brendale', total_inc_gst: 312.4, gst: null })
  assert.equal(parseReceiptFields({ total_inc_gst: 'lots' }), null)
  assert.equal(parseReceiptFields({ receipt_at: 'not a date' }), null)
})
