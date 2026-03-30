'use client'

import { useState } from 'react'
import type { DocType, Document, Photo } from '@/lib/types'

interface Props {
  jobId: string
  type: DocType
  content: object
  photos: Photo[]
  onClose: () => void
  onSaved: (doc: Document) => void
}

const TYPE_LABELS: Record<DocType, string> = {
  quote: 'Quote',
  sow: 'Scope of Work',
  report: 'Completion Report',
}

export default function GenerateModal({ jobId, type, content, photos, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(JSON.stringify(content, null, 2))
  const [saving, setSaving] = useState(false)
  const [savingStep, setSavingStep] = useState('')
  const [error, setError] = useState('')

  async function saveAndOpen() {
    setSaving(true)
    setError('')
    try {
      // 1. Validate JSON
      let parsed: object
      try {
        parsed = JSON.parse(draft)
      } catch {
        setError('Invalid JSON — please fix the document content before saving.')
        setSaving(false)
        return
      }

      // 2. Save document record to DB
      setSavingStep('Saving record...')
      const saveRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, type, content: parsed, file_url: null }),
      })
      const { document: savedDoc, error: saveErr } = await saveRes.json()
      if (saveErr) throw new Error(saveErr)

      // 5. Navigate to the permanent print URL
      setSavingStep('Opening document...')
      const printUrl = `/api/print/${savedDoc.id}`

      // In PWA standalone mode window.open is blocked — navigate directly instead
      const isPWA =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as { standalone?: boolean }).standalone === true

      if (isPWA) {
        window.location.href = printUrl
      } else {
        window.open(printUrl, '_blank')
      }

      onSaved(savedDoc)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open document')
    } finally {
      setSaving(false)
      setSavingStep('')
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '14px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{TYPE_LABELS[type]}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Review and edit below — then open as a page to print / save as PDF
          </div>
        </div>
        <button onClick={onClose} style={{ fontSize: 20, color: 'var(--text-muted)', padding: '4px 8px' }}>✕</button>
      </div>

      <div style={{ height: 3, background: 'var(--accent)', flexShrink: 0 }} />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 20, gap: 16 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          style={{
            flex: 1,
            resize: 'none',
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 16,
            color: 'var(--text)',
          }}
        />

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#F87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            Discard
          </button>
          <button
            onClick={saveAndOpen}
            disabled={saving}
            className="btn btn-primary"
            style={{ flex: 2, fontSize: 15 }}
          >
            {saving
              ? <><span className="spinner" /> {savingStep || 'Working...'}</>
              : '↗ Save & Open Document'
            }
          </button>
        </div>
      </div>
    </div>
  )
}
