/*
 * Quote capture — collaborative outcome-based pricing editor.
 * AI suggests from structured data + staff instruction; HITL edits and saves.
 * Persists to assessment_data.outcome_quote_capture via PATCH /api/jobs/[id].
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Job, Document, OutcomeQuoteCapture, OutcomeQuoteRow, QuoteAuthorisation } from '@/lib/types'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onGoToScope?: () => void
}

function toMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function shouldAddGst(note: string): boolean {
  const n = note.toLowerCase()
  return n.includes('ex') || n.includes('excl') || n.includes('+ gst') || n.includes('+gst')
}

function computeTotals(rows: OutcomeQuoteRow[], addGst: boolean) {
  const subtotal = toMoney(rows.reduce((s, r) => s + Math.max(0, Number(r.price || 0)), 0))
  const gst = addGst ? toMoney(subtotal * 0.1) : 0
  return { subtotal, gst, total: toMoney(subtotal + gst) }
}

function blankRow(seed: number): OutcomeQuoteRow {
  return {
    id: `row_${Date.now()}_${seed}`,
    areas: [],
    outcome_title: '',
    outcome_description: '',
    acceptance_criteria: '',
    price: 0,
    status: 'edited',
    included: [],
    excluded: [],
    assumptions: [],
    verification_method: '',
  }
}

function AutoGrow({
  value,
  onChange,
  placeholder,
  rows = 2,
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
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

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  suggested: { bg: 'rgba(59,130,246,0.15)', fg: '#60A5FA' },
  edited:    { bg: 'rgba(250,204,21,0.15)', fg: '#FACC15' },
  approved:  { bg: 'rgba(34,197,94,0.15)',  fg: '#22C55E' },
  rejected:  { bg: 'rgba(248,113,113,0.15)', fg: '#F87171' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.edited
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      padding: '2px 7px',
      borderRadius: 4,
      background: c.bg,
      color: c.fg,
    }}>
      {status}
    </span>
  )
}

const SECTION: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  marginBottom: 10,
}

export default function QuoteCaptureTab({ job, documents: _docs, onJobUpdate, onGoToScope: _scope }: Props) {
  const ad = job.assessment_data
  const existing = ad?.outcome_quote_capture
  const addGst = shouldAddGst(ad?.target_price_note ?? '')

  const [instruction, setInstruction] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState('')

  const DEFAULT_LIABILITY = 'Liability is limited to the value of services quoted. The service provider accepts no responsibility for pre-existing damage, concealed conditions, or third-party property unless expressly agreed in writing.'
  const DEFAULT_ACCEPTANCE = 'By signing below, the client authorises the above works to commence under the terms and conditions stated in this document.'

  const [rows, setRows] = useState<OutcomeQuoteRow[]>(existing?.rows ?? [])
  const [paymentTerms, setPaymentTerms] = useState(ad?.payment_terms ?? '')
  const [validity, setValidity] = useState(existing?.validity ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [auth, setAuth] = useState<QuoteAuthorisation>(() => {
    const a = existing?.authorisation
    return {
      access_details: a?.access_details ?? '',
      special_conditions: a?.special_conditions ?? '',
      liability_statement: a?.liability_statement ?? DEFAULT_LIABILITY,
      acceptance_statement: a?.acceptance_statement ?? DEFAULT_ACCEPTANCE,
    }
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    const cap = job.assessment_data?.outcome_quote_capture
    setRows(cap?.rows ?? [])
    setPaymentTerms(job.assessment_data?.payment_terms ?? '')
    setValidity(cap?.validity ?? '')
    setNotes(cap?.notes ?? '')
    const a = cap?.authorisation
    setAuth({
      access_details: a?.access_details ?? '',
      special_conditions: a?.special_conditions ?? '',
      liability_statement: a?.liability_statement ?? DEFAULT_LIABILITY,
      acceptance_statement: a?.acceptance_statement ?? DEFAULT_ACCEPTANCE,
    })
    setSaved(false)
    setSaveError('')
  }, [job.id, job.updated_at])

  const totals = useMemo(() => computeTotals(rows, addGst), [rows, addGst])

  function patchRow(id: string, patch: Partial<OutcomeQuoteRow>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch, status: 'edited' } : r)))
    setSaved(false)
    setSaveError('')
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
    setSaved(false)
    setSaveError('')
  }

  function patchAuth(patch: Partial<QuoteAuthorisation>) {
    setAuth(prev => ({ ...prev, ...patch }))
    setSaved(false)
    setSaveError('')
  }

  async function suggest() {
    setSuggesting(true)
    setSuggestError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-outcomes/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      const data = (await res.json()) as { rows?: OutcomeQuoteRow[]; error?: string }
      if (!res.ok || !data.rows?.length) {
        setSuggestError(data.error ?? 'No outcomes returned')
        return
      }
      setRows(data.rows)
      setSaved(false)
      setSaveError('')
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Suggest failed')
    } finally {
      setSuggesting(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const merged = { ...(ad ?? {}) } as Record<string, unknown>
      merged.payment_terms = paymentTerms
      merged.outcome_quote_capture = {
        mode: 'outcomes',
        rows,
        totals: computeTotals(rows, addGst),
        target_pricing: {},
        validity,
        notes,
        authorisation: auth,
        last_reviewed_at: new Date().toISOString(),
      } satisfies OutcomeQuoteCapture
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) {
        setSaveError(data.error ?? `Save failed (${res.status})`)
        return
      }
      onJobUpdate(data.job)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, paddingBottom: 40 }}>

      {/* ── AI instruction ── */}
      <div style={SECTION}>Instruct</div>

      <div className="field" style={{ marginBottom: 6 }}>
        <AutoGrow
          value={instruction}
          onChange={setInstruction}
          placeholder="Tell the AI how to structure the quote — e.g. &quot;Two phases: Phase A carpet removal and assessment, Phase B full decon if seepage confirmed. Emergency rate.&quot;"
          rows={2}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={suggest}
          disabled={suggesting}
          style={{ fontSize: 13, padding: '8px 18px', touchAction: 'manipulation' }}
        >
          {suggesting ? 'Thinking…' : 'Suggest outcomes'}
        </button>
        {suggesting && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Reading job data and generating…
          </span>
        )}
      </div>

      {suggestError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12, lineHeight: 1.45 }} role="alert">
          {suggestError}
        </div>
      )}

      {/* ── Outcome rows ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={SECTION}>Outcomes</div>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => { setRows([]); setSaved(false); setSaveError('') }}
            style={{
              fontSize: 11,
              color: '#F87171',
              background: 'none',
              border: '1px solid #F87171',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '3px 10px',
              marginBottom: 10,
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          No outcomes yet — use Suggest or add one manually.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
        {rows.map((row, idx) => (
          <div
            key={row.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 12,
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>Outcome {idx + 1}</strong>
                <StatusBadge status={row.status} />
              </div>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                style={{
                  fontSize: 12,
                  color: '#F87171',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                Remove
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Objective</label>
                <AutoGrow
                  value={row.outcome_title}
                  onChange={v => patchRow(row.id, { outcome_title: v })}
                  placeholder="What result does this deliver?"
                  rows={1}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Areas</label>
                <AutoGrow
                  value={row.areas.join(', ')}
                  onChange={v => patchRow(row.id, { areas: v.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="Rooms (comma separated)"
                  rows={1}
                />
              </div>
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label>Description</label>
              <AutoGrow
                value={row.outcome_description}
                onChange={v => patchRow(row.id, { outcome_description: v })}
                placeholder="What work is included in this outcome?"
                rows={2}
              />
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label>Price ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.price || ''}
                onChange={e => patchRow(row.id, { price: Math.max(0, Number(e.target.value || 0)) })}
                placeholder="0.00"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Included</label>
                <AutoGrow
                  value={(row.included ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { included: v.split('\n').filter(l => l.trim()) })}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Excluded</label>
                <AutoGrow
                  value={(row.excluded ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { excluded: v.split('\n').filter(l => l.trim()) })}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Assumptions</label>
                <AutoGrow
                  value={(row.assumptions ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { assumptions: v.split('\n').filter(l => l.trim()) })}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn btn-secondary"
        style={{ fontSize: 13, marginBottom: 20 }}
        onClick={() => setRows(prev => [...prev, blankRow(prev.length + 1)])}
      >
        + Add outcome
      </button>

      {/* ── Totals ── */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          marginBottom: 20,
          fontSize: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: 'var(--text-muted)' }}>Subtotal</span>
          <strong>${totals.subtotal.toFixed(2)}</strong>
        </div>
        {totals.gst > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>GST (10%)</span>
              <span>${totals.gst.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
              <strong>Total (inc. GST)</strong>
              <strong>${totals.total.toFixed(2)}</strong>
            </div>
          </>
        )}
      </div>

      {/* ── Quote-level fields ── */}
      <div style={SECTION}>Terms</div>

      <div className="field">
        <label>Payment terms</label>
        <AutoGrow
          value={paymentTerms}
          onChange={v => { setPaymentTerms(v); setSaved(false); setSaveError('') }}
          placeholder="e.g. 50% deposit to confirm booking, balance on completion net 7 days"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Quote validity</label>
        <AutoGrow
          value={validity}
          onChange={v => { setValidity(v); setSaved(false); setSaveError('') }}
          placeholder="e.g. Valid for 30 days from date of issue"
          rows={1}
        />
      </div>

      <div className="field">
        <label>Notes</label>
        <AutoGrow
          value={notes}
          onChange={v => { setNotes(v); setSaved(false); setSaveError('') }}
          placeholder="Job-specific conditions, caveats, or clarifications"
          rows={2}
        />
      </div>

      {/* ── Authorisation ── */}
      <div style={SECTION}>Authorisation</div>

      <div className="field">
        <label>Access details</label>
        <AutoGrow
          value={auth.access_details}
          onChange={v => patchAuth({ access_details: v })}
          placeholder="How and when can the technician access the site? e.g. key from agent, meet on site 7am"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Special conditions</label>
        <AutoGrow
          value={auth.special_conditions}
          onChange={v => patchAuth({ special_conditions: v })}
          placeholder="Client-specific constraints — e.g. no work before 8am, pets on site, insurance requirements"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Liability statement</label>
        <AutoGrow
          value={auth.liability_statement}
          onChange={v => patchAuth({ liability_statement: v })}
          placeholder="Liability limitation clause"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Acceptance statement</label>
        <AutoGrow
          value={auth.acceptance_statement}
          onChange={v => patchAuth({ acceptance_statement: v })}
          placeholder="Client authorisation wording for signature"
          rows={2}
        />
      </div>

      {/* ── Save ── */}
      {saveError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 10, lineHeight: 1.45 }} role="alert">
          {saveError}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{ width: '100%', padding: 14, fontSize: 15, touchAction: 'manipulation' }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Quote'}
      </button>
    </div>
  )
}
