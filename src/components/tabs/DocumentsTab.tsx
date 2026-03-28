'use client'

import type { Document } from '@/lib/types'

interface Props {
  documents: Document[]
}

const TYPE_LABELS: Record<string, string> = {
  quote: 'Quote',
  sow: 'Scope of Work',
  report: 'Completion Report',
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
      {documents.map(doc => (
        <div key={doc.id} className="card" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{TYPE_LABELS[doc.type] ?? doc.type}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {new Date(doc.created_at).toLocaleDateString('en-AU', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </div>
          </div>
          {doc.file_url ? (
            <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
              <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 16px' }}>
                Download PDF
              </button>
            </a>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No file</span>
          )}
        </div>
      ))}
    </div>
  )
}
