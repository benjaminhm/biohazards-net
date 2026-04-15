/*
 * Quote capture — intentionally reset to an empty room.
 * No AI and no persistence wiring.
 */
'use client'

import type { Job, Document } from '@/lib/types'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onGoToScope?: () => void
}

export default function QuoteCaptureTab(_props: Props) {
  return (
    <div
      style={{
        minHeight: 320,
        border: '1px dashed var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
        padding: 20,
        color: 'var(--text-muted)',
      }}
    >
      Quote Capture (empty room)
    </div>
  )
}
