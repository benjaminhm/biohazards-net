'use client'

import { useState, useEffect, useMemo } from 'react'
import type { DocType, Document, Photo, CompanyProfile } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'

interface Props {
  jobId: string
  type: DocType
  content: object | null   // null = still generating
  photos: Photo[]
  onClose: () => void
  onSaved: (doc: Document) => void
}

const TYPE_LABELS: Record<DocType, string> = {
  quote:  'Quote',
  sow:    'Scope of Work',
  report: 'Completion Report',
}

export default function GenerateModal({ jobId, type, content, photos, onClose, onSaved }: Props) {
  const [draft, setDraft]         = useState(content ? JSON.stringify(content, null, 2) : '')
  const [view, setView]           = useState<'json' | 'preview'>('preview')

  // When content arrives from parent (async generation), populate draft
  useEffect(() => {
    if (content) setDraft(JSON.stringify(content, null, 2))
  }, [content])
  const [company, setCompany]     = useState<CompanyProfile | null>(null)
  const [saving, setSaving]       = useState(false)
  const [savingStep, setSavingStep] = useState('')
  const [error, setError]         = useState('')

  // Chat-edit state
  const [instruction, setInstruction] = useState('')
  const [applying, setApplying]       = useState(false)
  const [applyError, setApplyError]   = useState('')

  // Fetch company profile for preview
  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
      .catch(() => {})
  }, [])

  // Build preview HTML whenever draft or company changes
  const previewHtml = useMemo(() => {
    try {
      const parsed = JSON.parse(draft)
      const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
      return buildPrintHTML(type, parsed, photos, company, jobId, appUrl)
    } catch {
      return '<body style="font:14px sans-serif;padding:24px;color:#888">Invalid JSON — fix the editor to see preview</body>'
    }
  }, [draft, company, type, photos, jobId])

  // Apply a chat instruction via Claude
  async function applyInstruction() {
    if (!instruction.trim()) return
    setApplying(true)
    setApplyError('')
    try {
      let parsed: object
      try { parsed = JSON.parse(draft) } catch {
        setApplyError('Fix the JSON errors first before applying an instruction.')
        return
      }
      const res = await fetch('/api/edit-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content: parsed, instruction }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setDraft(JSON.stringify(data.content, null, 2))
      setInstruction('')
      setView('preview')
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setApplying(false)
    }
  }

  async function saveAndOpen() {
    setSaving(true)
    setError('')
    try {
      let parsed: object
      try {
        parsed = JSON.parse(draft)
      } catch {
        setError('Invalid JSON — fix the document content before saving.')
        return
      }

      setSavingStep('Saving...')
      const saveRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, type, content: parsed, file_url: null }),
      })
      const { document: savedDoc, error: saveErr } = await saveRes.json()
      if (saveErr) throw new Error(saveErr)

      const printUrl = `/api/print/${savedDoc.id}`
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
      setError(err instanceof Error ? err.message : 'Failed to save document')
    } finally {
      setSaving(false)
      setSavingStep('')
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0, gap: 12,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{TYPE_LABELS[type]}</div>

        {/* View toggle */}
        <div style={{
          display: 'flex', gap: 2,
          background: 'var(--bg)', borderRadius: 8, padding: 3,
        }}>
          {(['preview', 'json'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                background: view === v ? 'var(--accent)' : 'transparent',
                color: view === v ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {v === 'preview' ? '👁 Preview' : '{ } JSON'}
            </button>
          ))}
        </div>

        <button onClick={onClose} style={{ fontSize: 20, color: 'var(--text-muted)', padding: '2px 8px', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>

      {/* ── Chat-edit bar ── */}
      <div style={{
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        padding: '10px 14px',
        display: 'flex', gap: 8, alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>✨</span>
        <input
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyInstruction() } }}
          placeholder='Edit with AI — e.g. "remove the PPE line item" or "change payment terms to net 14"'
          style={{
            flex: 1, fontSize: 13,
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 7, padding: '8px 12px', color: 'var(--text)',
            outline: 'none',
          }}
          disabled={applying || !content}
        />
        <button
          onClick={applyInstruction}
          disabled={applying || !instruction.trim() || !content}
          style={{
            padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700,
            background: 'var(--accent)', color: '#fff', border: 'none',
            cursor: applying || !instruction.trim() ? 'not-allowed' : 'pointer',
            opacity: applying || !instruction.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {applying ? <><span className="spinner" /> Applying...</> : 'Apply'}
        </button>
      </div>
      {applyError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', padding: '8px 14px', fontSize: 12, color: '#F87171', flexShrink: 0 }}>
          {applyError}
        </div>
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {!content ? (
          /* Loading state while Claude writes */
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 20,
            background: 'var(--bg)', color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: 36 }}>✍️</div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>
              Claude is writing your {TYPE_LABELS[type].toLowerCase()}…
            </div>
            <div style={{ fontSize: 13 }}>This usually takes 10–20 seconds</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: `pulse 1.2s ease-in-out ${i * 0.4}s infinite`,
                }} />
              ))}
            </div>
            <style>{`@keyframes pulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
          </div>
        ) : view === 'preview' ? (
          <iframe
            srcDoc={previewHtml}
            style={{ flex: 1, border: 'none', background: '#fff' }}
            sandbox="allow-same-origin allow-popups"
            title="Document preview"
          />
        ) : (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            style={{
              flex: 1, resize: 'none',
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: 12, lineHeight: 1.6,
              background: 'var(--bg)', border: 'none',
              padding: 16, color: 'var(--text)',
              outline: 'none',
            }}
          />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        background: 'var(--surface)', borderTop: '1px solid var(--border)',
        padding: '12px 16px', display: 'flex', gap: 10, flexShrink: 0,
      }}>
        {error && (
          <div style={{
            flex: 1, background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '10px 14px',
            color: '#F87171', fontSize: 13,
          }}>
            {error}
          </div>
        )}
        {!error && <>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            {content ? 'Discard' : 'Cancel'}
          </button>
          <button
            onClick={saveAndOpen}
            disabled={saving || !content}
            className="btn btn-primary"
            style={{ flex: 2, fontSize: 15, opacity: !content ? 0.4 : 1 }}
          >
            {saving
              ? <><span className="spinner" /> {savingStep || 'Saving...'}</>
              : '↗ Save & Open'
            }
          </button>
        </>}
      </div>
    </div>
  )
}
