'use client'

import { useState } from 'react'

const FIELD_LABELS: Record<string, string> = {
  client_name: 'Client Name',
  client_phone: 'Phone',
  client_email: 'Email',
  site_address: 'Site Address',
  job_type: 'Job Type',
  urgency: 'Urgency',
  company_name: 'Company',
}

interface Props {
  onApply: (fields: Record<string, string>) => void
  sourceText?: string
  onSourceText?: (text: string) => void
}

export default function SmartFill({ onApply, sourceText, onSourceText }: Props) {
  const [open, setOpen] = useState(false)
  const [pastedText, setPastedText] = useState(sourceText ?? '')
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')

  async function extractDetails() {
    if (!pastedText.trim()) return
    setExtracting(true)
    setExtracted(null)
    setError('')
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pastedText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setExtracted(data.extracted)
    } catch {
      setError('Could not extract details — try again')
    } finally {
      setExtracting(false)
    }
  }

  function apply() {
    if (!extracted) return
    onApply(extracted)
    if (onSourceText) onSourceText(pastedText)
    setPastedText('')
    setExtracted(null)
    setOpen(false)
  }

  const hasResults = extracted && Object.values(extracted).some(v => v)

  return (
    <div style={{
      marginBottom: 24,
      border: '1px solid var(--accent)',
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 0 0 1px rgba(255,107,53,0.1)',
    }}>
      {/* Header button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 16px',
          background: 'rgba(255,107,53,0.08)',
          border: 'none',
          cursor: 'pointer',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14 }}>Smart Fill</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>paste a text, email or voicemail</span>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>
          {open ? '▲ Close' : '▼ Open'}
        </span>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: 16, background: 'var(--surface-2)', borderTop: '1px solid rgba(255,107,53,0.2)' }}>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder={`Paste anything here — a text message, email, or voicemail transcript.\n\nExample: "Hi, I'm Dave from Acme. Job at 14 Smith St Paddington, unattended death, been about a week. Call me on 0412 345 678 or dave@acme.com.au"`}
            rows={6}
            style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.5 }}
            autoFocus
          />

          {error && (
            <div style={{ color: '#F87171', fontSize: 13, marginBottom: 10 }}>{error}</div>
          )}

          <button
            type="button"
            onClick={extractDetails}
            disabled={!pastedText.trim() || extracting}
            className="btn btn-primary"
            style={{ fontSize: 13, marginBottom: hasResults ? 16 : 0 }}
          >
            {extracting
              ? <><span className="spinner" /> Claude is reading...</>
              : '⚡ Extract Details'}
          </button>

          {/* Results */}
          {hasResults && (
            <>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 1,
                textTransform: 'uppercase', color: 'var(--text-muted)',
                marginBottom: 10,
              }}>
                Extracted — review before applying
              </div>

              <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                {Object.entries(extracted!).filter(([, v]) => v).map(([key, value]) => (
                  <div key={key} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 12px',
                    background: 'var(--surface)',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    fontSize: 13,
                  }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 110, flexShrink: 0 }}>
                      {FIELD_LABELS[key] || key}
                    </span>
                    <span style={{ color: '#fff', fontWeight: 500 }}>{value}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={apply}
                  className="btn btn-primary"
                  style={{ fontSize: 13 }}
                >
                  ✓ Apply to Form
                </button>
                <button
                  type="button"
                  onClick={() => { setExtracted(null); setPastedText('') }}
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
