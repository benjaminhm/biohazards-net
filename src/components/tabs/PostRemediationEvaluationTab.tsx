/*
 * Verify → Post Remediation Evaluation (PRE).
 *
 * The PRE is the redesigned completion report. It is anchored 1:1 to a saved
 * quote/estimate document (the immutable source of truth for "what we agreed to
 * do") and records what was actually done against that scope — deliberately
 * NON-FINANCIAL. Persists to assessment_data.post_remediation_evaluations[].
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
  getPres,
  getStandalonePre,
  isPreSourceDocType,
  makeBlankPre,
  orderReportAppendixPhotos,
  seedScopeLinesFromQuoteContent,
  upsertPre,
} from '@/lib/postRemediationEvaluations'
import { uploadJobPhotos } from '@/lib/jobPhotoUpload'
import SelectedPhotos from '@/components/SelectedPhotos'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'

interface Props {
  job: Job
  photos: Photo[]
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

export const card: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--surface)',
  padding: 16,
  marginBottom: 14,
}

export const sectionHeading: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  margin: '28px 0 12px',
}

export const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--accent)',
  marginBottom: 6,
}

export const textInput: CSSProperties = {
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
export function hasProseText(raw: string | undefined | null): boolean {
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
export function BulletEditor({
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

export { uploadJobPhotos }

/**
 * The report's images. Until staff change them, this is the job's progress
 * photos in the order taken (with any order saved before). After that it is
 * exactly the photos they chose from the folder.
 */
export function ReportImages({
  jobId,
  photos,
  orderedIds,
  chosen,
  onPhotosUpdate,
  onSelect,
}: {
  jobId: string
  photos: Photo[]
  orderedIds?: string[]
  chosen?: boolean
  onPhotosUpdate: (photos: Photo[]) => void
  onSelect: (ids: string[]) => Promise<void>
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={sectionHeading}>Images</div>
      <SelectedPhotos
        jobId={jobId}
        title="Images"
        heading={false}
        photos={photos}
        ids={chosen ? orderedIds ?? [] : undefined}
        fallback={orderReportAppendixPhotos(photos, orderedIds)}
        onChange={onSelect}
        onPhotosUpdate={onPhotosUpdate}
        emptyText="No images on the report."
      />
    </div>
  )
}

export default function PostRemediationEvaluationTab({ job, photos, documents, onJobUpdate, onPhotosUpdate }: Props) {
  const quoteDocs = useMemo(
    () =>
      documents
        .filter(d => isPreSourceDocType(d.type))
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

  function beginStandalonePre() {
    const existing = getStandalonePre(job.assessment_data)
    if (existing) {
      setPre(existing)
      setSourceDocId('')
      setPersistedSnapshot(JSON.stringify(existing))
      return
    }
    setPre(makeBlankPre({ source_quote_document_id: '' }))
    setSourceDocId('')
    setPersistedSnapshot('')
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
        const saved = getPres(data.job.assessment_data).find(p => p.id === pre.id)
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
        const next = { ...prev, report_image_ids: ids, report_images_chosen: true }
        preRef.current = next
        return next
      })
      const snap = snapshotRef.current
      if (!snap) return
      const saved = JSON.parse(snap) as PostRemediationEvaluation
      const nextSaved = { ...saved, report_image_ids: ids, report_images_chosen: true }
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
          A PRE is usually built against one saved quote — the agreed scope is the source of truth, and the PRE
          records what was actually done. Choose the quote this evaluation reports against, or build one without a quote.
        </p>

        <div style={sectionHeading}>Reporting against</div>
        {quoteDocs.length === 0 ? (
          <div style={card}>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
              No saved quotes on this job yet (Quote/Estimate, Biohazard Cleaning, Surface Area Cleaning, or Contents Clearance).
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
        <button
          type="button"
          onClick={beginStandalonePre}
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
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>No quote</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              Draft from your technician note, Scope of Work, progress notes, and photos
            </span>
          </span>
          <span style={{ fontSize: 11, flexShrink: 0, color: getStandalonePre(job.assessment_data) ? 'var(--text-muted)' : 'var(--accent)', fontWeight: 600 }}>
            {getStandalonePre(job.assessment_data) ? 'has PRE — open' : 'Build PRE →'}
          </span>
        </button>
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
            {pre.source_quote_document_id ? (
              <>
                Reporting against:{' '}
                {pre.source_quote_reference || headerMeta?.reference || pre.source_quote_document_id}
                {headerMeta ? ` · ${headerMeta.date}` : ''}
              </>
            ) : (
              'No linked quote'
            )}
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
        chosen={pre.report_images_chosen}
        onPhotosUpdate={onPhotosUpdate}
        onSelect={persistImageOrder}
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
