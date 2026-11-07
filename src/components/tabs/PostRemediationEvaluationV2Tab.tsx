/*
 * Verify → Post Remediation Evaluation, multi-part.
 *
 * One report that states what was done: Part A Biohazard Cleaning (Biohazard
 * Cleaning Record), Part B Contents Clearance (Contents Disposal Record), Part
 * C Surface Area Cleaning (House Survey). A part is available when its record
 * exists, and its figures are read from the record, never a quote. Part A on a
 * fixed-price BCQ has no record and keeps its quote link. Letters are for this
 * editor only; the printed report numbers sections in order. NON-FINANCIAL.
 * Persists to assessment_data.pre_multi_part[].
 */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  AssessmentData,
  Document,
  Job,
  Photo,
  PostRemediationEvaluationV2,
  PrePart,
  PrePartKey,
  PreProductRow,
  PreRecordRow,
  PreWorksRow,
} from '@/lib/types'
import { preMeasuredRows, prePartSources, preVerifiedRecords, preWasteRecordRows } from '@/lib/preVerifiedRecords'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  PRE_PART_DEFS,
  PRE_PART_KEYS,
  getPreV2s,
  linkPartToQuote,
  makeBlankPreV2,
  quoteDocMeta,
  upsertPreV2,
} from '@/lib/postRemediationEvaluations'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import {
  BulletEditor,
  ReportImages,
  card,
  fieldLabel,
  hasProseText,
  sectionHeading,
  textInput,
} from '@/components/tabs/PostRemediationEvaluationTab'

interface Props {
  job: Job
  photos: Photo[]
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

type PartDraft = Pick<PrePart, 'works_rows' | 'methodology' | 'products_rows' | 'waste' | 'outcome_verification'>

interface DraftResponse {
  executive_summary?: string
  site_conditions?: string[]
  recommendations?: string[]
  compliance?: string
  limitations?: string
  parts?: Partial<Record<PrePartKey, PartDraft>>
  error?: string
}

function Prose({
  label,
  value,
  onChange,
  hint,
  minHeight = 110,
}: {
  label: string
  value: string | undefined
  onChange: (v: string) => void
  hint?: string
  minHeight?: number
}) {
  return (
    <>
      <div style={sectionHeading}>{label}</div>
      {hint && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>{hint}</p>}
      <textarea
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...textInput, minHeight, resize: 'vertical', lineHeight: 1.5 }}
      />
    </>
  )
}

