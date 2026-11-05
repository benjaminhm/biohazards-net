'use client'

/*
 * components/workspace/AgentDraftsBanner.tsx
 *
 * Classic job page: "N agent changes waiting. Review" so drafts made in the
 * Agent view are never invisible here. Same approve / reject controls.
 */
import { useEffect, useState } from 'react'
import DraftList, { type DraftView } from './DraftList'

export default function AgentDraftsBanner({ jobId, onApplied }: { jobId: string; onApplied?: () => void }) {
  const [drafts, setDrafts] = useState<DraftView[]>([])
  const [open, setOpen] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    fetch(`/api/agent/drafts?job_id=${jobId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live && d) setDrafts(d.drafts ?? []) })
      .catch(() => {})
    return () => { live = false }
  }, [jobId, reload])
  const load = () => setReload(n => n + 1)

  if (!drafts.length) return null
  return (
    <div className="container" style={{ marginTop: 12 }}>
      {open ? (
        <DraftList
          drafts={drafts}
          onDecided={() => {
            void load()
            onApplied?.()
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
            border: '1px solid rgba(255,107,53,0.35)', background: 'var(--accent-dim)', color: 'var(--text)', fontSize: 14,
          }}
        >
          <strong style={{ color: 'var(--accent)' }}>
            {drafts.length} agent change{drafts.length === 1 ? '' : 's'} waiting.
          </strong>{' '}
          Review
        </button>
      )}
    </div>
  )
}
