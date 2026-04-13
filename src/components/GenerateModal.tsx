/*
 * components/GenerateModal.tsx
 *
 * Full-screen modal that displays a generated document and lets the user:
 *   - Preview it as rendered HTML (via buildPrintHTML from lib/printDocument.ts).
 *   - Edit it via natural-language instructions sent to /api/edit-document.
 *   - Save it to the database as a Document record via /api/documents.
 *   - Email it to the client by constructing a mailto: link with the print URL.
 *
 * The modal receives `content` as null while Claude is still generating — in
 * that state it shows a loading animation. Once content arrives the preview
 * iframe is populated and the action buttons become enabled.
 *
 * The in-memory `draft` state is kept as a JSON string so the user can also
 * manually edit the raw JSON if needed. The preview is regenerated via useMemo
 * whenever draft, company, photos, or type changes — no debounce needed because
 * buildPrintHTML is fast (pure string concatenation).
 *
 * handleEmail saves the document first, then opens a mailto: link so the staff
 * member can send a pre-composed email containing the document's print URL.
 * This avoids needing transactional email configuration for document delivery.
 */
'use client'

import { useState, useEffect, useMemo } from 'react'
import type { DocType, Document, Photo, CompanyProfile } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'

interface Props {
  jobId: string
  type: DocType
  content: object | null   // null = still generating
  photos: Photo[]
  clientName: string
  clientEmail: string
  onClose: () => void
  onSaved: (doc: Document) => void
}

export default function GenerateModal({ jobId, type, content, photos, clientName, clientEmail, onClose, onSaved }: Props) {
  const [draft, setDraft]   = useState(content ? JSON.stringify(content, null, 2) : '')
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Chat-edit
  const [instruction, setInstruction] = useState('')
  const [applying, setApplying]       = useState(false)
  const [applyError, setApplyError]   = useState('')

  useEffect(() => {
    if (content) setDraft(JSON.stringify(content, null, 2))
  }, [content])

  useEffect(() => {
    fetch('/api/company').then(r => r.json()).then(d => setCompany(d.company ?? null)).catch(() => {})
  }, [])

  const previewHtml = useMemo(() => {
    try {
      const parsed = JSON.parse(draft)
      const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
      return buildPrintHTML(type, parsed, photos, [], company, jobId, appUrl, undefined, { screenActionBar: false })
    } catch {
      return '<body style="font:14px sans-serif;padding:24px;color:#999">Preview not available</body>'
    }
  }, [draft, company, type, photos, jobId])

  async function applyInstruction() {
    if (!instruction.trim() || !content) return
    setApplying(true)
    setApplyError('')
    try {
      const parsed = JSON.parse(draft)
      const res = await fetch('/api/edit-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content: parsed, instruction }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setDraft(JSON.stringify(data.content, null, 2))
      setInstruction('')
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setApplying(false)
    }
  }

  // Save doc to DB and return the saved record + print URL
  async function saveDoc(): Promise<{ doc: Document; printUrl: string } | null> {
    setSaving(true)
    setError('')
    try {
      const parsed = JSON.parse(draft)
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, type, content: parsed, file_url: null }),
      })
      const { document: savedDoc, error: saveErr } = await res.json()
      if (saveErr) throw new Error(saveErr)
      const printUrl = `${window.location.origin}/api/print/${savedDoc.id}`
      return { doc: savedDoc, printUrl }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save document')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    const result = await saveDoc()
    if (result) onSaved(result.doc)
  }

  async function handleEmail() {
    const result = await saveDoc()
    if (!result) return
    onSaved(result.doc)

    const subject = encodeURIComponent(`${DOC_TYPE_LABELS[type]} — ${company?.name ?? 'Brisbane Biohazard Cleaning'}`)
    const body = encodeURIComponent(
      `Hi ${clientName.split(' ')[0]},\n\nPlease find your ${DOC_TYPE_LABELS[type].toLowerCase()} at the link below.\n\n${result.printUrl}\n\nDon't hesitate to reach out if you have any questions.\n\nKind regards,\n${company?.name ?? 'Brisbane Biohazard Cleaning'}`
    )
    const mailto = `mailto:${clientEmail}?subject=${subject}&body=${body}`
    window.location.href = mailto
  }

  const ready = !!content

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{DOC_TYPE_LABELS[type]}</div>
        <button onClick={onClose} style={{ fontSize: 20, color: 'var(--text-muted)', padding: '2px 8px', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>

      {/* ── AI edit bar ── */}
      <div style={{
        background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
        padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 15 }}>✨</span>
        <input
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyInstruction() } }}
          placeholder='Ask Claude to edit — e.g. "remove PPE line item" or "change total to $4,500"'
          disabled={applying || !ready}
          style={{
            flex: 1, fontSize: 13,
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 7, padding: '8px 12px', color: 'var(--text)', outline: 'none',
          }}
        />
        <button
          onClick={applyInstruction}
          disabled={applying || !instruction.trim() || !ready}
          style={{
            padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700,
            background: 'var(--accent)', color: '#fff', border: 'none',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            opacity: applying || !instruction.trim() || !ready ? 0.45 : 1,
          }}
        >
          {applying ? <><span className="spinner" /> Applying…</> : 'Apply'}
        </button>
      </div>
      {applyError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', padding: '8px 14px', fontSize: 12, color: '#F87171', flexShrink: 0 }}>
          {applyError}
        </div>
      )}

      {/* ── Preview ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {!ready ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'var(--bg)', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 36 }}>✍️</div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>
              Claude is writing your {DOC_TYPE_LABELS[type].toLowerCase()}…
            </div>
            <div style={{ fontSize: 13 }}>Usually takes 10–20 seconds</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ease-in-out ${i * 0.4}s infinite` }} />
              ))}
            </div>
            <style>{`@keyframes pulse{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
          </div>
        ) : (
          <iframe srcDoc={previewHtml} style={{ flex: 1, border: 'none', background: '#fff' }} sandbox="allow-same-origin" title="Document preview" />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '12px 16px', flexShrink: 0 }}>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#F87171', fontSize: 13, marginBottom: 10 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            {ready ? 'Discard' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !ready}
            className="btn btn-secondary"
            style={{ flex: 2, opacity: !ready ? 0.4 : 1 }}
          >
            {saving ? <><span className="spinner" /> Saving…</> : '💾 Save to Documents'}
          </button>
          <button
            onClick={handleEmail}
            disabled={saving || !ready}
            className="btn btn-primary"
            style={{ flex: 2, opacity: !ready ? 0.4 : 1 }}
          >
            {saving ? <><span className="spinner" /> Saving…</> : '✉️ Email to Client'}
          </button>
        </div>
      </div>
    </div>
  )
}
