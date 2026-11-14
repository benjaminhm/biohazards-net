/*
 * app/photo/drop/[token]/page.tsx — phone upload from a QR code
 * (photo.biohazards.net/drop/<token>). No PIN: the link is the credential,
 * for one job, for a few hours. Pick photos, and each one is compressed on the
 * phone (keeping camera time and GPS) and added untagged to the job's folder.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { captureColumn as column, captureShell as shell } from '@/components/photoApp/CaptureSignIn'
import { compressImage } from '@/lib/compressImage'
import { readPhotoExif } from '@/lib/photoExif'

interface LinkInfo {
  job: { job_code: string | null; client_name: string | null; site_address: string | null }
  expires_at: string
}

type Status = 'waiting' | 'uploading' | 'done' | 'failed'
interface Item { id: string; file: File; preview: string; status: Status; error?: string }

const CONCURRENCY = 3

class ClosedError extends Error {}

async function uploadOne(token: string, file: File): Promise<void> {
  const exif = await readPhotoExif(file).catch(() => null)
  let compressed: Blob
  try {
    compressed = await compressImage(file)
  } catch {
    throw new Error(/\.hei[cf]$/i.test(file.name) ? 'HEIC not supported here — export as JPEG' : 'Could not read this image')
  }
  const body = new FormData()
  body.append('file', compressed, 'photo.jpg')
  if (exif?.takenAt) {
    const t = new Date(exif.takenAt)
    if (!Number.isNaN(t.getTime())) body.append('taken_at', t.toISOString())
  }
  if (exif?.lat != null && exif?.lng != null) {
    body.append('lat', String(exif.lat))
    body.append('lng', String(exif.lng))
  }
  const res = await fetch(`/api/photo/drop/${encodeURIComponent(token)}`, { method: 'POST', body })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 410 || res.status === 404) throw new ClosedError(data.error ?? 'This upload link is closed.')
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`)
}

function untilLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' })
}

export default function PhotoDropPage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [closed, setClosed] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    fetch(`/api/photo/drop/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async res => {
        const data = (await res.json().catch(() => ({}))) as Partial<LinkInfo> & { error?: string }
        if (!res.ok || !data.job) setClosed(data.error ?? 'This upload link is not available.')
        else setInfo(data as LinkInfo)
      })
      .catch(() => setClosed('Could not reach the server. Check the connection and reload.'))
  }, [token])

  useEffect(() => () => { for (const it of itemsRef.current) URL.revokeObjectURL(it.preview) }, [])

  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  function patch(id: string, next: Partial<Item>) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...next } : it)))
  }

  async function run(queue: Item[]) {
    if (!queue.length) return
    setRunning(true)
    let stop = false
    let next = 0
    const worker = async () => {
      while (!stop && next < queue.length) {
        const it = queue[next++]
        patch(it.id, { status: 'uploading', error: undefined })
        try {
          await uploadOne(token, it.file)
          patch(it.id, { status: 'done' })
        } catch (e) {
          if (e instanceof ClosedError) {
            stop = true
            setClosed(e.message)
          }
          patch(it.id, { status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setRunning(false)
  }

  function addFiles(list: FileList) {
    const images = Array.from(list).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|hei[cf])$/i.test(f.name))
    if (!images.length) return
    const added = images.map(file => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: 'waiting' as const }))
    setItems(prev => [...prev, ...added])
    void run(added)
  }

  const done = items.filter(it => it.status === 'done').length
  const failed = items.filter(it => it.status === 'failed')

  if (!info) {
    return (
      <div style={shell}>
        <div style={{ ...column, margin: 'auto', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{closed || 'Loading…'}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={shell}>
      <div style={column}>
        <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Add photos to job</div>
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, color: '#FF6B35', marginTop: 4 }}>#{info.job.job_code ?? '----'}</div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{info.job.client_name || 'Unnamed client'}</div>
          {info.job.site_address && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{info.job.site_address}</div>}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {closed || `This link works until ${untilLabel(info.expires_at)}.`}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(closed)}
          onClick={() => fileRef.current?.click()}
          style={{ padding: '18px 16px', fontSize: 18, fontWeight: 900 }}
        >
          {running ? 'Uploading… add more any time' : 'Add photos'}
        </button>

        {items.length > 0 && (
          <div style={{ fontSize: 14 }}>
            <strong>{done}</strong> of {items.length} uploaded
            {failed.length > 0 && <> · <span style={{ color: '#F87171' }}>{failed.length} failed</span></>}
            {failed.length > 0 && !running && !closed && (
              <button type="button" className="btn btn-secondary" onClick={() => void run(failed)} style={{ marginLeft: 10, fontSize: 13 }}>
                Retry
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {items.map(it => (
            <div key={it.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: it.status === 'done' ? 1 : 0.6 }} />
              <span
                title={it.error}
                style={{
                  position: 'absolute', left: 4, bottom: 4, padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                  background: 'rgba(0,0,0,0.72)',
                  color: it.status === 'done' ? '#4ADE80' : it.status === 'failed' ? '#F87171' : '#fff',
                }}
              >
                {it.status === 'done' ? '✓' : it.status === 'failed' ? 'Failed' : it.status === 'uploading' ? '…' : 'Waiting'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
