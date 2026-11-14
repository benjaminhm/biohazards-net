/*
 * The facts every job photo carries: when it was taken, where, and who loaded it.
 */
'use client'

import type { CSSProperties } from 'react'
import type { Photo } from '@/lib/types'
import { photoMeta } from '@/lib/photoSelection'

const LINE: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

export default function PhotoMeta({ photo, compact = false }: { photo: Photo; compact?: boolean }) {
  const meta = photoMeta(photo)
  return (
    <div style={{ display: 'grid', gap: 1, fontSize: compact ? 10 : 11, color: 'var(--text-muted)', lineHeight: 1.4, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
      <div style={LINE} title={meta.whenIsUpload ? 'No camera time. This is when it was loaded.' : 'When it was taken'}>
        {meta.when ? `${meta.when}${meta.whenIsUpload ? ' (loaded)' : ''}` : 'No time'}
      </div>
      <div style={LINE} title={meta.place || undefined}>
        {meta.place
          ? meta.mapUrl
            ? <a href={meta.mapUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'inherit' }}>{meta.place}</a>
            : meta.place
          : 'No location'}
      </div>
      {meta.by && <div style={LINE} title={meta.by}>{meta.by}</div>}
    </div>
  )
}
