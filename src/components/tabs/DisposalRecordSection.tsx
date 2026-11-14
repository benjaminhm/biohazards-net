/*
 * Execute → Contents Disposal Record host. Staff work photos first (loads built
 * from sorted photos) or in the classic form (every field typed per load).
 * Both edit the same record. It opens photos first, unless the record was
 * already entered in the classic form.
 */
'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import type { Job, Photo } from '@/lib/types'
import { loadHasContent, mergedDisposalManifestCapture } from '@/lib/disposalManifest'
import { isTimelineLoad } from '@/lib/disposalTimeline'
import { confirmLeaveWhenUnsaved, useUnsavedChanges } from '@/lib/unsavedChangesContext'
import DisposalManifestCaptureTab from '@/components/tabs/DisposalManifestCaptureTab'
import DisposalRecordV2Tab from '@/components/tabs/DisposalRecordV2Tab'

interface Props {
  job: Job
  photos: Photo[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: Dispatch<SetStateAction<Photo[]>>
}

type Mode = 'photos' | 'classic'

function startMode(job: Job, photos: Photo[]): Mode {
  const loads = mergedDisposalManifestCapture(job.assessment_data).loads
  if (loads.some(isTimelineLoad) || photos.some(p => p.cdr_load != null)) return 'photos'
  return loads.some(loadHasContent) ? 'classic' : 'photos'
}

export default function DisposalRecordSection(props: Props) {
  const [mode, setMode] = useState<Mode>(() => startMode(props.job, props.photos))
  const { hasUnsaved } = useUnsavedChanges()

  const pick = (next: Mode) => {
    if (next === mode || !confirmLeaveWhenUnsaved(hasUnsaved)) return
    setMode(next)
  }

  const option = (id: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === id}
      onClick={() => pick(id)}
      style={{
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 700,
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: mode === id ? 'var(--accent)' : 'var(--surface)',
        color: mode === id ? '#fff' : 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div role="tablist" aria-label="Disposal record entry" style={{ display: 'flex', gap: 8, margin: '12px 0 18px' }}>
        {option('photos', 'Photos first')}
        {option('classic', 'Classic form')}
      </div>
      {mode === 'photos' ? <DisposalRecordV2Tab {...props} /> : <DisposalManifestCaptureTab {...props} />}
    </div>
  )
}
