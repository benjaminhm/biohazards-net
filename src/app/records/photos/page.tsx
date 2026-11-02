'use client'

import { useEffect, useState } from 'react'
import { ScreenBar } from '@/components/records/ScreenBar'

interface StandalonePhotoRow {
  id: string
  person_id: string
  person_name: string
  person_code: string
  job_code: string
  job_id: string | null
  device_time: string
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  stamp_text: string
  note: string
  url: string | null
}

export default function RecordsPhotosPage() {
  const [photos, setPhotos] = useState<StandalonePhotoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/records/photos')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Could not load field photos.')
        setPhotos(data.photos ?? [])
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load field photos.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 32 }}>
      <ScreenBar title="Field Photos" sub="Captured via photo.forensiccleaningqld.com.au" back="/records" />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {loading && <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading…</p>}
        {!loading && photos.length === 0 && (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            No standalone field photos yet. Set a 4-digit Photo PIN on Technicians and open <strong>/photo</strong> or <strong>photo.forensiccleaningqld.com.au</strong>.
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {photos.map(item => (
            <div
              key={item.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={item.stamp_text}
                    style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block', background: '#000' }}
                  />
                </a>
              )}
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <div style={{ fontWeight: 800, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {item.person_name}{' '}
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                      ({item.person_code})
                    </span>
                  </span>
                  {item.job_code && (
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#FF6B35' }}>
                      JOB {item.job_code}
                    </span>
                  )}
                </div>
                {item.note && <div style={{ color: 'var(--text)' }}>{item.note}</div>}
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word' }}>
                  {item.stamp_text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
