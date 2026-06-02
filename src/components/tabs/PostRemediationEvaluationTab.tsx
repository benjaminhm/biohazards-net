/*
 * Verify → Post Remediation Evaluation (PRE).
 *
 * The PRE is the redesigned completion report. It is anchored 1:1 to a saved
 * quote/estimate document (the immutable source of truth for "what we agreed to
 * do") and records what was actually done against that scope — deliberately
 * NON-FINANCIAL. Persists to assessment_data.post_remediation_evaluations[].
 */
'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type {
  AssessmentData,
  Document,
  Job,
  Photo,
  PostRemediationEvaluation,
  PreAreaNote,
  PreScopeLine,
  QuoteContent,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  getPreBySourceQuoteId,
  makeBlankPre,
  resolveQuotedLineContext,
  seedScopeLinesFromQuoteContent,
  upsertPre,
} from '@/lib/postRemediationEvaluations'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import RichTextEditor from '@/components/RichTextEditor'

interface Props {
  job: Job
  photos: Photo[]
  documents: Document[]
  onJobUpdate: (job: Job) => void
}

type LineStatus = 'as_done' | 'varied' | 'not_done'

const STATUS_META: Record<LineStatus, { label: string; color: string; bg: string }> = {
  as_done: { label: 'As done', color: '#34D399', bg: 'rgba(16,185,129,0.16)' },
  varied: { label: 'Varied', color: '#FBBF24', bg: 'rgba(245,158,11,0.16)' },
  not_done: { label: 'Not done', color: '#94A3B8', bg: 'rgba(148,163,184,0.16)' },
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

/** Compact inline thumbnail toggler for attaching existing job photos to a line/area. */
function PhotoAttacher({
  photos,
  selectedIds,
  onChange,
}: {
  photos: Photo[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  if (photos.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
        No job photos available to attach yet.
      </p>
    )
  }
  const toggle = (id: string) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, padding: '6px 10px' }}
      >
        {open ? 'Hide photos' : `Photos (${selectedIds.length})`}
      </button>
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
            gap: 8,
            marginTop: 10,
          }}
        >
          {photos.map(p => {
            const sel = selectedIds.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                title={p.caption || p.area_ref || ''}
                style={{
                  position: 'relative',
                  padding: 0,
                  border: sel ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  aspectRatio: '1 / 1',
                  background: 'var(--surface-2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.file_url}
                  alt={p.caption || 'job photo'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: sel ? 1 : 0.7 }}
                />
                {sel && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      background: 'var(--accent)',
                      color: '#fff',
                      borderRadius: 999,
                      width: 16,
                      height: 16,
                      fontSize: 11,
                      lineHeight: '16px',
                      textAlign: 'center',
                    }}
                  >
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PostRemediationEvaluationTab({ job, photos, documents, onJobUpdate }: Props) {
  const quoteDocs = useMemo(
    () =>
      documents
        .filter(d => d.type === 'quote')
        .slice()
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [documents],
  )

  const areas = useMemo(() => job.assessment_data?.areas ?? [], [job.assessment_data])

  const [sourceDocId, setSourceDocId] = useState<string>('')
  const [pre, setPre] = useState<PostRemediationEvaluation | null>(null)
  const [persistedSnapshot, setPersistedSnapshot] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

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
  const sourceContent = useMemo(() => quoteContentOf(sourceDoc), [sourceDoc])

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

  function patchLine(idx: number, mut: (l: PreScopeLine) => PreScopeLine) {
    patchPre(p => ({ ...p, scope_lines: p.scope_lines.map((l, i) => (i === idx ? mut(l) : l)) }))
  }

  function addAddedWork() {
    patchPre(p => ({
      ...p,
      scope_lines: [...p.scope_lines, { kind: 'added', title: '', note_rich_html: '' }],
    }))
  }

  function removeLine(idx: number) {
    patchPre(p => ({ ...p, scope_lines: p.scope_lines.filter((_, i) => i !== idx) }))
  }

  function patchAreaNote(areaName: string, mut: (n: PreAreaNote) => PreAreaNote) {
    patchPre(p => {
      const notes = p.area_notes ?? []
      const idx = notes.findIndex(n => n.area_name === areaName)
      const base: PreAreaNote = idx === -1 ? { area_name: areaName } : notes[idx]
      const next = mut(base)
      const merged = idx === -1 ? [...notes, next] : notes.map((n, i) => (i === idx ? next : n))
      return { ...p, area_notes: merged }
    })
  }

  async function draftFromQuote() {
    if (!pre) return
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-pre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preId: pre.id }),
      })
      const data = (await res.json()) as {
        opening?: string
        closing?: string
        line_notes?: Record<string, string>
        area_notes?: Record<string, string>
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Draft failed')
      patchPre(p => {
        const next: PostRemediationEvaluation = { ...p }
        if (!hasProseText(next.opening_rich_html) && data.opening) next.opening_rich_html = data.opening
        if (!hasProseText(next.closing_rich_html) && data.closing) next.closing_rich_html = data.closing
        next.scope_lines = p.scope_lines.map(l => {
          if (l.kind === 'from_quote' && !hasProseText(l.note_rich_html)) {
            const n = data.line_notes?.[l.source_line_id]
            if (n) return { ...l, note_rich_html: n }
          }
          return l
        })
        const mergedNotes = [...(p.area_notes ?? [])]
        for (const [areaName, text] of Object.entries(data.area_notes ?? {})) {
          const idx = mergedNotes.findIndex(n => n.area_name === areaName)
          if (idx === -1) mergedNotes.push({ area_name: areaName, intro_rich_html: text })
          else if (!hasProseText(mergedNotes[idx].intro_rich_html))
            mergedNotes[idx] = { ...mergedNotes[idx], intro_rich_html: text }
        }
        next.area_notes = mergedNotes
        return next
      })
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
  const fromQuoteLines = pre.scope_lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => l.kind === 'from_quote')
  const addedLines = pre.scope_lines.map((l, idx) => ({ l, idx })).filter(({ l }) => l.kind === 'added')

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

      {/* AI assist */}
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, letterSpacing: '0.04em' }}>
          Draft from quote + notes (Claude)
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 12px' }}>
          Pre-fills the overview, per-line notes, and per-room intros from the quoted scope, progress notes, and photos.
          Only fills blank fields — it never overwrites your text or sets the status pills. Save first, then draft.
        </p>
        {persistedSnapshot === '' ? (
          <button type="button" className="btn btn-secondary" disabled style={{ fontSize: 13 }}>
            Save first to enable drafting
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={aiBusy}
            onClick={() => void draftFromQuote()}
            style={{ fontSize: 13 }}
          >
            {aiBusy ? (
              <>
                <span className="spinner" /> Drafting…
              </>
            ) : (
              'Draft from quote + notes'
            )}
          </button>
        )}
        {aiError && (
          <p style={{ fontSize: 13, color: '#F87171', margin: '10px 0 0' }} role="alert">
            {aiError}
          </p>
        )}
      </div>

      {/* Opening narrative */}
      <div style={sectionHeading}>Overview</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        Optional short opening summarising the job and how it went.
      </p>
      <RichTextEditor
        value={pre.opening_rich_html ?? ''}
        onChange={html => patchPre(p => ({ ...p, opening_rich_html: html }))}
        minHeight={120}
      />

      {/* Scope — as done */}
      <div style={sectionHeading}>
        Scope — as done{fromQuoteLines.length ? ` (${fromQuoteLines.length} from quote)` : ''}
      </div>
      {fromQuoteLines.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          This quote had no itemised scope lines to seed. Use Added works below to record what was done.
        </p>
      )}
      {fromQuoteLines.map(({ l, idx }) => {
        if (l.kind !== 'from_quote') return null
        const ctx = resolveQuotedLineContext(sourceContent, l.source_line_id)
        const status = l.status as LineStatus
        return (
          <div key={idx} style={card}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {(Object.keys(STATUS_META) as LineStatus[]).map(s => {
                const meta = STATUS_META[s]
                const active = status === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => patchLine(idx, ll => ({ ...ll, status: s } as PreScopeLine))}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: `1px solid ${active ? meta.color : 'var(--border)'}`,
                      background: active ? meta.bg : 'transparent',
                      color: active ? meta.color : 'var(--text-muted)',
                    }}
                  >
                    {meta.label}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
              {ctx?.sectionLabel ?? 'From quote'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: ctx?.detail ? 2 : 8 }}>
              Quoted: {ctx?.title ?? l.source_line_id}
            </div>
            {ctx?.detail && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>{ctx.detail}</div>
            )}
            {ctx?.unit && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Actual qty:</span>
                <input
                  type="number"
                  value={l.actual_qty ?? ''}
                  onChange={e =>
                    patchLine(idx, ll => ({
                      ...ll,
                      actual_qty: e.target.value === '' ? undefined : Number(e.target.value),
                      actual_unit: ctx.unit,
                    } as PreScopeLine))
                  }
                  style={{ ...textInput, width: 100 }}
                  placeholder={ctx.qty != null ? String(ctx.qty) : ''}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ctx.unit}</span>
              </div>
            )}
            <label style={fieldLabel}>Note</label>
            <RichTextEditor
              value={l.note_rich_html ?? ''}
              onChange={html => patchLine(idx, ll => ({ ...ll, note_rich_html: html } as PreScopeLine))}
              minHeight={90}
            />
            <PhotoAttacher
              photos={photos}
              selectedIds={l.photo_ids ?? []}
              onChange={ids => patchLine(idx, ll => ({ ...ll, photo_ids: ids } as PreScopeLine))}
            />
          </div>
        )
      })}

      {/* Added works */}
      <div style={sectionHeading}>Added works</div>
      {addedLines.map(({ l, idx }) => {
        if (l.kind !== 'added') return null
        return (
          <div key={idx} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Added work</span>
              <button
                type="button"
                onClick={() => removeLine(idx)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#F87171',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Remove
              </button>
            </div>
            <label style={fieldLabel}>Title</label>
            <input
              value={l.title}
              onChange={e => patchLine(idx, ll => ({ ...ll, title: e.target.value } as PreScopeLine))}
              placeholder="e.g. Roof cavity inspection"
              style={{ ...textInput, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span style={{ flex: 1 }}>
                <label style={fieldLabel}>Qty</label>
                <input
                  type="number"
                  value={l.qty ?? ''}
                  onChange={e =>
                    patchLine(idx, ll => ({
                      ...ll,
                      qty: e.target.value === '' ? undefined : Number(e.target.value),
                    } as PreScopeLine))
                  }
                  style={textInput}
                />
              </span>
              <span style={{ flex: 1 }}>
                <label style={fieldLabel}>Unit</label>
                <input
                  value={l.unit ?? ''}
                  onChange={e => patchLine(idx, ll => ({ ...ll, unit: e.target.value } as PreScopeLine))}
                  placeholder="hr, m², ea…"
                  style={textInput}
                />
              </span>
            </div>
            <label style={fieldLabel}>Description / note</label>
            <RichTextEditor
              value={l.note_rich_html ?? ''}
              onChange={html => patchLine(idx, ll => ({ ...ll, note_rich_html: html } as PreScopeLine))}
              minHeight={90}
            />
            <PhotoAttacher
              photos={photos}
              selectedIds={l.photo_ids ?? []}
              onChange={ids => patchLine(idx, ll => ({ ...ll, photo_ids: ids } as PreScopeLine))}
            />
          </div>
        )
      })}
      <button type="button" className="btn btn-secondary" onClick={addAddedWork} style={{ fontSize: 13 }}>
        + Add line
      </button>

      {/* Per-room notes */}
      <div style={sectionHeading}>Per-room notes &amp; photos</div>
      {areas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          No areas captured on this job. Add areas under Assessment to attach per-room evidence.
        </p>
      ) : (
        areas.map(area => {
          const note = (pre.area_notes ?? []).find(n => n.area_name === area.name)
          const captions = note?.photo_captions ?? []
          const selectedIds = captions.map(c => c.photo_id)
          return (
            <div key={area.name} style={card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>{area.name}</div>
              <label style={fieldLabel}>Intro note</label>
              <RichTextEditor
                value={note?.intro_rich_html ?? ''}
                onChange={html => patchAreaNote(area.name, n => ({ ...n, intro_rich_html: html }))}
                minHeight={80}
              />
              <PhotoAttacher
                photos={photos}
                selectedIds={selectedIds}
                onChange={ids =>
                  patchAreaNote(area.name, n => {
                    const prev = n.photo_captions ?? []
                    const next = ids.map(id => prev.find(c => c.photo_id === id) ?? { photo_id: id })
                    return { ...n, photo_captions: next }
                  })
                }
              />
              {captions.map(c => (
                <div key={c.photo_id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 60 }}>Caption</span>
                  <input
                    value={c.caption ?? ''}
                    onChange={e =>
                      patchAreaNote(area.name, n => ({
                        ...n,
                        photo_captions: (n.photo_captions ?? []).map(pc =>
                          pc.photo_id === c.photo_id ? { ...pc, caption: e.target.value } : pc,
                        ),
                      }))
                    }
                    placeholder="Optional caption…"
                    style={textInput}
                  />
                </div>
              ))}
            </div>
          )
        })
      )}

      {/* Closing narrative */}
      <div style={sectionHeading}>Outcome</div>
      <RichTextEditor
        value={pre.closing_rich_html ?? ''}
        onChange={html => patchPre(p => ({ ...p, closing_rich_html: html }))}
        minHeight={120}
      />

      {/* Sign-off */}
      <div style={sectionHeading}>Technician sign-off</div>
      <input
        value={pre.technician_signoff ?? ''}
        onChange={e => patchPre(p => ({ ...p, technician_signoff: e.target.value }))}
        placeholder="Name / role / date"
        style={textInput}
      />

      {saveError && <div style={{ fontSize: 13, color: '#F87171', margin: '16px 0 0' }}>{saveError}</div>}

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={saving || !isDirty}
        style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 20 }}
      >
        {saving ? 'Saving…' : savedFlash ? '✓ Saved' : 'Save Post Remediation Evaluation'}
      </button>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          {isDirty
            ? 'Save your changes first, then generate the document.'
            : 'Generate the print/PDF document for this evaluation.'}
        </div>
        {isDirty || persistedSnapshot === '' ? (
          <button type="button" className="btn btn-secondary" disabled style={{ fontSize: 13 }}>
            Generate document
          </button>
        ) : (
          <Link href={`/jobs/${job.id}/docs/report?compose=1&preId=${pre.id}`}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>
              Generate document
            </button>
          </Link>
        )}
      </div>
    </div>
  )
}
