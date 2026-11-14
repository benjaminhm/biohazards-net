'use client'

/*
 * "Phone upload" on the Photos tab: a QR code for the job's temporary upload
 * link (lib/photoUploadLink). Scanning it opens a page that adds photos to this
 * job's folder for 2 hours. While open, the folder refreshes so new photos
 * appear as they land. Stop link ends it early.
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { Photo } from '@/lib/types'

interface Link { url: string; expires_at: string; created_by_name: string }

const REFRESH_MS = 5000

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' })
}

export default function PhoneUploadQr({ jobId, photoCount, onPhotosUpdate, onClose }: {
  jobId: string
  photoCount: number
  onPhotosUpdate: (photos: Photo[]) => void
  onClose: () => void
}) {
  const [link, setLink] = useState<Link | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  const [copied, setCopied] = useState(false)
  const [startCount] = useState(photoCount)

  useEffect(() => {
    let alive = true
    fetch(`/api/jobs/${jobId}/upload-links`, { method: 'POST' })
      .then(async res => {
        const data = (await res.json().catch(() => ({}))) as { link?: Link; error?: string }
        if (!alive) return
        if (!res.ok || !data.link) throw new Error(data.error ?? 'Could not make the link')
        setLink(data.link)
        setQr(await QRCode.toDataURL(data.link.url, { margin: 1, width: 280, errorCorrectionLevel: 'M' }))
      })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not make the link') })
    return () => { alive = false }
  }, [jobId])

  useEffect(() => {
    if (!link) return
    const timer = setInterval(() => {
      fetch(`/api/jobs/${jobId}`, { cache: 'no-store' })
        .then(res => (res.ok ? res.json() : null))
        .then((data: { photos?: Photo[] } | null) => { if (data?.photos) onPhotosUpdate(data.photos) })
        .catch(() => {})
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [link, jobId, onPhotosUpdate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function stop() {
    if (!window.confirm('Stop this upload link? The QR code will no longer work.')) return
    setStopping(true)
    const res = await fetch(`/api/jobs/${jobId}/upload-links`, { method: 'DELETE' }).catch(() => null)
    setStopping(false)
    if (!res?.ok) {
      setError('Could not stop the link. Try again.')
      return
    }
    onClose()
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const added = Math.max(0, photoCount - startCount)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Phone upload"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'grid', gap: 12, textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, textAlign: 'left', fontSize: 18, fontWeight: 800 }}>Phone upload</div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ fontSize: 18, padding: '4px 10px' }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, textAlign: 'left' }}>
          Scan with your phone camera, then pick photos. They go into this job&rsquo;s folder, untagged.
        </div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code for the phone upload link" width={280} height={280} style={{ margin: '0 auto', borderRadius: 8, background: '#fff' }} />
        ) : (
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            {error || 'Making the link…'}
          </div>
        )}
        {link && (
          <>
            <div style={{ fontSize: 13 }}>
              Works until <strong>{timeLabel(link.expires_at)}</strong>
              {added > 0 && <> · <span style={{ color: '#4ADE80', fontWeight: 700 }}>{added} new photo{added === 1 ? '' : 's'}</span></>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Photos are credited to {link.created_by_name}.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => void copy()} style={{ fontSize: 13 }}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={stopping} onClick={() => void stop()} style={{ fontSize: 13, color: '#F87171' }}>
                {stopping ? 'Stopping…' : 'Stop link'}
              </button>
            </div>
          </>
        )}
        {error && qr && <div role="alert" style={{ color: '#F87171', fontSize: 13 }}>{error}</div>}
      </div>
    </div>
  )
}
