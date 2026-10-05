/*
 * Verify → Post Remediation Evaluation (PRE).
 *
 * The PRE is the redesigned completion report. It is anchored 1:1 to a saved
 * quote/estimate document (the immutable source of truth for "what we agreed to
 * do") and records what was actually done against that scope — deliberately
 * NON-FINANCIAL. Persists to assessment_data.post_remediation_evaluations[].
 */
'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import Link from 'next/link'
import type {
  AssessmentData,
  Document,
  Job,
  Photo,
  PostRemediationEvaluation,
  PreProductRow,
  PreWorksRow,
  QuoteContent,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  getPreBySourceQuoteId,
  makeBlankPre,
  orderReportAppendixPhotos,
  seedScopeLinesFromQuoteContent,
  upsertPre,
} from '@/lib/postRemediationEvaluations'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'

interface Props {
  job: Job
  photos: Photo[]
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

const card: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--surface)',
  padding: 16,
  marginBottom: 14,
}

const sectionHeading: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  margin: '28px 0 12px',
}

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--accent)',
  marginBottom: 6,
}

const textInput: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'inherit',
}

/** True when rich/plain text has any visible content after stripping tags. */
function hasProseText(raw: string | undefined | null): boolean {
  return String(raw ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim().length > 0
}

/** Read a quote document's content as QuoteContent (saved as Record<string,unknown>). */
function quoteContentOf(doc: Document | undefined): Partial<QuoteContent> | undefined {
  if (!doc) return undefined
  return doc.content as Partial<QuoteContent>
}

/** Label a saved quote document for the picker / header. */
function quoteDocLabel(doc: Document): { label: string; reference: string; date: string } {
  const c = quoteContentOf(doc)
  const label = (c?.quote_label || c?.title || 'Quote').toString()
  const reference = (c?.reference || '').toString()
  const date = new Date(doc.created_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return { label, reference, date }
}

/** Small repeatable list of bullet text inputs (site conditions, recommendations). */
function BulletEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
}) {
  const set = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)))
  const add = () => onChange([...items, ''])
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i))
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>•</span>
          <input value={it} onChange={e => set(i, e.target.value)} placeholder={placeholder} style={textInput} />
          <button
            type="button"
            onClick={() => remove(i)}
            style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={add} style={{ fontSize: 12, padding: '6px 10px' }}>
        + Add
      </button>
    </div>
  )
}

async function compressImage(file: File, maxDim = 1920, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not prepare that image'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Could not prepare that image'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read that image'))
    }
    img.src = objectUrl
  })
}

