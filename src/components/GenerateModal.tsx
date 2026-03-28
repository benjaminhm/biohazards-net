'use client'

import { useState, createElement } from 'react'
import type { DocType, Document, Photo, PhotoWithData, CompanyProfile } from '@/lib/types'

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

async function toBase64(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

export default function GenerateModal({ jobId, type, content, photos, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(JSON.stringify(content, null, 2))
  const [saving, setSaving] = useState(false)
  const [savingStep, setSavingStep] = useState('')
  const [error, setError] = useState('')

  async function saveAndDownload() {
    setSaving(true)
    setError('')
    try {
      let parsed: object
      try {
        parsed = JSON.parse(draft)
      } catch {
        setError('Invalid JSON — please fix the document content before saving.')
        setSaving(false)
        return
      }

      // 1. Fetch company profile
      setSavingStep('Loading company profile...')
      let company: CompanyProfile | null = null
      try {
        const companyRes = await fetch('/api/company')
        const companyData = await companyRes.json()
        company = companyData.company ?? null
      } catch { /* continue without company profile */ }

      // 2. Select relevant photos (before+assessment for quote/sow, all for report)
      const relevantCategories = type === 'report'
        ? ['before', 'assessment', 'during', 'after']
        : ['before', 'assessment']
      const relevantPhotos = photos
        .filter(p => relevantCategories.includes(p.category))
        .slice(0, 12) // max 12 photos per document

      // 3. Convert photo URLs to base64 for reliable PDF embedding
      setSavingStep(`Processing ${relevantPhotos.length} photos...`)
      const photosWithData: PhotoWithData[] = await Promise.all(
        relevantPhotos.map(async (p) => ({
          ...p,
          dataUrl: await toBase64(p.file_url),
        }))
      )

      // 4. Generate PDF client-side
      setSavingStep('Rendering PDF...')
      const [{ pdf }, { JobPDFDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/PDFDocument'),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = (pdf as any)(createElement(JobPDFDocument as any, {
        type,
        content: parsed,
        photos: photosWithData,
        company,
        jobId,
      }))
      const pdfBlob = await instance.toBlob()

      // 5. Upload PDF to Supabase Storage
      setSavingStep('Saving PDF...')
      let fileUrl: string | null = null
      try {
        const { supabase } = await import('@/lib/supabase')
        const fileName = `${type}-${jobId.slice(0, 8)}-${Date.now()}.pdf`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('job-pdfs')
          .upload(`${jobId}/${fileName}`, pdfBlob, { contentType: 'application/pdf', upsert: false })

        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage.from('job-pdfs').getPublicUrl(uploadData.path)
          fileUrl = urlData.publicUrl
        }
      } catch { /* continue even if storage fails */ }

      // 6. Save document record
      setSavingStep('Saving record...')
      const saveRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, type, content: parsed, file_url: fileUrl }),
      })
      const { document: savedDoc, error: saveErr } = await saveRes.json()
      if (saveErr) throw new Error(saveErr)

      // 7. Trigger download
      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type}-${jobId.slice(0, 8)}.pdf`
      a.click()
      URL.revokeObjectURL(url)

      onSaved(savedDoc)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF')
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
            Review and edit below — then save as PDF
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
            onClick={saveAndDownload}
            disabled={saving}
            className="btn btn-primary"
            style={{ flex: 2, fontSize: 15 }}
          >
            {saving
              ? <><span className="spinner" /> {savingStep || 'Generating PDF...'}</>
              : '↓ Save & Download PDF'
            }
          </button>
        </div>
      </div>
    </div>
  )
}
