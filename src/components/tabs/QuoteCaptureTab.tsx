/*
 * Quote capture — workflow from Scope of Work into pricing (QuoteTab) and generated quote PDF.
 * Opened from Home → Data Capture → Quote.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import QuoteTab from '@/components/tabs/QuoteTab'
import type { Job, Document, QuoteLineItemRow, QuoteLineItemRun } from '@/lib/types'
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

export default function QuoteCaptureTab({ job, documents, onJobUpdate, onGoToScope }: Props) {
  const sow = mergedSowCapture(job.assessment_data)
  const hasScope = staffSowHasContent(job.assessment_data)
  const [run, setRun] = useState<QuoteLineItemRun | null>(null)
  const [items, setItems] = useState<QuoteLineItemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [addingRoom, setAddingRoom] = useState('')
  const [freshnessStatus, setFreshnessStatus] = useState<'missing' | 'up_to_date' | 'needs_refresh'>('missing')

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

  async function regenerateSuggestions() {
    if (!hasScope) {
      window.alert('Capture Scope of Work first.')
      return
    }
    setSuggesting(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-line-items/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          AI drafts line items by room from Scope of Work. You can edit description, qty, unit, and rate. Regenerate replaces current suggestions.
        </p>
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

      <QuoteTab job={job} documents={documents} onJobUpdate={onJobUpdate} />
    </div>
  )
}
