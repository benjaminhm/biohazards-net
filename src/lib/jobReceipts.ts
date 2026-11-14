/*
 * lib/jobReceipts.ts
 *
 * Receipts on a job (migration 077), tip receipts first. One image is one
 * receipt. Its details are read from the image as suggestions; it counts once a
 * person confirms it. A confirmed receipt linked to Contents Disposal Record
 * loads sets those loads' tip fee and weight, split by volume, so the record's
 * totals come from receipts and each receipt is counted once.
 *
 * Loads are linked by their photo (one photo is one load), which stays the same
 * when loads are renumbered.
 */
import type { DisposalLoad } from './types'
import { loadSkipOnly, loadVolumeM3 } from './disposalManifest'
import { localStamp } from './disposalTimeline'

export interface ReceiptRead {
  supplier: string
  receipt_at: string | null
  docket_no: string
  total_inc_gst: number | null
  gst: number | null
  weight_kg: number | null
  read_at: string
}

export interface JobReceipt {
  id: string
  job_id: string
  file_url: string
  uploaded_by_name: string
  uploaded_at: string
  supplier: string
  receipt_at: string | null
  docket_no: string
  total_inc_gst: number | null
  gst: number | null
  weight_kg: number | null
  read: ReceiptRead | null
  confirmed_at: string | null
  confirmed_by_name: string | null
  dext_sent_at: string | null
  /** The photos of the loads this receipt covers. */
  load_photo_ids: string[]
}

/** Fields staff can edit on a receipt. */
export type ReceiptFields = Pick<JobReceipt, 'supplier' | 'receipt_at' | 'docket_no' | 'total_inc_gst' | 'gst' | 'weight_kg'>

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function text(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function iso(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function parseReceiptRead(raw: unknown): ReceiptRead | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    supplier: text(o.supplier),
    receipt_at: iso(o.receipt_at),
    docket_no: text(o.docket_no, 60),
    total_inc_gst: num(o.total_inc_gst),
    gst: num(o.gst),
    weight_kg: num(o.weight_kg),
    read_at: text(o.read_at, 40) || new Date(0).toISOString(),
  }
}

/** Edits from a request body. Only the fields present are returned; null if any is malformed. */
export function parseReceiptFields(raw: unknown): Partial<ReceiptFields> | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: Partial<ReceiptFields> = {}
  if ('supplier' in o) out.supplier = text(o.supplier)
  if ('docket_no' in o) out.docket_no = text(o.docket_no, 60)
  if ('receipt_at' in o) {
    if (o.receipt_at != null && o.receipt_at !== '' && iso(o.receipt_at) == null) return null
    out.receipt_at = iso(o.receipt_at)
  }
  for (const key of ['total_inc_gst', 'gst', 'weight_kg'] as const) {
    if (!(key in o)) continue
    if (o[key] != null && o[key] !== '' && num(o[key]) == null) return null
    out[key] = num(o[key])
  }
  return out
}

/** A row from job_receipts (numeric columns arrive as strings) with its load links. */
export function receiptFromRow(row: Record<string, unknown>, loadPhotoIds: string[]): JobReceipt {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    file_url: String(row.file_url ?? ''),
    uploaded_by_name: text(row.uploaded_by_name),
    uploaded_at: String(row.uploaded_at ?? ''),
    supplier: text(row.supplier),
    receipt_at: iso(row.receipt_at),
    docket_no: text(row.docket_no, 60),
    total_inc_gst: num(row.total_inc_gst),
    gst: num(row.gst),
    weight_kg: num(row.weight_kg),
    read: parseReceiptRead(row.read),
    confirmed_at: iso(row.confirmed_at),
    confirmed_by_name: typeof row.confirmed_by_name === 'string' ? row.confirmed_by_name : null,
    dext_sent_at: iso(row.dext_sent_at),
    load_photo_ids: [...new Set(loadPhotoIds)],
  }
}

