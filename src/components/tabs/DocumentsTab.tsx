'use client'

import { useState } from 'react'
import type { Document } from '@/lib/types'

interface Props {
  documents: Document[]
}

const TYPE_LABELS: Record<string, string> = {
  quote: 'Quote',
  sow: 'Scope of Work',
  report: 'Completion Report',
}

function DocRow({ doc }: { doc: Document }) {
  const [copied, setCopied] = useState(false)

  const printUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/print/${doc.id}`

  function copyLink() {
    navigator.clipboard.writeText(printUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={copyLink}
            className="btn btn-secondary"
            style={{ fontSize: 13, padding: '8px 14px' }}
          >
            {copied ? '✓ Copied' : '🔗 Copy Link'}
          </button>
          <a href={printUrl} target="_blank" rel="noopener noreferrer">
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }}>
              ↗ Open
            </button>
          </a>
        </div>
      </div>
      {/* Copyable URL bar */}
      <div
        onClick={copyLink}
        style={{
          fontSize: 11, color: 'var(--text-muted)',
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '7px 10px',
          wordBreak: 'break-all', cursor: 'pointer',
          userSelect: 'all',
        }}
        title="Click to copy"
      >
        {printUrl}
      </div>
    </div>
  )
}

export default function DocumentsTab({ documents }: Props) {
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
      {documents.map(doc => <DocRow key={doc.id} doc={doc} />)}
    </div>
  )
}
