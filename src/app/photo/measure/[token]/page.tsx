/*
 * app/photo/measure/[token]/page.tsx — room measuring from a QR code
 * (photo.biohazards.net/measure/<token>). No PIN: the link is the credential,
 * for one job, for a few hours. Name a room, type its length, width and height,
 * and it goes onto the job's surface area cleaning quote. Tapping a room already
 * on the quote loads it for a new size. Nothing here removes a room, and the
 * rate and price of the quote are never sent to this page.
 */
'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import { captureColumn as column, captureShell as shell } from '@/components/photoApp/CaptureSignIn'
import {
  SURFACE_AREA_ROOM_PRESETS,
  nextRoomName,
  parseRoomMeasure,
  roomSurfaceArea,
  type RoomMeasureView,
} from '@/lib/surfaceAreaCleaningQuote'

interface Info extends RoomMeasureView {
  job: { job_code: string | null; client_name: string | null; site_address: string | null }
  expires_at: string
}

type Room = RoomMeasureView['rooms'][number]

const USUAL_HEIGHT = '2.4'

const card: CSSProperties = { padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }
const fieldLabel: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }
const field: CSSProperties = {
  width: '100%', height: 52, padding: '0 12px', borderRadius: 12, fontSize: 20, fontWeight: 700,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
}
const chip: CSSProperties = {
  padding: '6px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
}

const PRESET_NAMES = SURFACE_AREA_ROOM_PRESETS.map(preset => preset.name)

function untilLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' })
}

function qty(n: number): string {
  return n.toLocaleString('en-AU', { maximumFractionDigits: 2 })
}

function metres(text: string): number | null {
  const n = text.trim() ? Number(text) : NaN
  return Number.isFinite(n) ? n : null
}

function sizeLabel(room: Room): string {
  if (room.length_m == null || room.width_m == null || room.height_m == null) return 'Not measured yet'
  return `${qty(room.length_m)} × ${qty(room.width_m)} × ${qty(room.height_m)} m`
}

