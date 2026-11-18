'use client'

import { useEffect, useState } from 'react'

interface SpatialScan {
  id: string
  person_name: string
  person_code: string
  started_at: string
  duration_s: number | null
  note: string
  lat: number | null
  lng: number | null
  mesh_url: string | null
  video_url: string | null
  timeline_url: string | null
}

function when(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(t)
}

function duration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`
}

export default function SpatialScansPanel({ jobId }: { jobId: string }) {
  const [scans, setScans] = useState<SpatialScan[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/jobs/${jobId}/scans`, { cache: 'no-store' })
      .then(async res => {
        const data = (await res.json().catch(() => ({}))) as { scans?: SpatialScan[]; error?: string }
        if (!res.ok || !data.scans) throw new Error(data.error || 'Could not load scans')
        if (!cancelled) setScans(data.scans)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load scans')
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (error) return <div role="alert" style={{ color: '#F87171', fontSize: 13 }}>{error}</div>
  if (!scans) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading scans…</div>
  if (scans.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
        No LiDAR scans on this job yet. Scans from the Field app land here with the walkthrough video.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {scans.map(scan => (
        <div key={scan.id} className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 800 }}>
            {when(scan.started_at)}
            {duration(scan.duration_s) ? ` · ${duration(scan.duration_s)}` : ''}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {scan.person_name} ({scan.person_code})
            {scan.lat != null && scan.lng != null ? ` · ${scan.lat.toFixed(5)}, ${scan.lng.toFixed(5)}` : ''}
          </div>
          {scan.note ? <div style={{ fontSize: 14, marginTop: 8 }}>{scan.note}</div> : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {scan.mesh_url && <a className="btn btn-secondary" href={scan.mesh_url} style={{ fontSize: 13 }}>3D mesh (.usdz)</a>}
            {scan.video_url && <a className="btn btn-secondary" href={scan.video_url} style={{ fontSize: 13 }}>Walkthrough video</a>}
            {scan.timeline_url && <a className="btn btn-secondary" href={scan.timeline_url} style={{ fontSize: 13 }}>Timestamps</a>}
          </div>
        </div>
      ))}
    </div>
  )
}