/** The read's values for fields still blank, so staff start from what the image shows. */
export function fieldsFromRead(r: Pick<JobReceipt, keyof ReceiptFields>, read: ReceiptRead): Partial<ReceiptFields> {
  const out: Partial<ReceiptFields> = {}
  if (!r.supplier && read.supplier) out.supplier = read.supplier
  if (!r.receipt_at && read.receipt_at) out.receipt_at = read.receipt_at
  if (!r.docket_no && read.docket_no) out.docket_no = read.docket_no
  if (r.total_inc_gst == null && read.total_inc_gst != null) out.total_inc_gst = read.total_inc_gst
  if (r.gst == null && read.gst != null) out.gst = read.gst
  if (r.weight_kg == null && read.weight_kg != null) out.weight_kg = read.weight_kg
  return out
}

export function receiptLabel(r: Pick<JobReceipt, 'docket_no' | 'supplier'>): string {
  if (r.docket_no) return `Receipt ${r.docket_no}`
  return r.supplier ? `${r.supplier} receipt` : 'Receipt'
}

/** The photo a load is known by: its load photo, otherwise its first photo. */
export function loadPhotoId(load: Pick<DisposalLoad, 'events'>): string | null {
  const events = load.events ?? []
  const loadEvent = events.find(e => e.role === 'load' && e.photos.length)
  return (loadEvent ?? events.find(e => e.photos.length))?.photos[0]?.id ?? null
}

/** When a load happened: its first timed event. */
function loadAt(load: Pick<DisposalLoad, 'events'>): string {
  return (load.events ?? []).map(e => e.at).filter(Boolean).sort()[0] ?? ''
}

/** Split an amount across shares by weight (volume), in cents, so the parts add up exactly. */
export function splitAmount(total: number, weights: (number | null)[]): number[] {
  if (!weights.length) return []
  const cents = Math.round(total * 100)
  const usable = weights.every(w => w != null && w > 0)
  const w = usable ? (weights as number[]) : weights.map(() => 1)
  const sum = w.reduce((a, b) => a + b, 0)
  const parts = w.map(x => Math.floor((cents * x) / sum))
  parts[parts.length - 1] += cents - parts.reduce((a, b) => a + b, 0)
  return parts.map(c => c / 100)
}

const RECEIPT_FIELDS = ['dump_fee', 'weight_kg', 'skip_cost']

function withoutReceiptSuggestions(load: DisposalLoad): DisposalLoad {
  if (!load.suggested?.some(f => RECEIPT_FIELDS.includes(f))) return load
  const suggested = load.suggested.filter(f => !RECEIPT_FIELDS.includes(f))
  const next: DisposalLoad = { ...load, suggested }
  if (!suggested.length) delete next.suggested
  return next
}

function withFee(load: DisposalLoad, fee: number | null): DisposalLoad {
  if (loadSkipOnly(load)) {
    const [first, ...rest] = load.vehicles
    return first ? { ...load, dump_fee: null, vehicles: [{ ...first, skip_cost: fee }, ...rest] } : load
  }
  return { ...load, dump_fee: fee }
}

/**
 * Loads with their tip fee and weight set from the confirmed receipts that
 * cover them. A load that a receipt no longer covers loses the receipt's values.
 * Returns the same array when nothing changes.
 */