export default function RoomMeasurePage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [closed, setClosed] = useState('')
  const [editing, setEditing] = useState<Room | null>(null)
  const [name, setName] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const lengthRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/photo/measure/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async res => {
        const data = (await res.json().catch(() => ({}))) as Partial<Info> & { error?: string }
        if (!res.ok || !data.job || !Array.isArray(data.rooms)) setClosed(data.error ?? 'This measure link is not available.')
        else setInfo(data as Info)
      })
      .catch(() => setClosed('Could not reach the server. Check the connection and reload.'))
  }, [token])

  function clearForm() {
    setEditing(null)
    setName('')
    setLength('')
    setWidth('')
    setHeight('')
    setError('')
  }

  function edit(room: Room) {
    setEditing(room)
    setName(room.name)
    setLength(room.length_m == null ? '' : String(room.length_m))
    setWidth(room.width_m == null ? '' : String(room.width_m))
    setHeight(room.height_m == null ? '' : String(room.height_m))
    setError('')
    setSavedNote('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    lengthRef.current?.focus()
  }

  async function save() {
    if (!info || saving || closed) return
    const body = { id: editing?.id ?? null, name, length_m: length, width_m: width, height_m: height }
    const checked = parseRoomMeasure(body)
    if (typeof checked === 'string') {
      setError(checked)
      return
    }
    setSaving(true)
    setError('')
    setSavedNote('')
    try {
      const res = await fetch(`/api/photo/measure/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checked),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<RoomMeasureView> & { room_id?: string; error?: string }
      if (res.status === 410 || res.status === 404) {
        setClosed(data.error ?? 'This measure link is closed.')
        return
      }
      if (!res.ok || !Array.isArray(data.rooms)) throw new Error(data.error ?? `The room could not be saved (${res.status})`)
      setInfo({ ...info, rooms: data.rooms, exclude_ceiling: data.exclude_ceiling === true, total_m2: data.total_m2 ?? null })
      const savedRoom = data.rooms.find(room => room.id === data.room_id)
      setSavedNote(`${checked.name} saved${savedRoom?.area_m2 != null ? `, ${qty(savedRoom.area_m2)} m²` : ''}. It is on the quote.`)
      clearForm()
      nameRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The room could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!info) {
    return (
      <div style={shell}>
        <div style={{ ...column, margin: 'auto', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{closed || 'Loading…'}</div>
        </div>
      </div>
    )
  }

  const measure = roomSurfaceArea({ length_m: metres(length), width_m: metres(width), height_m: metres(height) })
  const liveTotal = measure ? (info.exclude_ceiling ? measure.floor + measure.walls : measure.total) : null
  const otherNames = info.rooms.filter(room => room.id !== editing?.id).map(room => room.name)

  return (
    <div style={shell}>
      <div style={column}>
        <div style={card}>
          <div style={eyebrow}>Measure rooms for job</div>
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, color: '#FF6B35', marginTop: 4 }}>#{info.job.job_code ?? '----'}</div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{info.job.client_name || 'Unnamed client'}</div>
          {info.job.site_address && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{info.job.site_address}</div>}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {closed || `This link works until ${untilLabel(info.expires_at)}.`}
          </div>
        </div>

        <form
          style={{ ...card, display: 'grid', gap: 12 }}
          onSubmit={e => { e.preventDefault(); void save() }}
        >
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            {editing ? `New size for ${editing.name || 'this room'}` : 'Add a room'}
          </div>
          <div>
            <label htmlFor="room-name" style={fieldLabel}>Room name</label>
            <input
              id="room-name"
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Bedroom"
              autoCapitalize="words"
              autoComplete="off"
              enterKeyHint="next"
              style={field}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {PRESET_NAMES.map(preset => (
                <button
                  key={preset}
                  type="button"
                  style={chip}
                  onClick={() => { setName(nextRoomName(preset, otherNames)); lengthRef.current?.focus() }}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'start' }}>
            <div>
              <label htmlFor="room-length" style={fieldLabel}>Length (m)</label>
              <input id="room-length" ref={lengthRef} type="number" inputMode="decimal" min={0} step="0.01" value={length} onChange={e => setLength(e.target.value)} style={field} />
            </div>
            <div>
              <label htmlFor="room-width" style={fieldLabel}>Width (m)</label>
              <input id="room-width" type="number" inputMode="decimal" min={0} step="0.01" value={width} onChange={e => setWidth(e.target.value)} style={field} />
            </div>
            <div>
              <label htmlFor="room-height" style={fieldLabel}>Height (m)</label>
              <input id="room-height" type="number" inputMode="decimal" min={0} step="0.01" value={height} onChange={e => setHeight(e.target.value)} style={field} />
              <button type="button" style={{ ...chip, marginTop: 8, width: '100%' }} onClick={() => setHeight(USUAL_HEIGHT)}>
                {USUAL_HEIGHT} m
              </button>
            </div>
          </div>
          <div style={{ fontSize: 14, minHeight: 40 }}>
            {measure && liveTotal != null ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 900 }}>{qty(liveTotal)} m²</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Floor {qty(measure.floor)} m², walls {qty(measure.walls)} m²
                  {info.exclude_ceiling ? '. The ceiling is left out on this quote.' : `, ceiling ${qty(measure.ceiling)} m²`}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Type the length, width and height to see the square metres.</div>
            )}
          </div>
          {(closed || error) && (
            <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 14 }}>
              {closed || error}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || Boolean(closed)}
            style={{ padding: '16px', fontSize: 18, fontWeight: 900 }}
          >
            {saving ? 'Saving…' : editing ? 'Save new size' : 'Add room'}
          </button>
          {editing && (
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={clearForm}>
              Cancel, add a new room instead
            </button>
          )}
          {savedNote && <div role="status" style={{ fontSize: 14, fontWeight: 700, color: '#4ADE80' }}>{savedNote}</div>}
        </form>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={eyebrow}>Rooms on this quote</div>
            {info.total_m2 != null && <div style={{ fontWeight: 800 }}>{qty(info.total_m2)} m²</div>}
          </div>
          {info.rooms.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No rooms yet.</div>}
          {info.rooms.map(room => (
            <button
              key={room.id}
              type="button"
              onClick={() => edit(room)}
              disabled={Boolean(closed)}
              style={{
                ...card,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, textAlign: 'left',
                color: 'var(--text)', cursor: 'pointer',
                borderColor: editing?.id === room.id ? '#FF6B35' : 'var(--border)',
              }}
            >
              <span>
                <span style={{ display: 'block', fontWeight: 800, fontSize: 16 }}>{room.name || 'Unnamed room'}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)' }}>{sizeLabel(room)}</span>
              </span>
              <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{room.area_m2 != null ? `${qty(room.area_m2)} m²` : '—'}</span>
            </button>
          ))}
          {info.rooms.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tap a room to give it a new size.</div>
          )}
        </div>
      </div>
    </div>
  )
}
