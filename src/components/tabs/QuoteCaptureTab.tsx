/*
 * Quote capture — workflow from Scope of Work into pricing (QuoteTab) and generated quote PDF.
 * Opened from Home → Data Capture → Quote.
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import QuoteTab from '@/components/tabs/QuoteTab'
import type { Job, Document, OutcomeQuoteCapture, OutcomeQuoteRow, OutcomeQuoteStatus } from '@/lib/types'
import { mergedSowCapture, staffSowHasContent } from '@/lib/sowCapture'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onGoToScope?: () => void
}

function truncate(s: string, max: number) {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max).trim()}…`
}

function splitLines(value: string): string[] {
  return value.split('\n').map(v => v.trim()).filter(Boolean)
}

function joinLines(value: string[] | undefined): string {
  return (value ?? []).join('\n')
}

function toMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function shouldAddGstFromNote(note: string): boolean {
  const n = note.toLowerCase()
  return n.includes('ex') || n.includes('excl') || n.includes('+ gst') || n.includes('+gst')
}

function computeOutcomeTotals(rows: OutcomeQuoteRow[], addGst: boolean) {
  const subtotal = toMoney(rows.reduce((sum, row) => sum + Math.max(0, Number(row.price || 0)), 0))
  const gst = addGst ? toMoney(subtotal * 0.1) : 0
  const total = toMoney(subtotal + gst)
  return { subtotal, gst, total }
}

function makeOutcomeRow(seed = 1): OutcomeQuoteRow {
  return {
    id: `manual_${Date.now()}_${seed}`,
    areas: [],
    outcome_title: '',
    outcome_description: '',
    acceptance_criteria: '',
    price: 0,
    status: 'suggested',
    included: [],
    excluded: [],
    assumptions: [],
    verification_method: '',
  }
}

function isRenderableOutcome(row: OutcomeQuoteRow): boolean {
  return (
    (row.status === 'approved' || row.status === 'edited') &&
    row.price > 0 &&
    row.outcome_title.trim().length > 0 &&
    row.acceptance_criteria.trim().length > 0 &&
    row.verification_method.trim().length > 0
  )
}

function invalidOutcomeRows(rows: OutcomeQuoteRow[]): string[] {
  const bad: string[] = []
  rows.forEach((row, idx) => {
    if (row.status !== 'approved' && row.status !== 'edited') return
    if (row.price <= 0) bad.push(`Outcome ${idx + 1}: price must be greater than 0`)
    if (!row.acceptance_criteria.trim()) bad.push(`Outcome ${idx + 1}: acceptance criteria is required`)
    if (!row.verification_method.trim()) bad.push(`Outcome ${idx + 1}: verification method is required`)
  })
  return bad
}

function applyOutcomeRowPatch(
  rows: OutcomeQuoteRow[],
  rowId: string,
  updater: (row: OutcomeQuoteRow) => OutcomeQuoteRow,
): OutcomeQuoteRow[] {
  return rows.map(row => {
    if (row.id !== rowId) return row
    const next = updater(row)
    const changed = JSON.stringify(row) !== JSON.stringify(next)
    const statusExplicitlyChanged = row.status !== next.status
    if (changed && !statusExplicitlyChanged && row.status !== 'edited') {
      return { ...next, status: 'edited' }
    }
    return next
  })
}

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  style,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onInput={e => {
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
      placeholder={placeholder}
      rows={rows}
      style={{ resize: 'none', overflow: 'hidden', minHeight: `${rows * 1.6}em`, ...style }}
    />
  )
}

export default function QuoteCaptureTab({ job, documents, onJobUpdate, onGoToScope }: Props) {
  const sow = mergedSowCapture(job.assessment_data)
  const hasScope = staffSowHasContent(job.assessment_data)
  const [outcomeRows, setOutcomeRows] = useState<OutcomeQuoteRow[]>(
    job.assessment_data?.outcome_quote_capture?.rows ?? []
  )
  const [outcomeSuggesting, setOutcomeSuggesting] = useState(false)
  const [savingStatusRowId, setSavingStatusRowId] = useState<string | null>(null)
  const addGst = shouldAddGstFromNote(job.assessment_data?.target_price_note ?? '')

  useEffect(() => {
    const capture = job.assessment_data?.outcome_quote_capture
    setOutcomeRows(capture?.rows ?? [])
  }, [job.id, job.updated_at, job.assessment_data?.outcome_quote_capture])

  const totals = useMemo(
    () => computeOutcomeTotals(outcomeRows, addGst),
    [outcomeRows, addGst]
  )

  async function saveOutcomeCapture(nextRows: OutcomeQuoteRow[]) {
    const merged = { ...(job.assessment_data ?? {}) } as Record<string, unknown>
    const current = (job.assessment_data?.outcome_quote_capture ?? {}) as Partial<OutcomeQuoteCapture>
    merged.outcome_quote_capture = {
      mode: 'outcomes',
      rows: nextRows,
      totals: computeOutcomeTotals(nextRows, addGst),
      target_pricing: {
        target_amount: undefined,
        target_price_note: '',
      },
      last_suggested_at: current.last_suggested_at,
      last_reviewed_at: current.last_reviewed_at,
    } satisfies OutcomeQuoteCapture
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assessment_data: merged }),
    })
    const data = (await res.json()) as { job?: Job; error?: string }
    if (!res.ok || !data.job) throw new Error(data.error ?? 'Could not save outcome quote capture')
    onJobUpdate(data.job)
  }

  function patchOutcomeRow(rowId: string, updater: (row: OutcomeQuoteRow) => OutcomeQuoteRow) {
    setOutcomeRows(prev => applyOutcomeRowPatch(prev, rowId, updater))
  }

  async function setOutcomeStatusAndSave(rowId: string, status: OutcomeQuoteStatus) {
    const nextRows = applyOutcomeRowPatch(outcomeRows, rowId, r => ({ ...r, status }))
    setOutcomeRows(nextRows)
    setSavingStatusRowId(rowId)
    try {
      await saveOutcomeCapture(nextRows)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not save outcome status')
    } finally {
      setSavingStatusRowId(null)
    }
  }

  async function suggestOutcomeRows() {
    if (!hasScope) {
      window.alert('Capture Scope of Work first.')
      return
    }
    setOutcomeSuggesting(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-outcomes/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = (await res.json()) as { rows?: OutcomeQuoteRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not suggest outcomes')
      const rows = (data.rows ?? []).map((row, idx) => ({ ...row, id: row.id || `suggested_${idx + 1}` }))
      setOutcomeRows(rows)
      await saveOutcomeCapture(rows)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not suggest outcomes')
    } finally {
      setOutcomeSuggesting(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Set pricing and terms here; the generated quote uses your{' '}
        <strong style={{ color: 'var(--text)' }}>Scope of Work</strong> capture to create outcome-based quote packages.
      </p>

      <div
        style={{
          marginBottom: 28,
          padding: '16px 18px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 10,
          }}
        >
          Scope of Work (summary)
        </div>
        {hasScope ? (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 12px', color: 'var(--text)' }}>
              {sow.objective.trim()
                ? truncate(sow.objective, 320)
                : truncate(sow.scope_work || sow.methodology, 320) || 'Scope fields present — open Scope of Work for full detail.'}
            </p>
            {onGoToScope && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={onGoToScope}>
                Edit scope of work
              </button>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
              No scope capture yet. Capture objective and scope first so the quote can reference the same intent.
            </p>
            {onGoToScope && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={onGoToScope}>
                Open Scope of Work
              </button>
            )}
          </>
        )}
      </div>

      <div
        style={{
          marginBottom: 28,
          padding: '16px 18px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
            }}
          >
            Suggested outcomes (HITL)
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
            onClick={() => void suggestOutcomeRows()}
            disabled={outcomeSuggesting || !hasScope}
            title={hasScope ? 'Suggest outcomes from scope and context' : 'Capture scope first'}
          >
            {outcomeSuggesting ? 'Generating…' : 'Suggest outcomes'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12 }}
            onClick={() => setOutcomeRows(prev => [...prev, makeOutcomeRow(prev.length + 1)])}
          >
            Add outcome row
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={async () => {
              try {
                const guardrails = invalidOutcomeRows(outcomeRows)
                if (guardrails.length > 0) throw new Error(guardrails[0])
                await saveOutcomeCapture(outcomeRows)
                window.alert('Outcome pricing saved.')
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Could not save outcome pricing')
              }
            }}
          >
            Save outcomes
          </button>
        </div>

        {outcomeRows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No outcome rows yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {outcomeRows.map((row, idx) => {
              const rowValid = isRenderableOutcome(row)
              return (
                <div key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>Outcome {idx + 1}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge" style={{ fontSize: 11 }}>{row.status}</span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, color: '#F87171' }}
                        onClick={() => setOutcomeRows(prev => prev.filter(x => x.id !== row.id))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Outcome title</label>
                      <AutoGrowTextarea
                        value={row.outcome_title}
                        onChange={next => patchOutcomeRow(row.id, r => ({ ...r, outcome_title: next }))}
                        placeholder="Outcome title"
                        rows={1}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Areas</label>
                      <AutoGrowTextarea
                        value={row.areas.join(', ')}
                        onChange={next => patchOutcomeRow(row.id, r => ({ ...r, areas: next.split(',').map(v => v.trim()).filter(Boolean) }))}
                        placeholder="Areas (comma separated)"
                        rows={1}
                      />
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 0, marginTop: 8 }}>
                    <label>Outcome description</label>
                    <AutoGrowTextarea
                      value={row.outcome_description}
                      onChange={next => patchOutcomeRow(row.id, r => ({ ...r, outcome_description: next }))}
                      placeholder="Outcome description"
                      rows={2}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0, marginTop: 8 }}>
                    <label>Acceptance criteria</label>
                    <AutoGrowTextarea
                      value={row.acceptance_criteria}
                      onChange={next => patchOutcomeRow(row.id, r => ({ ...r, acceptance_criteria: next }))}
                      placeholder="Acceptance criteria"
                      rows={2}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Price</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.price}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, price: Math.max(0, Number(e.target.value || 0)) }))}
                        placeholder="Price"
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Verification method</label>
                      <AutoGrowTextarea
                        value={row.verification_method}
                        onChange={next => patchOutcomeRow(row.id, r => ({ ...r, verification_method: next }))}
                        placeholder="Verification method"
                        rows={1}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Included</label>
                      <AutoGrowTextarea
                        value={joinLines(row.included)}
                        onChange={next => patchOutcomeRow(row.id, r => ({ ...r, included: splitLines(next) }))}
                        placeholder="Included (one per line)"
                        rows={3}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Excluded</label>
                      <AutoGrowTextarea
                        value={joinLines(row.excluded)}
                        onChange={next => patchOutcomeRow(row.id, r => ({ ...r, excluded: splitLines(next) }))}
                        placeholder="Excluded (one per line)"
                        rows={3}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Assumptions</label>
                      <AutoGrowTextarea
                        value={joinLines(row.assumptions)}
                        onChange={next => patchOutcomeRow(row.id, r => ({ ...r, assumptions: splitLines(next) }))}
                        placeholder="Assumptions (one per line)"
                        rows={3}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12 }}
                      disabled={savingStatusRowId === row.id}
                      onClick={() => void setOutcomeStatusAndSave(row.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      disabled={savingStatusRowId === row.id}
                      onClick={() => void setOutcomeStatusAndSave(row.id, 'rejected')}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      disabled={savingStatusRowId === row.id}
                      onClick={() => void setOutcomeStatusAndSave(row.id, 'suggested')}
                    >
                      Reset suggested
                    </button>
                    {!rowValid && (
                      <span style={{ alignSelf: 'center', fontSize: 12, color: '#F59E0B' }}>
                        Needs title, acceptance criteria, verification method, and price &gt; 0
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          Subtotal: <strong style={{ color: 'var(--text)' }}>${totals.subtotal.toFixed(2)}</strong>
          {totals.gst > 0 && (
            <>
              <br />
              GST (10%): <strong style={{ color: 'var(--text)' }}>${totals.gst.toFixed(2)}</strong>
              <br />
              Total (inc. GST): <strong style={{ color: 'var(--text)' }}>${totals.total.toFixed(2)}</strong>
            </>
          )}
        </div>
        {invalidOutcomeRows(outcomeRows).length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#F59E0B' }}>
            Publish/build guardrails: approved/edited outcomes require price &gt; 0, acceptance criteria, and verification method.
          </div>
        )}
      </div>

      <QuoteTab job={job} documents={documents} onJobUpdate={onJobUpdate} hideTargetPricing />
    </div>
  )
}