export function applyReceiptsToLoads(loads: DisposalLoad[], receipts: JobReceipt[]): DisposalLoad[] {
  const confirmed = receipts
    .filter(r => r.confirmed_at && r.load_photo_ids.length)
    .sort((a, b) => (a.receipt_at ?? '').localeCompare(b.receipt_at ?? ''))
  const receiptFor = new Map<string, JobReceipt>()
  for (const r of confirmed) for (const id of r.load_photo_ids) if (!receiptFor.has(id)) receiptFor.set(id, r)

  const covered = new Map<string, number[]>()
  loads.forEach((load, i) => {
    const pid = loadPhotoId(load)
    const r = pid ? receiptFor.get(pid) : undefined
    if (r) covered.set(r.id, [...(covered.get(r.id) ?? []), i])
  })

  const next = loads.slice()
  for (const r of confirmed) {
    const idx = covered.get(r.id) ?? []
    if (!idx.length) continue
    const volumes = idx.map(i => loadVolumeM3(loads[i]))
    const fees = r.total_inc_gst != null ? splitAmount(r.total_inc_gst, volumes) : null
    const weights = r.weight_kg != null ? splitAmount(r.weight_kg, volumes) : null
    idx.forEach((i, k) => {
      let load = withoutReceiptSuggestions({ ...loads[i], receipt_id: r.id })
      if (fees) load = withFee(load, fees[k])
      if (weights) load = { ...load, weight_kg: weights[k] }
      next[i] = load
    })
  }
  loads.forEach((load, i) => {
    if (!load.receipt_id || next[i] !== load) return
    const pid = loadPhotoId(load)
    if (pid && receiptFor.has(pid)) return
    const cleared = withFee({ ...load, weight_kg: null }, null)
    delete cleared.receipt_id
    next[i] = cleared
  })
  return JSON.stringify(next) === JSON.stringify(loads) ? loads : next
}

export interface ReceiptGroup {
  receipt: JobReceipt
  /** Load numbers on the record (1-based) this receipt covers. */
  loadNumbers: number[]
}

/** Confirmed receipts with the record's loads they cover, in receipt order. */
export function receiptGroups(loads: DisposalLoad[], receipts: JobReceipt[]): ReceiptGroup[] {
  const numberOf = new Map<string, number>()
  loads.forEach((l, i) => { const pid = loadPhotoId(l); if (pid) numberOf.set(pid, i + 1) })
  return receipts
    .filter(r => r.confirmed_at)
    .map(receipt => ({
      receipt,
      loadNumbers: receipt.load_photo_ids.map(id => numberOf.get(id)).filter((n): n is number => n != null).sort((a, b) => a - b),
    }))
    .filter(g => g.loadNumbers.length)
    .sort((a, b) => a.loadNumbers[0] - b.loadNumbers[0])
}

/**
 * Loads a receipt probably covers: loads no other receipt covers that happened
 * before the receipt and after the receipt before it. With no times to go on,
 * every load not yet covered.
 */
export function suggestReceiptLoads(receipt: JobReceipt, loads: DisposalLoad[], receipts: JobReceipt[]): string[] {
  const takenByOthers = new Set(receipts.filter(r => r.id !== receipt.id).flatMap(r => r.load_photo_ids))
  const open = loads
    .map(l => ({ pid: loadPhotoId(l), at: loadAt(l) }))
    .filter((l): l is { pid: string; at: string } => !!l.pid && !takenByOthers.has(l.pid))
  const at = localStamp(receipt.receipt_at)
  if (!at || open.some(l => !l.at)) return open.map(l => l.pid)
  const previous = receipts
    .filter(r => r.id !== receipt.id)
    .map(r => localStamp(r.receipt_at))
    .filter(t => t && t < at)
    .sort()
    .pop() ?? ''
  return open.filter(l => l.at <= at && l.at > previous).map(l => l.pid)
}

export interface ReceiptTotals {
  count: number
  total_inc_gst: number
  gst: number
  weight_kg: number
}

/** Confirmed receipts covering loads on the record, each counted once. */
export function receiptTotals(groups: ReceiptGroup[]): ReceiptTotals {
  const sum = (f: (r: JobReceipt) => number | null) => Math.round(groups.reduce((a, g) => a + (f(g.receipt) ?? 0), 0) * 100) / 100
  return {
    count: groups.length,
    total_inc_gst: sum(r => r.total_inc_gst),
    gst: sum(r => r.gst),
    weight_kg: sum(r => r.weight_kg),
  }
}
