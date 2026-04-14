/*
 * Quote capture — workflow from Scope of Work into pricing (QuoteTab) and generated quote PDF.
 * Opened from Home → Data Capture → Quote.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import QuoteTab from '@/components/tabs/QuoteTab'
import type {
  Job,
  Document,
  OutcomeQuoteCapture,
  OutcomeQuoteRow,
  OutcomeQuoteStatus,
  QuoteLineItemRow,
  QuoteLineItemRun,
} from '@/lib/types'
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
  return value
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean)
}

function joinLines(value: string[] | undefined): string {
  return (value ?? []).join('\n')
}

function toMoney(n: number): number {
  return Math.round(n * 100) / 100
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

function computeOutcomeTotals(rows: OutcomeQuoteRow[], includeGst: boolean) {
  const subtotal = toMoney(rows.reduce((sum, row) => sum + Math.max(0, Number(row.price || 0)), 0))
  const gst = includeGst ? toMoney(subtotal * 0.1) : 0
  const total = toMoney(subtotal + gst)
  return { subtotal, gst, total }
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

export default function QuoteCaptureTab({ job, documents, onJobUpdate, onGoToScope }: Props) {
  const sow = mergedSowCapture(job.assessment_data)
  const hasScope = staffSowHasContent(job.assessment_data)
  const [run, setRun] = useState<QuoteLineItemRun | null>(null)
  const [items, setItems] = useState<QuoteLineItemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [addingRoom, setAddingRoom] = useState('')
  const [freshnessStatus, setFreshnessStatus] = useState<'missing' | 'up_to_date' | 'needs_refresh'>('missing')
  const [targetAmountInput, setTargetAmountInput] = useState('')
  const [targetPriceNoteInput, setTargetPriceNoteInput] = useState('')
  const [quoteMode, setQuoteMode] = useState<'line_items' | 'outcomes'>(
    job.assessment_data?.outcome_quote_capture?.mode === 'outcomes' ? 'outcomes' : 'line_items'
  )
  const [outcomeRows, setOutcomeRows] = useState<OutcomeQuoteRow[]>(
    job.assessment_data?.outcome_quote_capture?.rows ?? []
  )
  const [outcomeSuggesting, setOutcomeSuggesting] = useState(false)

  async function loadItems() {
    setLoading(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-line-items`)
      const data = (await res.json()) as {
        run: QuoteLineItemRun | null
        items: QuoteLineItemRow[]
        freshness_status?: 'missing' | 'up_to_date' | 'needs_refresh'
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not load line items')
      setRun(data.run)
      setItems(data.items ?? [])
      setFreshnessStatus(data.freshness_status ?? (data.run ? 'needs_refresh' : 'missing'))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not load line items')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])

  useEffect(() => {
    const capture = job.assessment_data?.outcome_quote_capture
    setQuoteMode(capture?.mode === 'outcomes' ? 'outcomes' : 'line_items')
    setOutcomeRows(capture?.rows ?? [])
  }, [job.id, job.updated_at, job.assessment_data?.outcome_quote_capture])

  async function regenerateSuggestions() {
    if (!hasScope) {
      window.alert('Capture Scope of Work first.')
      return
    }
    setSuggesting(true)
    try {
      const trimmedTarget = targetAmountInput.trim()
      const parsedTarget = trimmedTarget === '' ? null : Number(trimmedTarget)
      if (parsedTarget != null && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
        throw new Error('Target amount must be a number >= 0')
      }
      await saveTargetPricingForSuggestions(parsedTarget, targetPriceNoteInput.trim())
      const res = await fetch(`/api/jobs/${job.id}/quote-line-items/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_amount: parsedTarget,
          target_price_note: targetPriceNoteInput.trim(),
        }),
      })
      const data = (await res.json()) as { run?: QuoteLineItemRun; items?: QuoteLineItemRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not generate suggestions')
      setRun(data.run ?? null)
      setItems(data.items ?? [])
      setFreshnessStatus(data.run ? 'up_to_date' : 'missing')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not generate suggestions')
    } finally {
      setSuggesting(false)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, QuoteLineItemRow[]>()
    for (const i of items) {
      const k = (i.room_name || '').trim() || 'Unassigned'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(i)
    }
    return Array.from(map.entries()).map(([room, rows]) => ({ room, rows }))
  }, [items])

  const subtotal = useMemo(() => items.reduce((s, i) => s + Number(i.total || 0), 0), [items])
  const addGst = run?.add_gst_to_total === true
  const gstAmount = useMemo(
    () => (addGst ? Math.round(subtotal * 0.1 * 100) / 100 : 0),
    [addGst, subtotal],
  )
  const grandTotal = useMemo(() => Math.round((subtotal + gstAmount) * 100) / 100, [subtotal, gstAmount])
  const target = run?.target_amount ?? job.assessment_data?.target_price ?? null
  const targetNote = run?.target_price_note ?? job.assessment_data?.target_price_note ?? ''

  useEffect(() => {
    setTargetAmountInput(target == null ? '' : String(target))
    setTargetPriceNoteInput(targetNote ?? '')
  }, [target, targetNote])

  async function saveTargetPricingForSuggestions(nextTarget: number | null, nextNote: string) {
    const merged = { ...(job.assessment_data ?? {}) } as Record<string, unknown>
    if (nextTarget == null) delete merged.target_price
    else merged.target_price = nextTarget
    merged.target_price_note = nextNote
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assessment_data: merged }),
    })
    const data = (await res.json()) as { job?: Job; error?: string }
    if (!res.ok || !data.job) throw new Error(data.error ?? 'Could not save target pricing')
    onJobUpdate(data.job)
  }

  async function saveOutcomeCapture(nextRows: OutcomeQuoteRow[], nextMode = quoteMode) {
    const merged = { ...(job.assessment_data ?? {}) } as Record<string, unknown>
    const totals = computeOutcomeTotals(nextRows, addGst)
    const current = (job.assessment_data?.outcome_quote_capture ?? {}) as Partial<OutcomeQuoteCapture>
    merged.outcome_quote_capture = {
      mode: nextMode,
      rows: nextRows,
      totals,
      target_pricing: {
        target_amount: target == null ? undefined : Number(target),
        target_price_note: targetNote ?? '',
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

  function patchOutcomeRow(
    rowId: string,
    updater: (row: OutcomeQuoteRow) => OutcomeQuoteRow
  ) {
    setOutcomeRows(prev =>
      prev.map(row => {
        if (row.id !== rowId) return row
        const next = updater(row)
        const changed = JSON.stringify(row) !== JSON.stringify(next)
        const statusExplicitlyChanged = row.status !== next.status
        // HITL rule: editing content without explicit status action auto-marks as edited.
        if (changed && !statusExplicitlyChanged && row.status !== 'edited') {
          return { ...next, status: 'edited' }
        }
        return next
      })
    )
  }

  async function suggestOutcomeRows() {
    if (!hasScope) {
      window.alert('Capture Scope of Work first.')
      return
    }
    setOutcomeSuggesting(true)
    try {
      const trimmedTarget = targetAmountInput.trim()
      const parsedTarget = trimmedTarget === '' ? null : Number(trimmedTarget)
      if (parsedTarget != null && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
        throw new Error('Target amount must be a number >= 0')
      }
      await saveTargetPricingForSuggestions(parsedTarget, targetPriceNoteInput.trim())
      const res = await fetch(`/api/jobs/${job.id}/quote-outcomes/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_amount: parsedTarget,
          target_price_note: targetPriceNoteInput.trim(),
        }),
      })
      const data = (await res.json()) as { rows?: OutcomeQuoteRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not suggest outcomes')
      const rows = (data.rows ?? []).map((row, idx) => ({ ...row, id: row.id || `suggested_${idx + 1}` }))
      setOutcomeRows(rows)
      await saveOutcomeCapture(rows, 'outcomes')
      setQuoteMode('outcomes')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not suggest outcomes')
    } finally {
      setOutcomeSuggesting(false)
    }
  }

  async function patchAddGst(next: boolean) {
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-line-items/run`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_gst_to_total: next }),
      })
      const data = (await res.json()) as { run?: QuoteLineItemRun; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update GST setting')
      if (data.run) setRun(data.run)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not update GST setting')
    }
  }

  async function patchItem(itemId: string, patch: Partial<QuoteLineItemRow>) {
    const body = {
      room_name: patch.room_name,
      description: patch.description,
      qty: patch.qty,
      unit: patch.unit,
      rate: patch.rate,
    }
    const res = await fetch(`/api/jobs/${job.id}/quote-line-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { item?: QuoteLineItemRow; error?: string }
    if (!res.ok || !data.item) throw new Error(data.error ?? 'Could not update line item')
    setItems(prev => prev.map(x => (x.id === itemId ? data.item! : x)))
  }

  async function deleteItem(itemId: string) {
    const res = await fetch(`/api/jobs/${job.id}/quote-line-items/${itemId}`, { method: 'DELETE' })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Could not delete item')
    setItems(prev => prev.filter(x => x.id !== itemId))
  }

  async function addRoomWithSeedItem() {
    const room = addingRoom.trim()
    if (!room) return
    const res = await fetch(`/api/jobs/${job.id}/quote-line-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_name: room, description: 'New line item', qty: 1, unit: 'hrs', rate: 0 }),
    })
    const data = (await res.json()) as { run?: QuoteLineItemRun; item?: QuoteLineItemRow; error?: string }
    if (!res.ok || !data.item) {
      window.alert(data.error ?? 'Could not add room')
      return
    }
    if (data.run) setRun(data.run)
    setItems(prev => [...prev, data.item!])
    setAddingRoom('')
  }

  async function deleteRoom(roomName: string) {
    if (!window.confirm(`Delete all line items in "${roomName}"?`)) return
    const roomItems = items.filter(i => i.room_name === roomName)
    for (const it of roomItems) {
      await deleteItem(it.id)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Set pricing and terms here; the generated quote uses your{' '}
        <strong style={{ color: 'var(--text)' }}>Scope of Work</strong> capture plus assessment and hazards so line items
        and wording stay aligned with the agreed scope.
      </p>

      <div
        style={{
          marginBottom: 18,
          padding: '10px 12px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="button"
          className={quoteMode === 'line_items' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ fontSize: 12 }}
          onClick={() => setQuoteMode('line_items')}
        >
          Line items mode
        </button>
        <button
          type="button"
          className={quoteMode === 'outcomes' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ fontSize: 12 }}
          onClick={() => setQuoteMode('outcomes')}
        >
          Outcome pricing mode
        </button>
      </div>

      {quoteMode === 'line_items' && (
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
      )}

      {quoteMode === 'outcomes' && (
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
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Outcome pricing focuses on results per area. Approve/edit outcomes and pricing before rendering client quote.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px', marginBottom: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Target Amount</label>
              <input
                type="number"
                min="0"
                step="50"
                placeholder="0.00"
                value={targetAmountInput}
                onChange={e => setTargetAmountInput(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>GST Note</label>
              <input
                type="text"
                value={targetPriceNoteInput}
                onChange={e => setTargetPriceNoteInput(e.target.value)}
                placeholder="e.g. inc. GST  or  + GST"
              />
            </div>
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
                  if (guardrails.length > 0) {
                    throw new Error(guardrails[0])
                  }
                  await saveOutcomeCapture(outcomeRows, 'outcomes')
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
                      <input
                        value={row.outcome_title}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, outcome_title: e.target.value }))}
                        placeholder="Outcome title"
                      />
                      <input
                        value={row.areas.join(', ')}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, areas: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }))}
                        placeholder="Areas (comma separated)"
                      />
                    </div>
                    <textarea
                      value={row.outcome_description}
                      onChange={e => patchOutcomeRow(row.id, r => ({ ...r, outcome_description: e.target.value }))}
                      placeholder="Outcome description"
                      rows={2}
                      style={{ marginTop: 8 }}
                    />
                    <textarea
                      value={row.acceptance_criteria}
                      onChange={e => patchOutcomeRow(row.id, r => ({ ...r, acceptance_criteria: e.target.value }))}
                      placeholder="Acceptance criteria"
                      rows={2}
                      style={{ marginTop: 8 }}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.price}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, price: Math.max(0, Number(e.target.value || 0)) }))}
                        placeholder="Price"
                      />
                      <input
                        value={row.verification_method}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, verification_method: e.target.value }))}
                        placeholder="Verification method"
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                      <textarea
                        value={joinLines(row.included)}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, included: splitLines(e.target.value) }))}
                        placeholder="Included (one per line)"
                        rows={3}
                      />
                      <textarea
                        value={joinLines(row.excluded)}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, excluded: splitLines(e.target.value) }))}
                        placeholder="Excluded (one per line)"
                        rows={3}
                      />
                      <textarea
                        value={joinLines(row.assumptions)}
                        onChange={e => patchOutcomeRow(row.id, r => ({ ...r, assumptions: splitLines(e.target.value) }))}
                        placeholder="Assumptions (one per line)"
                        rows={3}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => patchOutcomeRow(row.id, r => ({ ...r, status: 'approved' as OutcomeQuoteStatus }))}>
                        Approve
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => patchOutcomeRow(row.id, r => ({ ...r, status: 'rejected' as OutcomeQuoteStatus }))}>
                        Reject
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => patchOutcomeRow(row.id, r => ({ ...r, status: 'suggested' as OutcomeQuoteStatus }))}>
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
            Subtotal (ex-GST): <strong style={{ color: 'var(--text)' }}>${computeOutcomeTotals(outcomeRows, addGst).subtotal.toFixed(2)}</strong>
            {addGst && (
              <>
                <br />
                GST (10%): <strong style={{ color: 'var(--text)' }}>${computeOutcomeTotals(outcomeRows, addGst).gst.toFixed(2)}</strong>
                <br />
                Total (inc. GST): <strong style={{ color: 'var(--text)' }}>${computeOutcomeTotals(outcomeRows, addGst).total.toFixed(2)}</strong>
              </>
            )}
          </div>
          {invalidOutcomeRows(outcomeRows).length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#F59E0B' }}>
              Publish/build guardrails: approved/edited outcomes require price &gt; 0, acceptance criteria, and verification method.
            </div>
          )}
        </div>
      )}

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
            Suggested line items (by room)
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
            onClick={regenerateSuggestions}
            disabled={suggesting || !hasScope}
            title={hasScope ? 'Regenerate replaces current suggestions' : 'Capture scope first'}
          >
            {suggesting ? 'Generating…' : items.length ? 'Regenerate (replace)' : 'Suggest line items'}
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
          AI drafts line items by room from Scope of Work, with target amount as a key pricing constraint. You can edit description, qty, unit, and rate. Regenerate replaces current suggestions.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px', marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              Target Amount
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                AI considers this while distributing amounts
              </span>
            </label>
            <div style={{ position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  fontSize: 15,
                  fontWeight: 600,
                  pointerEvents: 'none',
                }}
              >
                $
              </span>
              <input
                type="number"
                min="0"
                step="50"
                placeholder="0.00"
                value={targetAmountInput}
                onChange={e => setTargetAmountInput(e.target.value)}
                style={{ paddingLeft: 24 }}
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>GST Note</label>
            <input
              type="text"
              value={targetPriceNoteInput}
              onChange={e => setTargetPriceNoteInput(e.target.value)}
              placeholder="e.g. inc. GST  or  + GST"
            />
          </div>
        </div>
        <p style={{ fontSize: 12, margin: '0 0 12px', lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Source status:{' '}
          <strong style={{ color: freshnessStatus === 'up_to_date' ? '#10B981' : freshnessStatus === 'needs_refresh' ? '#F59E0B' : 'var(--text)' }}>
            {freshnessStatus === 'up_to_date'
              ? 'Up to date'
              : freshnessStatus === 'needs_refresh'
                ? 'Needs refresh (scope/details changed)'
                : 'Not generated yet'}
          </strong>
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 12 }}>
          <input
            value={addingRoom}
            onChange={e => setAddingRoom(e.target.value)}
            placeholder="Add room (e.g. Lobby)"
          />
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={addRoomWithSeedItem}>
            Add room
          </button>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading suggestions…</div>
        ) : grouped.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No suggestions yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {grouped.map(group => (
              <div key={group.room} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{group.room}</strong>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, color: '#F87171' }}
                    onClick={() => void deleteRoom(group.room)}
                  >
                    Delete room
                  </button>
                </div>

                {group.rows.map(row => {
                  const onField = async (patch: Partial<QuoteLineItemRow>) => {
                    try {
                      await patchItem(row.id, patch)
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : 'Could not update line item')
                    }
                  }
                  return (
                    <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '2fr 72px 72px 96px 96px auto', gap: 8, marginBottom: 8 }}>
                      <input
                        defaultValue={row.description}
                        onBlur={e => void onField({ description: e.target.value })}
                        placeholder="Description"
                      />
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        defaultValue={row.qty}
                        onBlur={e => void onField({ qty: Number(e.target.value || 0) })}
                        placeholder="Qty"
                      />
                      <input
                        defaultValue={row.unit}
                        onBlur={e => void onField({ unit: e.target.value })}
                        placeholder="Unit"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={row.rate}
                        onBlur={e => void onField({ rate: Number(e.target.value || 0) })}
                        placeholder="Rate"
                      />
                      <div style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                        ${Number(row.total).toFixed(2)}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, color: '#F87171' }}
                        onClick={() => void deleteItem(row.id)}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            marginTop: 14,
            fontSize: 13,
            cursor: 'pointer',
            lineHeight: 1.45,
          }}
        >
          <input
            type="checkbox"
            checked={addGst}
            onChange={e => void patchAddGst(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span style={{ color: 'var(--text)' }}>
            Add 10% GST to quote totals
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginTop: 4 }}>
              Line amounts are ex-GST; the generated quote and PDF include subtotal, GST, and total when enabled.
            </span>
          </span>
        </label>

        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          Subtotal (ex-GST): <strong style={{ color: 'var(--text)' }}>${subtotal.toFixed(2)}</strong>
          {addGst && (
            <>
              <br />
              GST (10%): <strong style={{ color: 'var(--text)' }}>${gstAmount.toFixed(2)}</strong>
              <br />
              Total (inc. GST): <strong style={{ color: 'var(--text)' }}>${grandTotal.toFixed(2)}</strong>
            </>
          )}
          {target != null && (
            <>
              <br />
              Target: <strong style={{ color: 'var(--text)' }}>${Number(target).toFixed(2)}</strong>
              {' '}({targetNote || 'no GST note'})
            </>
          )}
        </div>
      </div>

      <QuoteTab job={job} documents={documents} onJobUpdate={onJobUpdate} hideTargetPricing />
    </div>
  )
}