function ReportImages({
  jobId,
  photos,
  orderedIds,
  onPhotosUpdate,
  onReorder,
}: {
  jobId: string
  photos: Photo[]
  orderedIds?: string[]
  onPhotosUpdate: (photos: Photo[]) => void
  onReorder: (ids: string[]) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const loaded = orderReportAppendixPhotos(photos, orderedIds)

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(file => file.type.startsWith('image/'))
    e.target.value = ''
    if (!files.length || uploading) return
    setUploading(true)
    setError('')
    const added: Photo[] = []
    try {
      for (const file of files) {
        const compressed = await compressImage(file)
        const body = new FormData()
        body.append('job_id', jobId)
        body.append('file', compressed, 'upload.jpg')
        body.append('caption', '')
        body.append('area_ref', '')
        body.append('category', 'after')
        body.append('capture_phase', 'progress')
        const res = await fetch('/api/photos/upload', { method: 'POST', body })
        const data = (await res.json()) as { photo?: Photo; error?: string }
        if (!res.ok || !data.photo) throw new Error(data.error || 'Upload failed')
        added.push(data.photo)
      }
      if (added.length) {
        onPhotosUpdate([...photos, ...added])
        if (orderedIds?.length) await onReorder([...orderedIds, ...added.map(photo => photo.id)])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function movePhoto(fromId: string, toId: string) {
    if (fromId === toId) return
    const ids = loaded.map(photo => photo.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void onReorder(next).catch(err => {
      setError(err instanceof Error ? err.message : 'Could not save the new order')
    })
  }

  function onDragStart(e: DragEvent<HTMLDivElement>, id: string) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    setDragId(id)
  }

  function onDragOver(e: DragEvent<HTMLDivElement>, id: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overId !== id) setOverId(id)
  }

  async function removePhoto(photo: Photo) {
    if (!window.confirm('Confirm you want to delete this image?')) return
    setDeletingId(photo.id)
    setError('')
    try {
      const res = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      onPhotosUpdate(photos.filter(item => item.id !== photo.id))
      if (orderedIds?.length) await onReorder(orderedIds.filter(id => id !== photo.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <div style={sectionHeading}>Images</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
        Choose one or more images. They print at the end of the report in the order they were uploaded. Drag a photo to move it.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={e => void onPick(e)}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        style={{ padding: '12px 16px', fontWeight: 700 }}
      >
        {uploading ? 'Uploading…' : 'Choose images'}
      </button>
      {error && (
        <div style={{ color: '#F87171', fontSize: 13, marginTop: 8 }} role="alert">{error}</div>
      )}
      {loaded.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 12 }}>
          {loaded.map(photo => (
            <div
              key={photo.id}
              draggable={deletingId !== photo.id}
              onDragStart={e => onDragStart(e, photo.id)}
              onDragOver={e => onDragOver(e, photo.id)}
              onDrop={e => {
                e.preventDefault()
                const fromId = e.dataTransfer.getData('text/plain') || dragId
                if (fromId) movePhoto(fromId, photo.id)
                setDragId(null)
                setOverId(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              style={{
                position: 'relative',
                borderRadius: 8,
                outline: overId === photo.id && dragId && dragId !== photo.id ? '2px solid var(--accent, #60a5fa)' : 'none',
                opacity: dragId === photo.id ? 0.45 : 1,
                cursor: 'grab',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.file_url}
                alt={photo.caption || 'Report image'}
                draggable={false}
                style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 8, display: 'block', background: 'var(--surface-2)', pointerEvents: 'none' }}
              />
              <button
                type="button"
                aria-label="Delete image"
                disabled={deletingId === photo.id}
                draggable={false}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation()
                  void removePhoto(photo)
                }}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 22,
                  height: 22,
                  padding: 0,
                  border: 'none',
                  borderRadius: 999,
                  background: 'rgba(0,0,0,0.72)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: '22px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PostRemediationEvaluationTab({ job, photos, documents, onJobUpdate, onPhotosUpdate }: Props) {
  const quoteDocs = useMemo(
    () =>
      documents
        .filter(d => d.type === 'quote')
        .slice()
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [documents],
  )

  const [sourceDocId, setSourceDocId] = useState<string>('')
  const [pre, setPre] = useState<PostRemediationEvaluation | null>(null)
  const [persistedSnapshot, setPersistedSnapshot] = useState<string>('')
  const preRef = useRef(pre)
  const snapshotRef = useRef(persistedSnapshot)
  const jobRef = useRef(job)
  const orderWrite = useRef(Promise.resolve())
  preRef.current = pre
  snapshotRef.current = persistedSnapshot
  jobRef.current = job

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<number | null>(null)
  const stageKeys = useRef<string[]>([])
  const stageKeyOwner = useRef<string | null>(null)
  const dragStageFrom = useRef<number | null>(null)

  // On mount / job change: if any PRE exists, open the most-recently-updated one.
  useEffect(() => {
    const list = job.assessment_data?.post_remediation_evaluations ?? []
    if (list.length > 0) {
      const newest = list.slice().sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))[0]
      setPre(newest)
      setSourceDocId(newest.source_quote_document_id)
      setPersistedSnapshot(JSON.stringify(newest))
    } else {
      setPre(null)
      setSourceDocId('')
      setPersistedSnapshot('')
    }
  }, [job.id])

  const sourceDoc = useMemo(
    () => quoteDocs.find(d => d.id === (pre?.source_quote_document_id ?? sourceDocId)),
    [quoteDocs, pre, sourceDocId],
  )

  const isDirty = pre ? JSON.stringify(pre) !== persistedSnapshot : false
  useRegisterUnsavedChanges('post-remediation-evaluation', isDirty)

  function beginPreForSource(docId: string) {
    const doc = quoteDocs.find(d => d.id === docId)
    if (!doc) return
    const existing = getPreBySourceQuoteId(job.assessment_data, docId)
    if (existing) {
      setPre(existing)
      setSourceDocId(docId)
      setPersistedSnapshot(JSON.stringify(existing))
      return
    }
    const meta = quoteDocLabel(doc)
    const seeded = makeBlankPre({
      source_quote_document_id: docId,
      source_quote_label: meta.label,
      source_quote_reference: meta.reference,
      scope_lines: seedScopeLinesFromQuoteContent(quoteContentOf(doc)),
    })
    setPre(seeded)
    setSourceDocId(docId)
    setPersistedSnapshot('') // unsaved
    setSavedFlash(false)
    setSaveError(null)
  }

  function patchPre(mut: (p: PostRemediationEvaluation) => PostRemediationEvaluation) {
    setPre(prev => (prev ? mut(prev) : prev))
    setSavedFlash(false)
    setSaveError(null)
  }

  function patchWorksRow(idx: number, mut: (r: PreWorksRow) => PreWorksRow) {
    patchPre(p => ({ ...p, works_rows: (p.works_rows ?? []).map((r, i) => (i === idx ? mut(r) : r)) }))
  }

  function stageKeyList(ownerId: string, count: number): string[] {
    if (stageKeyOwner.current !== ownerId) {
      stageKeys.current = Array.from({ length: count }, () => crypto.randomUUID())
      stageKeyOwner.current = ownerId
      return stageKeys.current
    }
    while (stageKeys.current.length < count) stageKeys.current.push(crypto.randomUUID())
    if (stageKeys.current.length > count) stageKeys.current.splice(count)
    return stageKeys.current
  }

  function moveStage(from: number, to: number) {
    const count = preRef.current?.works_rows?.length ?? 0
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return
    const [key] = stageKeys.current.splice(from, 1)
    if (key) stageKeys.current.splice(to, 0, key)
    patchPre(p => {
      const rows = [...(p.works_rows ?? [])]
      if (from >= rows.length || to >= rows.length) return p
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved)
      return { ...p, works_rows: rows }
    })
  }

  function removeStage(idx: number) {
    stageKeys.current.splice(idx, 1)
    patchPre(p => ({ ...p, works_rows: (p.works_rows ?? []).filter((_, i) => i !== idx) }))
  }
  function patchProductRow(idx: number, mut: (r: PreProductRow) => PreProductRow) {
    patchPre(p => ({ ...p, products_rows: (p.products_rows ?? []).map((r, i) => (i === idx ? mut(r) : r)) }))
  }

  /**
   * Regenerate the completion-report sections from the quote + technician note.
   * OVERWRITES the AI-authored sections so editing the note and re-running
   * refreshes the draft. Preserves the technician note, attendance, and photos.
   */
  async function regenerateFromNote() {
    if (!pre) return
    const hasDraft =
      hasProseText(pre.executive_summary) ||
      hasProseText(pre.methodology) ||
      hasProseText(pre.outcome_verification) ||
      (pre.works_rows ?? []).length > 0 ||
      (pre.site_conditions ?? []).some(s => s.trim())
    if (
      hasDraft &&
      !window.confirm(
        'Replace the drafted report sections with a fresh draft from your technician note? Your note, attendance, and photos are kept.',
      )
    ) {
      return
    }
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-pre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preId: pre.id, pre }),
      })
      const data = (await res.json()) as {
        executive_summary?: string
        site_conditions?: string[]
        works?: PreWorksRow[]
        methodology?: string
        products?: PreProductRow[]
        waste?: { waste_type?: string; volume?: string; containment?: string; disposal?: string }
        outcome_verification?: string
        recommendations?: string[]
        compliance?: string
        limitations?: string
        error?: string
      }
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Draft failed')
      patchPre(p => ({
        ...p,
        executive_summary: data.executive_summary ?? '',
        site_conditions: data.site_conditions ?? [],
        works_rows: data.works ?? [],
        methodology: data.methodology ?? '',
        products_rows: data.products ?? [],
        waste: data.waste ?? {},
        outcome_verification: data.outcome_verification ?? '',
        recommendations: data.recommendations ?? [],
        compliance: data.compliance ?? '',
        limitations: data.limitations ?? '',
      }))
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Draft failed')
    } finally {
      setAiBusy(false)
    }
  }

  async function save() {
    if (!pre) return
    setSaving(true)
    setSaveError(null)
    try {
      const base = mergeAssessmentData(job.assessment_data)
      const merged: AssessmentData = {
        ...base,
        post_remediation_evaluations: upsertPre(job.assessment_data, pre),
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.job) {
        onJobUpdate(data.job)
        const saved = getPreBySourceQuoteId(data.job.assessment_data, pre.source_quote_document_id)
        if (saved) {
          setPre(saved)
          setPersistedSnapshot(JSON.stringify(saved))
        }
      }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function persistImageOrder(ids: string[]): Promise<void> {
    const run = orderWrite.current.catch(() => undefined).then(async () => {
      const current = preRef.current
      if (!current) return
      setPre(prev => {
        if (!prev) return prev
        const next = { ...prev, report_image_ids: ids }
        preRef.current = next
        return next
      })
      const snap = snapshotRef.current
      if (!snap) return
      const saved = JSON.parse(snap) as PostRemediationEvaluation
      const nextSaved = { ...saved, report_image_ids: ids }
      const jobNow = jobRef.current
      const base = mergeAssessmentData(jobNow.assessment_data)
      const merged: AssessmentData = {
        ...base,
        post_remediation_evaluations: upsertPre(jobNow.assessment_data, nextSaved),
      }
      const res = await fetch(`/api/jobs/${jobNow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not save the new order')
      if (data.job) onJobUpdate(data.job)
      const nextSnap = JSON.stringify(nextSaved)
      snapshotRef.current = nextSnap
      setPersistedSnapshot(nextSnap)
    })
    orderWrite.current = run
    return run
  }

  // ── No source selected yet: show the picker ─────────────────────────────────
  if (!pre) {
    return (
      <div style={{ maxWidth: 720, paddingBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Post Remediation Evaluation</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 20 }}>
          A PRE is built against one issued Quote/Estimate — the agreed scope is the source of truth, and the PRE records
          what was actually done. Choose the quote this evaluation reports against.
        </p>

        <div style={sectionHeading}>Reporting against</div>
        {quoteDocs.length === 0 ? (
          <div style={card}>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
              No saved Quote/Estimate documents on this job yet. Generate and save a quote first, then return here to build
              its PRE.
            </p>
          </div>
        ) : (
          <div>
            {quoteDocs.map((doc, i) => {
              const meta = quoteDocLabel(doc)
              const hasPre = !!getPreBySourceQuoteId(job.assessment_data, doc.id)
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => beginPreForSource(doc.id)}
                  style={{
                    ...card,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{meta.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      {meta.reference} · {meta.date}
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {i === 0 && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>★ latest</span>
                    )}
                    {hasPre ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>has PRE — open</span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Build PRE →</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Builder ─────────────────────────────────────────────────────────────────
  const headerMeta = sourceDoc ? quoteDocLabel(sourceDoc) : null
  const prose = (label: string, value: string | undefined, set: (v: string) => void, hint?: string, minHeight = 110) => (
    <>
      <div style={sectionHeading}>{label}</div>
      {hint && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>{hint}</p>}
      <textarea
        value={value ?? ''}
        onChange={e => set(e.target.value)}
        style={{ ...textInput, minHeight, resize: 'vertical', lineHeight: 1.5 }}
      />
    </>
  )

  const workRows = pre.works_rows ?? []
  const workKeys = stageKeyList(pre.id, workRows.length)

  return (
    <div style={{ maxWidth: 760, paddingBottom: 48 }}>
      {/* Header strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>
            Post Remediation Evaluation
            {pre.source_quote_label ? ` — ${pre.source_quote_label}` : ''}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Reporting against:{' '}
            {pre.source_quote_reference || headerMeta?.reference || pre.source_quote_document_id}
            {headerMeta ? ` · ${headerMeta.date}` : ''}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '6px 10px', flexShrink: 0 }}
          onClick={() => {
            if (
              isDirty &&
              !window.confirm('Discard this PRE draft and pick a different source quote? Unsaved changes will be lost.')
            ) {
              return
            }
            if (
              !isDirty &&
              !window.confirm('Switch to a different source quote? You can come back to this one from the picker.')
            ) {
              return
            }
            setPre(null)
            setSourceDocId('')
          }}
        >
          Switch source
        </button>
      </div>

      {/* Technician note — steers Generate */}
      <div style={sectionHeading}>Technician note</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        Tell the draft what actually happened against the quote — followed as agreed, complexities
        that arose, scope changes, recommendations. Used with the quote as context when you
        Regenerate; it is not printed on the document.
      </p>
      <textarea
        value={pre.generation_brief ?? ''}
        onChange={e => patchPre(p => ({ ...p, generation_brief: e.target.value }))}
        placeholder="e.g. Quote followed in full. Bathroom needed extra subfloor treatment after lifting vinyl. Recommend a moisture re-check in 2 weeks."
        style={{ ...textInput, minHeight: 110, resize: 'vertical', lineHeight: 1.5 }}
      />

      {/* Attendance — manual */}
      <div style={sectionHeading}>Attendance</div>
      <input
        value={pre.attendance ?? ''}
        onChange={e => patchPre(p => ({ ...p, attendance: e.target.value }))}
        placeholder="e.g. 2.5 days on site"
        style={textInput}
      />

      {/* 01 Executive Summary */}
      {prose(
        '01 · Executive Summary',
        pre.executive_summary,
        v => patchPre(p => ({ ...p, executive_summary: v })),
        'Site attended, scope per the linked quote, areas covered, duration, headline waste volume.',
      )}

      {/* 02 Site Conditions on Attendance */}
      <div style={sectionHeading}>02 · Site Conditions on Attendance</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        Pre-existing conditions / staging observed on arrival, before any work began.
      </p>
      <BulletEditor
        items={pre.site_conditions ?? []}
        onChange={items => patchPre(p => ({ ...p, site_conditions: items }))}
        placeholder="Observation before work began…"
      />

      {/* 03 Works Undertaken */}
      <div style={sectionHeading}>03 · Works Undertaken</div>
      {workRows.length > 1 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Drag a stage by the grip to change its place. The new order stays on screen. Save before you create the document.
        </p>
      )}
      {workRows.map((r, idx) => (
        <div
          key={workKeys[idx]}
          onDragOver={e => {
            e.preventDefault()
            if (overStage !== idx) setOverStage(idx)
          }}
          onDrop={e => {
            e.preventDefault()
            const from = dragStageFrom.current
            dragStageFrom.current = null
            if (from !== null) moveStage(from, idx)
            setOverStage(null)
          }}
          style={{
            ...card,
            outline: overStage === idx && dragStageFrom.current !== null && dragStageFrom.current !== idx ? '2px solid var(--accent, #60a5fa)' : undefined,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                draggable
                aria-label="Drag stage"
                title="Drag to reorder"
                onDragStart={e => {
                  dragStageFrom.current = idx
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', 'stage')
                }}
                onDragEnd={() => {
                  dragStageFrom.current = null
                  setOverStage(null)
                }}
                style={{ cursor: 'grab', color: 'var(--text-muted)', fontWeight: 700, userSelect: 'none', lineHeight: 1 }}
              >
                ⋮⋮
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Stage {idx + 1}</span>
            </div>
            <button
              type="button"
              onClick={() => removeStage(idx)}
              style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 12 }}
            >
              Remove
            </button>
          </div>
          <label style={fieldLabel}>Stage name</label>
          <input
            value={r.stage_name}
            onChange={e => patchWorksRow(idx, rr => ({ ...rr, stage_name: e.target.value }))}
            placeholder="e.g. Mobilisation, Kitchen, Final check"
            style={{ ...textInput, marginBottom: 10 }}
          />
          <label style={fieldLabel}>Description</label>
          <textarea
            value={r.description}
            onChange={e => patchWorksRow(idx, rr => ({ ...rr, description: e.target.value }))}
            placeholder="First-person past-tense action description…"
            style={{ ...textInput, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => patchPre(p => ({ ...p, works_rows: [...(p.works_rows ?? []), { stage_name: '', description: '' }] }))}
        style={{ fontSize: 13 }}
      >
        + Add stage
      </button>

      {/* 04 Remediation Methodology */}
      {prose(
        '04 · Remediation Methodology',
        pre.methodology,
        v => patchPre(p => ({ ...p, methodology: v })),
        'Zone-based approach, product application (dilution/dwell time), explicit out-of-scope statement.',
      )}

      {/* 05 Products & Equipment Used */}
      <div style={sectionHeading}>05 · Products &amp; Equipment Used</div>
      {(pre.products_rows ?? []).map((r, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            value={r.item_name}
            onChange={e => patchProductRow(idx, rr => ({ ...rr, item_name: e.target.value }))}
            placeholder="Item"
            style={{ ...textInput, flex: 1 }}
          />
          <input
            value={r.usage_note}
            onChange={e => patchProductRow(idx, rr => ({ ...rr, usage_note: e.target.value }))}
            placeholder="Usage note"
            style={{ ...textInput, flex: 1.4 }}
          />
          <button
            type="button"
            onClick={() => patchPre(p => ({ ...p, products_rows: (p.products_rows ?? []).filter((_, i) => i !== idx) }))}
            style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => patchPre(p => ({ ...p, products_rows: [...(p.products_rows ?? []), { item_name: '', usage_note: '' }] }))}
        style={{ fontSize: 12, padding: '6px 10px' }}
      >
        + Add item
      </button>

      {/* 06 Waste Management & Disposal */}
      <div style={sectionHeading}>06 · Waste Management &amp; Disposal</div>
      {([
        ['waste_type', 'Waste type'],
        ['volume', 'Volume (e.g. Approximately 2 m³)'],
        ['containment', 'Containment'],
        ['disposal', 'Disposal'],
      ] as const).map(([key, label]) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <label style={fieldLabel}>{label}</label>
          <input
            value={pre.waste?.[key] ?? ''}
            onChange={e => patchPre(p => ({ ...p, waste: { ...(p.waste ?? {}), [key]: e.target.value } }))}
            style={textInput}
          />
        </div>
      ))}

      {/* 07 Outcome & Verification */}
      {prose(
        '07 · Outcome & Verification',
        pre.outcome_verification,
        v => patchPre(p => ({ ...p, outcome_verification: v })),
        'Final walkthrough vs quoted scope, compliance statement, handback confirmation.',
      )}

      {/* 08 Recommendations */}
      <div style={sectionHeading}>08 · Recommendations</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        Issues noted on site, outside the cleaning scope — flagged for the client to action.
      </p>
      <BulletEditor
        items={pre.recommendations ?? []}
        onChange={items => patchPre(p => ({ ...p, recommendations: items }))}
        placeholder="Issue + impact + who must address it…"
      />

      {/* 09 Compliance */}
      {prose(
        '09 · Compliance',
        pre.compliance,
        v => patchPre(p => ({ ...p, compliance: v })),
        'Standard-procedures statement + disposal-compliance statement.',
      )}

      {/* Limitations & Scope Notice */}
      {prose(
        'Limitations & Scope Notice',
        pre.limitations,
        v => patchPre(p => ({ ...p, limitations: v })),
        'Scope boundary, unaccessed/uncleaned areas and why, exclusions, testing/lab disclaimer.',
      )}

      <ReportImages
        jobId={job.id}
        photos={photos}
        orderedIds={pre.report_image_ids}
        onPhotosUpdate={onPhotosUpdate}
        onReorder={persistImageOrder}
      />

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={pre.unsigned_copy === true}
          onChange={e => patchPre(p => ({ ...p, unsigned_copy: e.target.checked }))}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Unsigned copy</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Watermark the report “NOT FOR OFFICIAL USE - UNSIGNED COPY”. Use this while the invoice is unpaid.
          </span>
        </span>
      </label>

      {/* Sign-off */}
      <div style={sectionHeading}>Technician sign-off</div>
      <input
        value={pre.technician_signoff ?? ''}
        onChange={e => patchPre(p => ({ ...p, technician_signoff: e.target.value }))}
        placeholder="Name / role / date"
        style={textInput}
      />

      {(saveError || aiError) && (
        <div style={{ fontSize: 13, color: '#F87171', margin: '16px 0 0' }} role="alert">
          {saveError || aiError}
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '20px 0 8px' }}>
        Regenerate drafts the report sections from the quote and your technician note, replacing the
        previously drafted content. Your note, attendance, and photos are kept. Review, then save.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void regenerateFromNote()}
          disabled={aiBusy || saving}
          style={{ flex: 1, padding: 14, fontSize: 15 }}
        >
          {aiBusy ? (
            <>
              <span className="spinner" /> Generating…
            </>
          ) : (
            'Regenerate'
          )}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving || !isDirty}
          style={{ flex: 1, padding: 14, fontSize: 15 }}
        >
          {saving ? 'Saving…' : savedFlash ? '✓ Saved' : 'Save'}
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          {isDirty
            ? 'Save your changes first, then create the document.'
            : 'Create the print/PDF document for this evaluation.'}
        </div>
        {isDirty || persistedSnapshot === '' ? (
          <button type="button" className="btn btn-secondary" disabled style={{ fontSize: 13 }}>
            Create document
          </button>
        ) : (
          <Link href={`/jobs/${job.id}/docs/report?compose=1&preId=${pre.id}`}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>
              Create document
            </button>
          </Link>
        )}
      </div>
    </div>
  )
}