/** Works Undertaken stages with drag-to-reorder. Keys stay stable while dragging. */
function WorksStagesEditor({ rows, onChange }: { rows: PreWorksRow[]; onChange: (rows: PreWorksRow[]) => void }) {
  const [keys, setKeys] = useState<string[]>(() => rows.map(() => crypto.randomUUID()))
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  if (keys.length !== rows.length) {
    setKeys(
      keys.length < rows.length
        ? [...keys, ...Array.from({ length: rows.length - keys.length }, () => crypto.randomUUID())]
        : keys.slice(0, rows.length),
    )
  }

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return
    const nextKeys = [...keys]
    const [key] = nextKeys.splice(from, 1)
    nextKeys.splice(to, 0, key)
    setKeys(nextKeys)
    const next = [...rows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  function remove(idx: number) {
    setKeys(keys.filter((_, i) => i !== idx))
    onChange(rows.filter((_, i) => i !== idx))
  }

  return (
    <div>
      {rows.map((r, idx) => (
        <div
          key={keys[idx] ?? `row-${idx}`}
          onDragOver={e => {
            e.preventDefault()
            if (over !== idx) setOver(idx)
          }}
          onDrop={e => {
            e.preventDefault()
            if (dragFrom !== null) move(dragFrom, idx)
            setDragFrom(null)
            setOver(null)
          }}
          style={{
            ...card,
            background: 'var(--surface-2)',
            outline: over === idx && dragFrom !== null && dragFrom !== idx ? '2px solid var(--accent, #60a5fa)' : undefined,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                draggable
                aria-label="Drag stage"
                title="Drag to reorder"
                onDragStart={e => {
                  setDragFrom(idx)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', 'stage')
                }}
                onDragEnd={() => {
                  setDragFrom(null)
                  setOver(null)
                }}
                style={{ cursor: 'grab', color: 'var(--text-muted)', fontWeight: 700, userSelect: 'none', lineHeight: 1 }}
              >
                ⋮⋮
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Stage {idx + 1}</span>
            </div>
            <button
              type="button"
              onClick={() => remove(idx)}
              style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 12 }}
            >
              Remove
            </button>
          </div>
          <label style={fieldLabel}>Stage name</label>
          <input
            value={r.stage_name}
            onChange={e => onChange(rows.map((x, i) => (i === idx ? { ...x, stage_name: e.target.value } : x)))}
            placeholder="e.g. Zone setup, Kitchen, Final check"
            style={{ ...textInput, marginBottom: 10 }}
          />
          <label style={fieldLabel}>Description</label>
          <textarea
            value={r.description}
            onChange={e => onChange(rows.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
            placeholder="First-person past-tense action description…"
            style={{ ...textInput, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onChange([...rows, { stage_name: '', description: '' }])}
        style={{ fontSize: 13 }}
      >
        + Add stage
      </button>
    </div>
  )
}

function ProductsEditor({ rows, onChange }: { rows: PreProductRow[]; onChange: (rows: PreProductRow[]) => void }) {
  return (
    <div>
      {rows.map((r, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            value={r.item_name}
            onChange={e => onChange(rows.map((x, i) => (i === idx ? { ...x, item_name: e.target.value } : x)))}
            placeholder="Item"
            style={{ ...textInput, flex: 1 }}
          />
          <input
            value={r.usage_note}
            onChange={e => onChange(rows.map((x, i) => (i === idx ? { ...x, usage_note: e.target.value } : x)))}
            placeholder="Usage note"
            style={{ ...textInput, flex: 1.4 }}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
            style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onChange([...rows, { item_name: '', usage_note: '' }])}
        style={{ fontSize: 12, padding: '6px 10px' }}
      >
        + Add item
      </button>
    </div>
  )
}

const RECORD_NAME: Record<PrePartKey, string> = {
  a: 'Biohazard Cleaning Record',
  b: 'Contents Disposal Record',
  c: 'House Survey',
}

function RecordRows({ rows, from }: { rows: PreRecordRow[]; from: string }) {
  if (!rows.length) return null
  return (
    <div style={{ ...card, background: 'var(--surface-2)', marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>From the {from} (printed as is)</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13, padding: '3px 0' }}>
          <span style={{ flex: '0 0 40%', fontWeight: 600 }}>{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function applyPartDraft(part: PrePart, draft: PartDraft | undefined): PrePart {
  if (!draft) return part
  return {
    ...part,
    works_rows: draft.works_rows ?? [],
    methodology: draft.methodology ?? '',
    products_rows: draft.products_rows ?? [],
    waste: draft.waste ?? {},
    outcome_verification: draft.outcome_verification ?? '',
  }
}

export default function PostRemediationEvaluationV2Tab({ job, photos, documents, onJobUpdate, onPhotosUpdate }: Props) {
  const bcqDocs = useMemo(
    () => documents
      .filter(d => d.type === PRE_PART_DEFS.a.docType)
      .slice()
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [documents],
  )
  const records = useMemo(() => preVerifiedRecords(job.assessment_data), [job.assessment_data])
  const sources = useMemo(() => prePartSources(job.assessment_data, records), [job.assessment_data, records])

  const [pre, setPre] = useState<PostRemediationEvaluationV2 | null>(null)
  const [persistedSnapshot, setPersistedSnapshot] = useState('')
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
  const [aiBusy, setAiBusy] = useState<PrePartKey | 'all' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    const list = getPreV2s(job.assessment_data)
    if (list.length > 0) {
      const newest = list.slice().sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))[0]
      setPre(newest)
      setPersistedSnapshot(JSON.stringify(newest))
    } else {
      setPre(null)
      setPersistedSnapshot('')
    }
  }, [job.id])

  const isDirty = pre ? JSON.stringify(pre) !== persistedSnapshot : false
  useRegisterUnsavedChanges('post-remediation-evaluation-v2', isDirty)

  function patchPre(mut: (p: PostRemediationEvaluationV2) => PostRemediationEvaluationV2) {
    setPre(prev => (prev ? mut(prev) : prev))
    setSavedFlash(false)
    setSaveError(null)
  }

  function patchPart(key: PrePartKey, mut: (p: PrePart) => PrePart) {
    patchPre(p => ({ ...p, parts: { ...p.parts, [key]: mut(p.parts[key]) } }))
  }

  function startNew() {
    setPre(makeBlankPreV2(documents, job.assessment_data))
    setPersistedSnapshot('')
    setSavedFlash(false)
    setSaveError(null)
  }

  async function regenerate(only?: PrePartKey) {
    if (!pre) return
    const enabled = PRE_PART_KEYS.filter(k => pre.parts[k].enabled && sources[k])
    if (only ? !enabled.includes(only) : enabled.length === 0) {
      setAiError('Switch on at least one part that has its record first.')
      return
    }
    const message = only
      ? `Replace the drafted Part ${PRE_PART_DEFS[only].letter} sections with a fresh draft? Its note is kept.`
      : 'Replace all drafted sections with a fresh draft? Your notes, attendance, and photos are kept.'
    if (preHasDraft(pre, only) && !window.confirm(message)) return
    setAiBusy(only ?? 'all')
    setAiError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-pre-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre, only }),
      })
      const data = (await res.json()) as DraftResponse
      if (!res.ok) throw new Error(data.error || 'Draft failed')
      patchPre(p => {
        const parts = { ...p.parts }
        for (const key of only ? [only] : enabled) parts[key] = applyPartDraft(parts[key], data.parts?.[key])
        if (only) return { ...p, parts }
        return {
          ...p,
          parts,
          executive_summary: data.executive_summary ?? '',
          site_conditions: data.site_conditions ?? [],
          recommendations: data.recommendations ?? [],
          compliance: data.compliance ?? '',
          limitations: data.limitations ?? '',
        }
      })
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Draft failed')
    } finally {
      setAiBusy(null)
    }
  }

  async function save() {
    if (!pre) return
    setSaving(true)
    setSaveError(null)
    try {
      const base = mergeAssessmentData(job.assessment_data)
      const merged: AssessmentData = { ...base, pre_multi_part: upsertPreV2(job.assessment_data, pre) }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.job) {
        onJobUpdate(data.job)
        const saved = getPreV2s(data.job.assessment_data).find(p => p.id === pre.id)
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
      if (!preRef.current) return
      setPre(prev => {
        if (!prev) return prev
        const next = { ...prev, report_image_ids: ids }
        preRef.current = next
        return next
      })
      const snap = snapshotRef.current
      if (!snap) return
      const nextSaved = { ...(JSON.parse(snap) as PostRemediationEvaluationV2), report_image_ids: ids }
      const jobNow = jobRef.current
      const base = mergeAssessmentData(jobNow.assessment_data)
      const merged: AssessmentData = { ...base, pre_multi_part: upsertPreV2(jobNow.assessment_data, nextSaved) }
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

  // ── Picker ──────────────────────────────────────────────────────────────────
  if (!pre) {
    const existing = getPreV2s(job.assessment_data)
      .slice()
      .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
    return (
      <div style={{ maxWidth: 720, paddingBottom: 32 }}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 16px' }}>
          One report of what was done: Part A Biohazard Cleaning from the Biohazard Cleaning Record, Part B Contents
          Clearance from the Contents Disposal Record, and Part C Surface Area Cleaning from the House Survey. A part
          prints when its record exists; parts you switch off are left out.
        </p>
        {existing.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPre(p)
              setPersistedSnapshot(JSON.stringify(p))
            }}
            style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer' }}
          >
            <span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                Multi-part PRE · Parts {PRE_PART_KEYS.filter(k => p.parts[k]?.enabled).map(k => PRE_PART_DEFS[k].letter).join(', ') || 'none'}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                Updated {new Date(p.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>open</span>
          </button>
        ))}
        <button type="button" className="btn btn-primary" onClick={startNew} style={{ padding: '12px 16px', fontWeight: 700 }}>
          New multi-part PRE
        </button>
      </div>
    )
  }

  // ── Builder ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 760, paddingBottom: 48 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {PRE_PART_KEYS.map(k => {
            const part = pre.parts[k]
            const def = PRE_PART_DEFS[k]
            return (
              <div key={k}>
                Part {def.letter} · {def.title}:{' '}
                {!sources[k] ? `no ${RECORD_NAME[k]}` : !part.enabled ? 'off' : sources[k] === 'record' ? RECORD_NAME[k] : 'fixed-price quote, no record'}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '6px 10px', flexShrink: 0 }}
          onClick={() => {
            if (isDirty && !window.confirm('Leave this report? Unsaved changes will be lost.')) return
            setPre(null)
          }}
        >
          All multi-part PREs
        </button>
      </div>

      <div style={sectionHeading}>Technician note — whole job</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        What happened across the whole job. Each part also has its own note. Used when you Regenerate; not printed.
      </p>
      <textarea
        value={pre.generation_brief ?? ''}
        onChange={e => patchPre(p => ({ ...p, generation_brief: e.target.value }))}
        placeholder="e.g. Three days on site. Bathroom needed extra subfloor treatment. Recommend a moisture re-check in 2 weeks."
        style={{ ...textInput, minHeight: 90, resize: 'vertical', lineHeight: 1.5 }}
      />

      <div style={sectionHeading}>Attendance</div>
      <input
        value={pre.attendance ?? ''}
        onChange={e => patchPre(p => ({ ...p, attendance: e.target.value }))}
        placeholder="e.g. 3 days on site"
        style={textInput}
      />

      <Prose
        label="01 · Executive Summary"
        value={pre.executive_summary}
        onChange={v => patchPre(p => ({ ...p, executive_summary: v }))}
        hint="The whole job: site, parts covered, duration, headline outcome."
      />

      <div style={sectionHeading}>02 · Site Conditions on Attendance</div>
      <BulletEditor
        items={pre.site_conditions ?? []}
        onChange={items => patchPre(p => ({ ...p, site_conditions: items }))}
        placeholder="Observation before work began…"
      />

      {PRE_PART_KEYS.map(key => {
        const part = pre.parts[key]
        const def = PRE_PART_DEFS[key]
        const source = sources[key]
        const fixedPrice = source === 'fixed_price'
        const wasteRecordRows = preWasteRecordRows(key, records)
        return (
          <div key={key} style={{ ...card, marginTop: 24, borderColor: part.enabled && source ? 'var(--accent)' : 'var(--border)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: source || part.enabled ? 'pointer' : 'default' }}>
              <input
                type="checkbox"
                checked={part.enabled}
                disabled={!source && !part.enabled}
                onChange={e => patchPart(key, p => ({ ...p, enabled: e.target.checked }))}
              />
              <span style={{ fontSize: 16, fontWeight: 700 }}>
                Part {def.letter} · {def.title}
              </span>
            </label>
            {!source ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                No {RECORD_NAME[key]} on this job yet — left out of the report.
              </p>
            ) : !part.enabled ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                Off — left out of the report.
              </p>
            ) : (
              <>
                {fixedPrice && (
                  <>
                    <div style={{ ...sectionHeading, marginTop: 16 }}>Fixed-price {def.quoteLabel} (no record)</div>
                    <select
                      value={part.source_quote_document_id ?? ''}
                      onChange={e => {
                        const doc = bcqDocs.find(d => d.id === e.target.value) ?? null
                        patchPart(key, p => linkPartToQuote(p, doc))
                      }}
                      style={textInput}
                    >
                      <option value="">No linked quote</option>
                      {bcqDocs.map(d => {
                        const meta = quoteDocMeta(d)
                        return (
                          <option key={d.id} value={d.id}>
                            {meta.label}{meta.reference ? ` · ${meta.reference}` : ''} · {meta.date}
                          </option>
                        )
                      })}
                    </select>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                      Used only to draft what the job covered. Its figures and the quote are never printed.
                    </p>
                  </>
                )}

                <div style={sectionHeading}>Technician note — Part {def.letter}</div>
                <textarea
                  value={part.generation_brief ?? ''}
                  onChange={e => patchPart(key, p => ({ ...p, generation_brief: e.target.value }))}
                  placeholder="What actually happened for this part — complexities, changes, anything not in the record."
                  style={{ ...textInput, minHeight: 80, resize: 'vertical', lineHeight: 1.5 }}
                />

                <div style={sectionHeading}>{def.letter}1 · Works Undertaken</div>
                <RecordRows rows={preMeasuredRows(key, records)} from={RECORD_NAME[key]} />
                <WorksStagesEditor
                  key={`${pre.id}-${key}`}
                  rows={part.works_rows ?? []}
                  onChange={rows => patchPart(key, p => ({ ...p, works_rows: rows }))}
                />

                <Prose
                  label={`${def.letter}2 · Methodology`}
                  value={part.methodology}
                  onChange={v => patchPart(key, p => ({ ...p, methodology: v }))}
                />

                <div style={sectionHeading}>{def.letter}3 · Products &amp; Equipment Used</div>
                <ProductsEditor
                  rows={part.products_rows ?? []}
                  onChange={rows => patchPart(key, p => ({ ...p, products_rows: rows }))}
                />

                <div style={sectionHeading}>{def.letter}4 · Waste Management &amp; Disposal</div>
                <RecordRows rows={wasteRecordRows} from={RECORD_NAME[key]} />
                {([
                  ['waste_type', 'Waste type'],
                  ['volume', 'Volume'],
                  ['containment', 'Containment'],
                  ['disposal', 'Disposal'],
                ] as const).filter(([field]) => !(field === 'volume' && wasteRecordRows.length)).map(([field, label]) => (
                  <div key={field} style={{ marginBottom: 8 }}>
                    <label style={fieldLabel}>{label}</label>
                    <input
                      value={part.waste?.[field] ?? ''}
                      onChange={e => patchPart(key, p => ({ ...p, waste: { ...(p.waste ?? {}), [field]: e.target.value } }))}
                      style={textInput}
                    />
                  </div>
                ))}

                <Prose
                  label={`${def.letter}5 · Outcome & Verification`}
                  value={part.outcome_verification}
                  onChange={v => patchPart(key, p => ({ ...p, outcome_verification: v }))}
                />

                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={aiBusy !== null || saving}
                  onClick={() => void regenerate(key)}
                  style={{ marginTop: 14, fontSize: 13 }}
                >
                  {aiBusy === key ? 'Generating…' : `Regenerate Part ${def.letter}`}
                </button>
              </>
            )}
          </div>
        )
      })}

      <div style={sectionHeading}>Recommendations</div>
      <BulletEditor
        items={pre.recommendations ?? []}
        onChange={items => patchPre(p => ({ ...p, recommendations: items }))}
        placeholder="Issue + impact + who must address it…"
      />

      <Prose
        label="Compliance"
        value={pre.compliance}
        onChange={v => patchPre(p => ({ ...p, compliance: v }))}
      />

      <Prose
        label="Limitations & Scope Notice"
        value={pre.limitations}
        onChange={v => patchPre(p => ({ ...p, limitations: v }))}
        hint="Scope of Work exclusions, areas not accessed, and the testing disclaimer."
      />

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
        Regenerate all drafts every section from the records (House Survey, Contents Disposal Record, Biohazard
        Cleaning Record) and your notes, replacing drafted content. Notes, attendance, and photos are kept. Review,
        then save.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void regenerate()}
          disabled={aiBusy !== null || saving}
          style={{ flex: 1, padding: 14, fontSize: 15 }}
        >
          {aiBusy === 'all' ? <><span className="spinner" /> Generating…</> : 'Regenerate all'}
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
          {isDirty ? 'Save your changes first, then create the document.' : 'Create the print/PDF document for this evaluation.'}
        </div>
        {isDirty || persistedSnapshot === '' ? (
          <button type="button" className="btn btn-secondary" disabled style={{ fontSize: 13 }}>
            Create document
          </button>
        ) : (
          <Link href={`/jobs/${job.id}/docs/report?compose=1&preV2Id=${pre.id}`}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>
              Create document
            </button>
          </Link>
        )}
      </div>
    </div>
  )
}

function preHasDraft(pre: PostRemediationEvaluationV2, only?: PrePartKey): boolean {
  const partHas = (k: PrePartKey) => {
    const p = pre.parts[k]
    return hasProseText(p.methodology) || hasProseText(p.outcome_verification) || (p.works_rows ?? []).length > 0
  }
  if (only) return partHas(only)
  return hasProseText(pre.executive_summary) || PRE_PART_KEYS.some(partHas)
}
