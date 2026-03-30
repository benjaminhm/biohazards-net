'use client'

import { useState } from 'react'
import type { Document } from '@/lib/types'

interface Props {
  documents: Document[]
  clientName: string
  clientEmail: string
  onDocumentDeleted: (id: string) => void
}

const TYPE_LABELS: Record<string, string> = {
  quote: 'Quote',
  sow: 'Scope of Work',
  report: 'Completion Report',
}

function DocRow({ doc, clientName, clientEmail, onDeleted }: { doc: Document; clientName: string; clientEmail: string; onDeleted: (id: string) => void }) {
  const [copied, setCopied]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const printUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/print/${doc.id}`

  function copyLink() {
    navigator.clipboard.writeText(printUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      onDeleted(doc.id)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{TYPE_LABELS[doc.type] ?? doc.type}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {new Date(doc.created_at).toLocaleDateString('en-AU', {
              day: '2-digit', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={copyLink} className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }}>
            {copied ? '✓ Copied' : '🔗 Copy Link'}
          </button>
          <a
            href={`mailto:${clientEmail}?subject=${encodeURIComponent(`${TYPE_LABELS[doc.type] ?? doc.type} — ${clientName}`)}&body=${encodeURIComponent(`Hi ${clientName.split(' ')[0]},\n\nPlease find your ${(TYPE_LABELS[doc.type] ?? doc.type).toLowerCase()} at the link below:\n\n${printUrl}\n\nPlease don't hesitate to reach out if you have any questions.\n\nKind regards`)}`}
          >
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }}>✉️ Email</button>
          </a>
          <a href={printUrl} target="_blank" rel="noopener noreferrer">
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }}>↗ Open</button>
          </a>
          {confirmDelete ? (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ fontSize: 12, padding: '8px 12px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                {deleting ? '…' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ fontSize: 18, padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
              title="Delete document"
            >
              🗑
            </button>
          )}
        </div>
      </div>
      <div
        onClick={copyLink}
        style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', wordBreak: 'break-all', cursor: 'pointer', userSelect: 'all' }}
        title="Click to copy"
      >
        {printUrl}
      </div>
    </div>
  )
}

export default function DocumentsTab({ documents, clientName, clientEmail, onDocumentDeleted }: Props) {
  if (documents.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No documents yet</div>
        <div style={{ fontSize: 13 }}>Use the Generate buttons below to create documents</div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {documents.map(doc => <DocRow key={doc.id} doc={doc} clientName={clientName} clientEmail={clientEmail} onDeleted={onDocumentDeleted} />)}
    </div>
  )
}
