'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, DocType } from '@/lib/types'
import { DOC_TYPE_LABELS, DOC_TYPE_GROUPS } from '@/lib/types'

interface Props {
  jobId: string
  documents: Document[]
  clientName: string
  clientEmail: string
  onDocumentDeleted: (id: string) => void
}

function DocRow({ doc, jobId, clientName, clientEmail, onDeleted }: {
  doc: Document; jobId: string; clientName: string; clientEmail: string; onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [copied,        setCopied]        = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const printUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/print/${doc.id}`
  const label    = DOC_TYPE_LABELS[doc.type as DocType] ?? doc.type

  function copyLink() {
    navigator.clipboard.writeText(printUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      onDeleted(doc.id)
    } finally { setDeleting(false); setConfirmDelete(false) }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {new Date(doc.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Edit in editor */}
          <button
            onClick={() => router.push(`/jobs/${jobId}/docs/${doc.type}?docId=${doc.id}`)}
            className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}
          >✏️ Edit</button>
          {/* Copy link */}
          <button onClick={copyLink} className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>
            {copied ? '✓ Copied' : '🔗 Link'}
          </button>
          {/* Email */}
          <a href={`mailto:${clientEmail}?subject=${encodeURIComponent(`${label} — ${clientName}`)}&body=${encodeURIComponent(`Hi ${clientName.split(' ')[0]},\n\nPlease find your ${label.toLowerCase()} at the link below:\n\n${printUrl}\n\nKind regards`)}`}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>✉️ Email</button>
          </a>
          {/* Open print page */}
          <a href={printUrl} target="_blank" rel="noopener noreferrer">
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>↗ Open</button>
          </a>
          {/* Delete */}
          {confirmDelete ? (
            <>
              <button onClick={handleDelete} disabled={deleting}
                style={{ fontSize: 12, padding: '7px 12px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {deleting ? '…' : 'Delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                style={{ fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Keep
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              style={{ fontSize: 16, padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              🗑
            </button>
          )}
        </div>
      </div>
      {/* Copyable link */}
      <div onClick={copyLink} title="Click to copy"
        style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', wordBreak: 'break-all', cursor: 'pointer', userSelect: 'all' }}>
        {printUrl}
      </div>
    </div>
  )
}

export default function DocumentsTab({ jobId, documents, clientName, clientEmail, onDocumentDeleted }: Props) {
  const router = useRouter()

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── Create section ─────────────────────────────────────────────────── */}
      {DOC_TYPE_GROUPS.map(group => (
        <div key={group.label} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
            Create — {group.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {group.types.map(type => (
              <button
                key={type}
                onClick={() => router.push(`/jobs/${jobId}/docs/${type}`)}
                style={{
                  padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text)', cursor: 'pointer',
                }}
                onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                + {DOC_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ── Saved documents ────────────────────────────────────────────────── */}
      {documents.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
            Saved Documents
          </div>
          {documents.map(doc => (
            <DocRow
              key={doc.id}
              doc={doc}
              jobId={jobId}
              clientName={clientName}
              clientEmail={clientEmail}
              onDeleted={onDocumentDeleted}
            />
          ))}
        </div>
      )}

      {documents.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
          No saved documents yet — create one above.
        </div>
      )}
    </div>
  )
}
