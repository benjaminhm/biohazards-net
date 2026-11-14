'use client'

/*
 * Receipts on a job (lib/jobReceipts): "Upload receipts" makes one receipt per
 * image, each read once so its details start filled in. Staff check the
 * details, tick the loads it covers (the suggestion is marked), and confirm.
 * Only confirmed receipts set the Contents Disposal Record's tip fees and
 * weights. Without `loads` (the Photos tab) there is nothing to link.
 */
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { DisposalLoad, Photo } from '@/lib/types'
import { compressImage } from '@/lib/compressImage'
import { formatEventWhen, localStamp } from '@/lib/disposalTimeline'
import { loadPhotoId, receiptLabel, suggestReceiptLoads, type JobReceipt, type ReceiptFields } from '@/lib/jobReceipts'
import PhotoFolderPicker from '@/components/PhotoFolderPicker'
import { roundTripKm } from '@/lib/roundTripDistance'

const INPUT: CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)',
}
const LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }
const MUTED: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' }
const READ_CONCURRENCY = 2

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
  return data
}

/** Brisbane has no daylight saving, so a typed local time is always +10:00. */
function isoFromLocal(value: string): string | null {
  return value ? `${value}:00+10:00` : null
}

function money(n: number | null): string {
  return n == null ? '' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReceiptsPanel({ jobId, receipts, onReceipts, loads, photos, onPhotosUpdate, site }: {
  jobId: string
  /** The job site, where each trip to the tip starts and ends. */
  site?: { address: string; lat: number | null; lng: number | null }
  receipts: JobReceipt[]
  onReceipts: (update: (prev: JobReceipt[]) => JobReceipt[]) => void
  /** The record's loads, in order, so receipts can be linked to them. */
  loads?: DisposalLoad[]
  /** The job's folder, for moving receipts that came in as photos. */
  photos?: Photo[]
  onPhotosUpdate?: (photos: Photo[]) => void
}) {
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [reading, setReading] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const readQueue = useRef<string[]>([])
  const readActive = useRef(0)

  const replace = (r: JobReceipt) => onReceipts(prev => prev.map(x => (x.id === r.id ? r : x)))

  // The Maps key only answers the browser, so the drive is found here and saved on the receipt.
  const [tripState, setTripState] = useState<Record<string, 'working' | 'failed'>>({})
  const tripTried = useRef(new Set<string>())
  async function workOutTrip(r: JobReceipt) {
    if (!site?.address.trim() || !r.tip_address) return
    tripTried.current.add(`${r.id}|${r.tip_address}`)
    await Promise.resolve()
    setTripState(prev => ({ ...prev, [r.id]: 'working' }))
    const sitePin = site.lat != null && site.lng != null ? { lat: site.lat, lng: site.lng } : null
    const tipPin = r.tip_lat != null && r.tip_lng != null ? { lat: r.tip_lat, lng: r.tip_lng } : null
    try {
      const found = await roundTripKm({ address: site.address, pin: sitePin }, { address: r.tip_address, pin: tipPin })
      if (found.km == null) throw new Error('no route')
      const d = await call<{ receipt: JobReceipt }>(`/api/jobs/${jobId}/receipts/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip: { distance_km: found.km, tip_lat: found.dest?.lat ?? null, tip_lng: found.dest?.lng ?? null } }),
      })
      replace(d.receipt)
      setTripState(prev => { const next = { ...prev }; delete next[r.id]; return next })
    } catch {
      setTripState(prev => ({ ...prev, [r.id]: 'failed' }))
    }
  }
  useEffect(() => {
    for (const r of receipts) {
      if (!r.tip_address || r.distance_km != null || tripTried.current.has(`${r.id}|${r.tip_address}`)) continue
      void workOutTrip(r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipts, site?.address, site?.lat, site?.lng])

  function pumpReads() {
    while (readActive.current < READ_CONCURRENCY && readQueue.current.length) {
      const id = readQueue.current.shift() as string
      readActive.current += 1
      setReading(prev => new Set(prev).add(id))
      void call<{ receipt: JobReceipt }>(`/api/jobs/${jobId}/receipts/${id}/read`, { method: 'POST' })
        .then(d => replace(d.receipt))
        .catch(() => { /* the details can be typed */ })
        .finally(() => {
          readActive.current -= 1
          setReading(prev => { const next = new Set(prev); next.delete(id); return next })
          pumpReads()
        })
    }
  }

  function read(ids: string[]) {
    readQueue.current.push(...ids)
    pumpReads()
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!files.length || uploading) return
    setError('')
    setUploading({ done: 0, total: files.length })
    for (let i = 0; i < files.length; i++) {
      try {
        const body = new FormData()
        body.append('file', await compressImage(files[i], 2400, 0.85), 'receipt.jpg')
        const d = await call<{ receipt: JobReceipt }>(`/api/jobs/${jobId}/receipts`, { method: 'POST', body })
        onReceipts(prev => [...prev, d.receipt])
        read([d.receipt.id])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
        break
      }
      setUploading({ done: i + 1, total: files.length })
    }
    setUploading(null)
  }

  async function moveFromFolder(ids: string[]) {
    setPicking(false)
    if (!ids.length) return
    setError('')
    try {
      const d = await call<{ receipts: JobReceipt[] }>(`/api/jobs/${jobId}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: ids }),
      })
      onReceipts(prev => [...prev, ...d.receipts])
      const moved = new Set(d.receipts.map(r => r.file_url))
      if (photos && onPhotosUpdate) onPhotosUpdate(photos.filter(p => !moved.has(p.file_url)))
      read(d.receipts.map(r => r.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the photos')
    }
  }

  const linkable = (loads ?? []).map((l, i) => ({ number: i + 1, photoId: loadPhotoId(l) })).filter((l): l is { number: number; photoId: string } => !!l.photoId)
  const folderPhotos = (photos ?? []).filter(p => (p.cdr_load ?? 0) < 1)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => void onUpload(e)} style={{ display: 'none' }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={e => void onUpload(e)} style={{ display: 'none' }} />
        <button type="button" className="btn btn-primary" disabled={!!uploading} onClick={() => fileRef.current?.click()} style={{ fontSize: 13, fontWeight: 800 }}>
          {uploading ? `Uploading ${uploading.done} of ${uploading.total}…` : 'Upload receipts'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!!uploading} onClick={() => cameraRef.current?.click()} style={{ fontSize: 13 }}>
          Photograph a receipt
        </button>
        {photos && onPhotosUpdate && folderPhotos.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => setPicking(true)} style={{ fontSize: 13 }} title="For receipts that were uploaded as photos, e.g. through the phone link">
            Move from folder
          </button>
        )}
        <span style={MUTED}>One image is one receipt.</span>
      </div>
      {error && <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: '#F87171' }}>{error}</div>}
      {receipts.length === 0 && <div style={MUTED}>No receipts on this job yet.</div>}
      {receipts.map(r => (
        <ReceiptCard
          key={r.id}
          jobId={jobId}
          receipt={r}
          reading={reading.has(r.id)}
          onRead={() => read([r.id])}
          trip={tripState[r.id] ?? null}
          onWorkOutTrip={site?.address.trim() ? () => void workOutTrip(r) : null}
          onChange={replace}
          onDelete={() => onReceipts(prev => prev.filter(x => x.id !== r.id))}
          loads={loads ? linkable : null}
          suggested={loads ? suggestReceiptLoads(r, loads, receipts) : []}
          linkedElsewhere={new Set(receipts.filter(x => x.id !== r.id).flatMap(x => x.load_photo_ids))}
        />
      ))}
      {picking && photos && onPhotosUpdate && (
        <PhotoFolderPicker
          jobId={jobId}
          title="Receipts"
          photos={folderPhotos}
          alreadyIds={new Set()}
          onPhotosUpdate={list => onPhotosUpdate([...list, ...photos.filter(p => (p.cdr_load ?? 0) >= 1)])}
          onClose={() => setPicking(false)}
          onAdd={ids => void moveFromFolder(ids)}
        />
      )}
    </div>
  )
}

