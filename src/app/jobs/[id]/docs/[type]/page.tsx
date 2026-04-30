/*
 * app/jobs/[id]/docs/[type]/page.tsx
 *
 * Job document viewer: print-style HTML preview (same pipeline as /api/print) + Save + Print.
 * No in-page field editor.
 *
 * Deterministic compose (?compose=1) fills from job data.
 *
 * Wrapped in <Suspense> because useSearchParams() is used inside and Next.js
 * requires Suspense for client components that read search params.
 */
'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { CompanyProfile, DocType, Job, OutcomeQuoteRow, Photo, ProgressNote, ProgressRoomNote, QuoteLineItemRow } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { composeDocumentContent, buildComposedPreviewHtml, type ComposeDocumentOptions } from '@/lib/composeDocument'
import { mergeQuoteLineItemsIntoDocContent } from '@/lib/quoteLineItemsForDocuments'

function DocViewerInner() {
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()

  const jobId   = params.id as string
  const docType = params.type as DocType
  const docId   = searchParams.get('docId')

  const [job,              setJob]             = useState<Job | null>(null)
  const [photos,           setPhotos]          = useState<Photo[]>([])
  const [company,          setCompany]         = useState<CompanyProfile | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [content,          setContent]         = useState<Record<string, any>>({})
  const [savedDocId,       setSavedDocId]      = useState<string | null>(docId)
  /** Revoke when replacing blob print URL */
  const printBlobUrlRef = useRef<string | null>(null)
  const [saving,           setSaving]          = useState(false)
  const [saveOk,           setSaveOk]          = useState(false)
  const [saveErr,          setSaveErr]         = useState('')
  const [isMobile,         setIsMobile]        = useState(false)
  const [composedPreviewHtml, setComposedPreviewHtml] = useState<string | null>(null)
  const lastComposeKeyRef = useRef<string | null>(null)

  const docLabel   = DOC_TYPE_LABELS[docType] ?? docType
  const hasContent = Object.keys(content).length > 0
  const supportsPhotoToggle = docType === 'report'
  const includePhotos = content.include_photos !== false

  function toggleIncludePhotos() {
    setContent(prev => ({ ...prev, include_photos: prev.include_photos === false ? true : false }))
  }

  useEffect(() => {
    const id = searchParams.get('docId')
    if (id) setSavedDocId(id)
  }, [searchParams])

  function openPrintPreview() {
    if (typeof window === 'undefined') return
    if (printBlobUrlRef.current) {
      URL.revokeObjectURL(printBlobUrlRef.current)
      printBlobUrlRef.current = null
    }
    if (savedDocId) {
      window.open(`${window.location.origin}/api/print/${savedDocId}`, '_blank', 'noopener,noreferrer')
      return
    }
    if (composedPreviewHtml) {
      const blob = new Blob([composedPreviewHtml], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      printBlobUrlRef.current = url
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => () => {
    if (printBlobUrlRef.current) {
      URL.revokeObjectURL(printBlobUrlRef.current)
      printBlobUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    async function load() {
      const [jobRes, companyRes] = await Promise.all([
        fetch(`/api/jobs/${jobId}`).then(r => r.json()),
        fetch('/api/company').then(r => r.json()),
      ])
      const j = jobRes.job as Job | null
      const ph = jobRes.photos ?? []
      const co = companyRes.company ?? null
      setJob(j); setPhotos(ph); setCompany(co)
      if (docId) {
        const d = await fetch(`/api/documents/${docId}`).then(r => r.json())
        if (d.document?.content) {
          let next = d.document.content as Record<string, unknown>
          if (docType === 'quote' || docType === 'iaq_multi') {
            const quoteRes = await fetch(`/api/jobs/${jobId}/quote-line-items`).then(r => r.json())
            const rows = (quoteRes.items ?? []) as QuoteLineItemRow[]
            const gst_mode = quoteRes.run?.gst_mode
            const add_gst_to_total = quoteRes.run?.add_gst_to_total === true
            const outcome_rows = (quoteRes.outcome_rows ?? []) as OutcomeQuoteRow[]
            const outcome_mode = quoteRes.source_mode === 'outcomes' ? 'outcomes' : 'line_items'
            next = mergeQuoteLineItemsIntoDocContent(docType, next, rows, { gst_mode, add_gst_to_total, outcome_rows, outcome_mode })
          }
          setContent(next)
        }
        return
      }
      const spCompose = searchParams.get('compose')
      const spGen = searchParams.get('generate')
      const wantCompose = spCompose === '1' || spGen === '1'
      const composeKey = `${jobId}:${docType}:${spCompose ?? ''}:${spGen ?? ''}`
      if (wantCompose && j && lastComposeKeyRef.current !== composeKey) {
        lastComposeKeyRef.current = composeKey
        let composeOpts: ComposeDocumentOptions | undefined
        if (docType === 'report') {
          const [pnRes, prnRes] = await Promise.all([
            fetch(`/api/jobs/${jobId}/progress-notes`).then(r => r.json()),
            fetch(`/api/jobs/${jobId}/progress-room-notes`).then(r => r.json()),
          ])
          composeOpts = {
            report: {
              photos: ph as Photo[],
              progressNotes: (pnRes.notes ?? []) as ProgressNote[],
              progressRoomNotes: (prnRes.notes ?? []) as ProgressRoomNote[],
            },
          }
        }
        // Thread org catalogues so Assessment → Equipment / Chemicals picks
        // resolve to named rows (with SDS-parsed PPE) inside the composer.
        composeOpts = {
          ...(composeOpts ?? {}),
          equipmentCatalogue: co?.equipment_catalogue ?? null,
          chemicalsCatalogue: co?.chemicals_catalogue ?? null,
        }
        const { content: composed } = composeDocumentContent(docType, j, composeOpts)
        let finalComposed = composed
        if (docType === 'quote' || docType === 'iaq_multi') {
          const quoteRes = await fetch(`/api/jobs/${jobId}/quote-line-items`).then(r => r.json())
          const rows = (quoteRes.items ?? []) as QuoteLineItemRow[]
          const gst_mode = quoteRes.run?.gst_mode
          const add_gst_to_total = quoteRes.run?.add_gst_to_total === true
          const outcome_rows = (quoteRes.outcome_rows ?? []) as OutcomeQuoteRow[]
          const outcome_mode = quoteRes.source_mode === 'outcomes' ? 'outcomes' : 'line_items'
          finalComposed = mergeQuoteLineItemsIntoDocContent(docType, composed, rows, { gst_mode, add_gst_to_total, outcome_rows, outcome_mode })
        }
        setContent(finalComposed)
        router.replace(`/jobs/${jobId}/docs/${docType}`, { scroll: false })
      }
    }
    load()
  }, [jobId, docId, docType, router, searchParams])

  useEffect(() => {
    if (!job || !hasContent) {
      setComposedPreviewHtml(null)
      return
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    setComposedPreviewHtml(
      buildComposedPreviewHtml(
        docType,
        content,
        photos,
        job.assessment_data?.areas ?? [],
        company,
        jobId,
        origin,
        {
          client_name: job.client_name,
          client_organization_name: job.client_organization_name,
          client_email: job.client_email,
          client_phone: job.client_phone,
          site_address: job.site_address,
        },
      ),
    )
  }, [job, docType, content, photos, company, jobId, hasContent])

  async function save(andOpen = false) {
    if (!hasContent) return
    setSaving(true); setSaveErr('')
    try {
      const url = savedDocId ? `/api/documents/${savedDocId}` : '/api/documents'
      const res = await fetch(url, { method: savedDocId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, type: docType, content, file_url: null }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string; document?: { id?: string } }
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      if (data.error) throw new Error(data.error)
      const id = data.document?.id ?? savedDocId
      if (!id) throw new Error('Save returned no document id')
      setSavedDocId(id)
      if (andOpen) {
        const printUrl = `${window.location.origin}/api/print/${id}`
        if (window.matchMedia('(display-mode: standalone)').matches) window.location.href = printUrl
        else window.open(printUrl, '_blank')
      } else {
        setSaveOk(true); setTimeout(() => setSaveOk(false), 2500)
        if (!savedDocId && id) {
          router.replace(`/jobs/${jobId}/docs/${docType}?docId=${id}`, { scroll: false })
        }
      }
    } catch (err: unknown) { setSaveErr(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const mainPanel = (
    <div
      data-devid="P3-E9"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: isMobile ? '12px 10px 24px' : '20px 16px 32px',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {!hasContent ? (
        <div style={{ maxWidth: 560, margin: isMobile ? '32px auto' : '56px auto', textAlign: 'center', color: 'var(--text-muted)', padding: '0 16px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 8 }}>No document content</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {docType === 'iaq_multi'
              ? <>Open from job documents with a saved bundle, or use <strong>?compose=1</strong> on this URL to generate from the job.</>
              : <>Open this document type from Job Home with <strong>?compose=1</strong>, or open an existing saved document.</>}
          </div>
        </div>
      ) : composedPreviewHtml ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#fff' }}>
          <iframe
            title={`${docLabel} preview`}
            srcDoc={composedPreviewHtml}
            style={{ flex: 1, width: '100%', minHeight: isMobile ? 360 : 520, border: 'none', background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-modals"
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14, padding: 24 }}>
          {!job ? 'Loading…' : 'Rendering preview…'}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      <div data-devid="P3-E1" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0, zIndex: 20 }}>
        <button type="button" onClick={() => router.push(`/jobs/${jobId}?tab=documents`)} style={{ fontSize: 18, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{docLabel}</div>
          {job && <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.client_name} — {job.site_address}</div>}
        </div>
        {saveErr && <div style={{ fontSize: 12, color: '#F87171', flexShrink: 0, maxWidth: 200 }}>{saveErr}</div>}
        {saveOk && <div style={{ fontSize: 12, color: '#4ADE80', flexShrink: 0 }}>✓</div>}
        {supportsPhotoToggle && hasContent && (
          <button
            type="button"
            data-devid="P3-photos-toggle"
            onClick={toggleIncludePhotos}
            className="btn btn-secondary"
            title={includePhotos ? 'Photos included — click to compose without images' : 'No images — click to include photos'}
            aria-pressed={includePhotos}
            style={{ fontSize: 13, padding: '8px 12px', flexShrink: 0 }}
          >
            {isMobile
              ? (includePhotos ? '🖼 On' : '🖼 Off')
              : (includePhotos ? 'Images: On' : 'Images: Off')}
          </button>
        )}
        <button type="button" data-devid="P3-E7" onClick={() => save(false)} disabled={saving || !hasContent} className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 12px', flexShrink: 0 }}>
          {saving ? '…' : isMobile ? '💾' : 'Save'}
        </button>
        <button
          type="button"
          data-devid="P3-print"
          onClick={openPrintPreview}
          disabled={!savedDocId && !composedPreviewHtml}
          title={
            savedDocId
              ? 'Open print page (saved document)'
              : composedPreviewHtml
                ? 'Print preview (save to get a shareable link)'
                : 'Nothing to print yet'
          }
          className="btn btn-secondary"
          style={{ fontSize: 13, padding: '8px 12px', flexShrink: 0, opacity: savedDocId || composedPreviewHtml ? 1 : 0.45 }}
        >
          {isMobile ? '🖨' : 'Print'}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {mainPanel}
      </div>
    </div>
  )
}

export default function DocEditorPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
      <DocViewerInner />
    </Suspense>
  )
}
