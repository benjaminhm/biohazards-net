/*
 * Composed document bundles: ordered saved documents → one print URL.
 */
'use client'

import { useState } from 'react'
import type { Document, DocumentBundle, DocType } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'

interface Props {
  jobId: string
  documents: Document[]
  bundles: DocumentBundle[]
  clientName: string
  clientEmail: string
  canCompose: boolean
  /** Same capability as editing documents — remove bundle */
  canDelete?: boolean
  onRefresh: () => void | Promise<void>
}

export default function DocumentBundlesSection({
  jobId,
  documents,
  bundles,
  clientName,
  clientEmail,
  canCompose,
  canDelete = false,
  onRefresh,
}: Props) {
  const [title, setTitle] = useState('Composed document')
  const [queue, setQueue] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const docLabel = (d: Document) =>
    `${DOC_TYPE_LABELS[d.type as DocType] ?? d.type} · ${new Date(d.created_at).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })}`

  function addToQueue(docId: string) {
    setQueue(q => (q.includes(docId) ? q : [...q, docId]))
    setError(null)
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= queue.length) return
    setQueue(q => {
      const next = [...q]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function removeAt(i: number) {
    setQueue(q => q.filter((_, k) => k !== i))
  }

  async function createBundle() {
    if (queue.length < 1) {
      setError('Add at least one document to the order.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobs/${jobId}/document-bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || 'Composed document', part_document_ids: queue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create bundle')
      setQueue([])
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteBundle(id: string) {
    if (!confirm('Remove this composed document? Saved source documents are kept.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/document-bundles/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Delete failed')
      }
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const available = documents.filter(d => !queue.includes(d.id))

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 10,
        }}
      >
        Composed documents
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, maxWidth: 560, lineHeight: 1.5 }}>
        Combine saved documents into one print view: numbered sections appear in order between a single header and footer.
      </p>

      {canCompose && documents.length > 0 && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            marginBottom: 18,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>New composed document</div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{
              width: '100%',
              maxWidth: 400,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 14,
              marginBottom: 12,
            }}
          />
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Order (1, 2, 3…)
          </label>
          {queue.length > 0 && (
            <ol style={{ margin: '0 0 12px 0', paddingLeft: 22, fontSize: 14 }}>
              {queue.map((docId, i) => {
                const d = documents.find(x => x.id === docId)
                if (!d) return null
                return (
                  <li key={`${docId}-${i}`} style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>{docLabel(d)}</span>
                    <span style={{ marginLeft: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }}
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }}
                        onClick={() => move(i, 1)}
                        disabled={i === queue.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => removeAt(i)}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
          {available.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <select
                defaultValue=""
                onChange={e => {
                  const v = e.target.value
                  if (v) {
                    addToQueue(v)
                    e.target.value = ''
                  }
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                  maxWidth: 320,
                }}
              >
                <option value="">Add document…</option>
                {available.map(d => (
                  <option key={d.id} value={d.id}>
                    {docLabel(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <div style={{ color: '#EF4444', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <button type="button" className="btn btn-primary" disabled={saving || queue.length < 1} onClick={() => void createBundle()}>
            {saving ? 'Saving…' : 'Create composed document'}
          </button>
        </div>
      )}

      {bundles.length > 0 && (
        <div>
          {bundles.map(b => {
            const printUrl =
              typeof window !== 'undefined' ? `${window.location.origin}/api/print/bundle/${b.id}` : ''
            return (
              <div
                key={b.id}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {(b.part_document_ids?.length ?? 0)} sections ·{' '}
                      {new Date(b.created_at).toLocaleDateString('en-AU', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <a href={`/api/print/bundle/${b.id}`} target="_blank" rel="noopener noreferrer">
                      <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>
                        ↗ Open
                      </button>
                    </a>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '7px 12px' }}
                      onClick={() => {
                        if (printUrl) void navigator.clipboard.writeText(printUrl)
                      }}
                    >
                      🔗 Copy link
                    </button>
                    <a
                      href={`mailto:${clientEmail}?subject=${encodeURIComponent(`${b.title} — ${clientName}`)}&body=${encodeURIComponent(`Hi ${clientName.split(' ')[0]},\n\nPlease find the composed document at:\n\n${printUrl}\n\nKind regards`)}`}
                    >
                      <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>
                        ✉️ Email
                      </button>
                    </a>
                    {canDelete && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '7px 12px', color: '#EF4444', borderColor: 'rgba(239,68,68,0.4)' }}
                        disabled={deletingId === b.id}
                        onClick={() => void deleteBundle(b.id)}
                      >
                        {deletingId === b.id ? '…' : 'Remove'}
                      </button>
                    )}
                  </div>
                </div>
                {printUrl && (
                  <div
                    onClick={() => void navigator.clipboard.writeText(printUrl)}
                    title="Click to copy"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      marginTop: 10,
                      wordBreak: 'break-all',
                      cursor: 'pointer',
                      userSelect: 'all',
                    }}
                  >
                    {printUrl}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