function ReceiptCard({ jobId, receipt, reading, onRead, trip, onWorkOutTrip, onChange, onDelete, loads, suggested, linkedElsewhere }: {
  jobId: string
  receipt: JobReceipt
  reading: boolean
  onRead: () => void
  trip: 'working' | 'failed' | null
  onWorkOutTrip: (() => void) | null
  onChange: (r: JobReceipt) => void
  onDelete: () => void
  loads: { number: number; photoId: string }[] | null
  suggested: string[]
  linkedElsewhere: Set<string>
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false)
  const confirmed = Boolean(receipt.confirmed_at)
  const base = `/api/jobs/${jobId}/receipts/${receipt.id}`

  async function patch(body: Record<string, unknown>) {
    setSaving(true)
    setError('')
    try {
      const d = await call<{ receipt: JobReceipt }>(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      onChange(d.receipt)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      return false
    } finally {
      setSaving(false)
    }
  }

  const shown = (key: keyof ReceiptFields): string => {
    if (key in draft) return draft[key]
    const v = receipt[key]
    if (key === 'receipt_at') return localStamp(v as string | null)
    return v == null ? '' : String(v)
  }

  function pendingFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(draft)) out[key] = key === 'receipt_at' ? isoFromLocal(raw) : raw
    return out
  }

  async function confirm() {
    const fields = pendingFields()
    if (await patch({ ...(Object.keys(fields).length ? { fields } : {}), confirmed: true })) setDraft({})
  }

  async function saveField(key: keyof ReceiptFields) {
    if (!(key in draft)) return
    const raw = draft[key]
    const value = key === 'receipt_at' ? isoFromLocal(raw) : raw
    if (await patch({ fields: { [key]: value } })) setDraft(prev => { const next = { ...prev }; delete next[key]; return next })
  }

  function field(key: keyof ReceiptFields, label: string, type: 'text' | 'number' | 'datetime-local' = 'text') {
    const read = receipt.read as Record<string, unknown> | null
    const fromRead = read != null && !confirmed && !(key in draft) && receipt[key] != null && receipt[key] !== '' && read[key] === receipt[key]
    return (
      <label style={{ display: 'block', minWidth: 0 }}>
        <div style={LABEL}>{label}{fromRead ? ' · read' : ''}</div>
        <input
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={type === 'number' ? '0.01' : undefined}
          value={shown(key)}
          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
          onBlur={() => void saveField(key)}
          style={{ ...INPUT, borderStyle: fromRead ? 'dashed' : 'solid', borderColor: fromRead ? '#FBBF24' : 'var(--border)' }}
        />
      </label>
    )
  }

  function toggleLoad(photoId: string) {
    const ids = receipt.load_photo_ids.includes(photoId)
      ? receipt.load_photo_ids.filter(id => id !== photoId)
      : [...receipt.load_photo_ids, photoId]
    void patch({ load_photo_ids: ids })
  }

  async function remove() {
    if (!window.confirm(`Delete ${receiptLabel(receipt)}? The image is deleted too.`)) return
    setSaving(true)
    try {
      await call(base, { method: 'DELETE' })
      onDelete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
      setSaving(false)
    }
  }

  const missing = [
    receipt.total_inc_gst == null ? 'total' : '',
    loads && !receipt.load_photo_ids.length ? 'loads' : '',
  ].filter(Boolean)
  const showSuggestion = !confirmed && loads != null && suggested.length > 0
    && (suggested.length !== receipt.load_photo_ids.length || suggested.some(id => !receipt.load_photo_ids.includes(id)))

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 14, padding: 12, borderRadius: 12,
      border: `1px solid ${confirmed ? 'rgba(74,222,128,0.5)' : 'var(--border)'}`, background: 'var(--surface)',
    }}>
      <button type="button" onClick={() => setZoom(true)} aria-label="View receipt" style={{ padding: 0, border: 'none', background: 'var(--surface-2)', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', alignSelf: 'start' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={receipt.file_url} alt={receiptLabel(receipt)} loading="lazy" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block' }} />
      </button>
      <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{receiptLabel(receipt)}</span>
          {receipt.total_inc_gst != null && <span style={{ fontWeight: 700, color: '#10B981' }}>{money(receipt.total_inc_gst)}</span>}
          <span style={{ ...MUTED, fontSize: 12 }}>
            {reading ? 'Reading…' : receipt.read ? 'Read from the image. Check before confirming.' : 'Not read yet.'}
          </span>
          {!reading && !confirmed && (
            <button type="button" onClick={onRead} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
              {receipt.read ? 'Read again' : 'Read'}
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {field('supplier', 'Supplier / tip site')}
          {field('receipt_at', 'Date and time', 'datetime-local')}
          {field('docket_no', 'Docket no.')}
          {field('total_inc_gst', 'Total inc GST', 'number')}
          {field('gst', 'GST', 'number')}
          {field('weight_kg', 'Weight (kg)', 'number')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(120px, 1fr)', gap: 10, alignItems: 'end' }}>
          {field('tip_address', 'Tip address')}
          {field('distance_km', 'Trip km (return)', 'number')}
        </div>
        <div style={{ ...MUTED, fontSize: 12, marginTop: -4 }}>
          {trip === 'working'
            ? 'Working out the drive from the site and back…'
            : receipt.distance_km != null
              ? receipt.distance_from_maps
                ? receipt.distance_out_km != null
                  ? `Site → tip ${receipt.distance_out_km} km, back ${receipt.distance_return_km ?? receipt.distance_out_km} km, by road (Google Maps). Counted once for the loads it covers.`
                  : `Site → tip → site ${receipt.distance_km} km by road (Google Maps). Counted once for the loads it covers.`
                : 'Kilometres typed in. Counted once for the loads it covers.'
              : !receipt.tip_address
                ? 'Add the tip address to work out the drive from the site and back.'
                : !onWorkOutTrip
                  ? 'The job has no site address, so the drive cannot be worked out. Type the kilometres.'
                  : trip === 'failed'
                    ? 'Google Maps could not find a drive between the site and this address. Check it, or type the kilometres.'
                    : ''}
          {receipt.tip_address && onWorkOutTrip && trip !== 'working' && !saving && (
            <button type="button" onClick={onWorkOutTrip} style={{ marginLeft: 6, border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
              Work out again
            </button>
          )}
        </div>

        {loads && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={LABEL}>Covers loads</div>
            {loads.length === 0 ? (
              <div style={MUTED}>No loads on the record yet.</div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {loads.map(l => {
                  const on = receipt.load_photo_ids.includes(l.photoId)
                  const elsewhere = !on && linkedElsewhere.has(l.photoId)
                  const hint = !on && suggested.includes(l.photoId)
                  return (
                    <button
                      key={l.photoId}
                      type="button"
                      disabled={saving}
                      aria-pressed={on}
                      onClick={() => toggleLoad(l.photoId)}
                      title={elsewhere ? 'Already covered by another receipt' : hint ? 'Suggested' : undefined}
                      style={{
                        padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                        border: `${hint ? '2px dashed' : '1px solid'} ${on ? 'var(--accent)' : hint ? '#FBBF24' : 'var(--border)'}`,
                        background: on ? 'var(--accent-dim)' : 'transparent',
                        color: on ? 'var(--accent)' : elsewhere ? 'var(--text-muted)' : 'var(--text)',
                        opacity: elsewhere ? 0.6 : 1,
                      }}
                    >
                      {on ? '✓ ' : ''}Load {l.number}
                    </button>
                  )
                })}
                {showSuggestion && (
                  <button type="button" disabled={saving} onClick={() => void patch({ load_photo_ids: suggested })} style={{ border: 'none', background: 'none', color: '#FBBF24', fontSize: 12, fontWeight: 800, textDecoration: 'underline', cursor: 'pointer' }}>
                    Use suggestion ({suggested.length})
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {confirmed ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#4ADE80' }}>
                ✓ Confirmed{receipt.confirmed_by_name ? ` by ${receipt.confirmed_by_name}` : ''}{receipt.confirmed_at ? `, ${formatEventWhen(localStamp(receipt.confirmed_at))}` : ''}
              </span>
              <span style={{ ...MUTED, fontSize: 12 }}>Changes save as you go and update the loads.</span>
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void patch({ confirmed: false })} style={{ fontSize: 12, padding: '4px 10px' }}>
                Unconfirm
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" disabled={saving || reading} onClick={() => void confirm()} style={{ fontSize: 13, fontWeight: 800 }}>
                Confirm receipt
              </button>
              {missing.length > 0 && <span style={{ fontSize: 12, color: '#FBBF24' }}>No {missing.join(' or ')} yet.</span>}
            </>
          )}
          <span style={{ ...MUTED, fontSize: 12 }}>Uploaded by {receipt.uploaded_by_name || 'staff'}</span>
          <button type="button" disabled={saving} onClick={() => void remove()} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#F87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Delete
          </button>
        </div>
        {error && <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: '#F87171' }}>{error}</div>}
      </div>

      {zoom && (
        <div role="dialog" aria-label="Receipt" onClick={() => setZoom(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={receipt.file_url} alt={receiptLabel(receipt)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}
