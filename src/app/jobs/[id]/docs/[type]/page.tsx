/*
 * app/jobs/[id]/docs/[type]/page.tsx
 *
 * Job document viewer: print-style HTML preview (same pipeline as /api/print) + Save + Print.
 * Optional AI build (POST /api/build-document) for supported types. No in-page field editor.
 *
 * Deterministic compose (?compose=1) fills from job data.
 *
 * Wrapped in <Suspense> because useSearchParams() is used inside and Next.js
 * requires Suspense for client components that read search params.
 */
'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { CompanyProfile, DocType, Job, Photo } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { composeDocumentContent, buildComposedPreviewHtml } from '@/lib/composeDocument'

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
  const [building,         setBuilding]        = useState(false)
  const [saving,           setSaving]          = useState(false)
  const [saveOk,           setSaveOk]          = useState(false)
  const [saveErr,          setSaveErr]         = useState('')
  const [isMobile,         setIsMobile]        = useState(false)
  const [composedPreviewHtml, setComposedPreviewHtml] = useState<string | null>(null)
  const lastComposeKeyRef = useRef<string | null>(null)

  const docLabel   = DOC_TYPE_LABELS[docType] ?? docType
  const hasContent = Object.keys(content).length > 0

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
        if (d.document?.content) setContent(d.document.content)
        return
      }
      const spCompose = searchParams.get('compose')
      const spGen = searchParams.get('generate')
      const wantCompose = spCompose === '1' || spGen === '1'
      const composeKey = `${jobId}:${docType}:${spCompose ?? ''}:${spGen ?? ''}`
      if (wantCompose && j && lastComposeKeyRef.current !== composeKey) {
        lastComposeKeyRef.current = composeKey
        const { content: composed } = composeDocumentContent(docType, j)
        setContent(composed)
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
          client_email: job.client_email,
          client_phone: job.client_phone,
        },
      ),
    )
  }, [job, docType, content, photos, company, jobId, hasContent])

  const buildWithClaude = useCallback(async () => {
    if (!job) return
    setBuilding(true)
    setSaveErr('')
    try {
      const res = await fetch('/api/build-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: docType, job, photos, company }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setContent(data.content)
    } catch (err: unknown) {
      setSaveErr(err instanceof Error ? err.message : 'Build failed')
    } finally { setBuilding(false) }
  }, [job, photos, company, docType])

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
              : <>Use <strong>✨ Build</strong> in the header to generate from the job, or open an existing saved document.</>}
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
        {docType !== 'iaq_multi' && (
          <button type="button" data-devid="P3-E2" onClick={() => void buildWithClaude()} disabled={building || !job} className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 10px', flexShrink: 0 }}>
            {building ? <><span className="spinner" /> Build…</> : '✨ Build'}
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
