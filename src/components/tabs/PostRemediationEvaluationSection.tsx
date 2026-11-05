/*
 * Verify → Post Remediation Evaluation host. Staff choose a single-quote PRE
 * (one linked quote, or none) or a multi-part PRE (Part A BCQ / B CCQ / C SACQ).
 * Opens on whichever kind was edited most recently.
 */
'use client'

import { useState } from 'react'
import type { Document, Job, Photo } from '@/lib/types'
import { getPres, getPreV2s } from '@/lib/postRemediationEvaluations'
import { confirmLeaveWhenUnsaved, useUnsavedChanges } from '@/lib/unsavedChangesContext'
import PostRemediationEvaluationTab from '@/components/tabs/PostRemediationEvaluationTab'
import PostRemediationEvaluationV2Tab from '@/components/tabs/PostRemediationEvaluationV2Tab'

interface Props {
  job: Job
  photos: Photo[]
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

type Mode = 'single' | 'multi'

function newestMode(job: Job): Mode {
  const newest = (list: { updated_at: string }[]) => Math.max(0, ...list.map(p => +new Date(p.updated_at) || 0))
  return newest(getPreV2s(job.assessment_data)) > newest(getPres(job.assessment_data)) ? 'multi' : 'single'
}

export default function PostRemediationEvaluationSection(props: Props) {
  const [mode, setMode] = useState<Mode>(() => newestMode(props.job))
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
      <div role="tablist" aria-label="PRE kind" style={{ display: 'flex', gap: 8, margin: '12px 0 18px' }}>
        {option('single', 'Single quote')}
        {option('multi', 'Multi-part (A/B/C)')}
      </div>
      {mode === 'single' ? <PostRemediationEvaluationTab {...props} /> : <PostRemediationEvaluationV2Tab {...props} />}
    </div>
  )
}
