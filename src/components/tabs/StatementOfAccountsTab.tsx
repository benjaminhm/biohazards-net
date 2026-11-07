'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import { formatLongDate } from '@/lib/paymentOverdue'
import {
  normalizeStatementCapture,
  STATEMENT_INVOICES_NOTE,
  statementV2Figures,
  statementV2Invoices,
  statementV2Rows,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'
import type { XeroDepositResult, XeroInvoicePaid } from '@/lib/xero/payments'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
}

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}

const CARD: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  marginBottom: 16,
}

const HEADING: CSSProperties = { fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }

const HINT: CSSProperties = { marginTop: 6, padding: 0, border: 'none', background: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }

function capturesEqual(a: StatementOfAccountsCapture, b: StatementOfAccountsCapture): boolean {
  return a.deposit_amount === b.deposit_amount
    && a.deposit_date === b.deposit_date
    && a.manual_adjustment === b.manual_adjustment
    && a.manual_adjustment_reason === b.manual_adjustment_reason
    && a.invoice_number === b.invoice_number
    && a.invoice_url === b.invoice_url
    && a.invoice2_number === b.invoice2_number
    && a.invoice2_url === b.invoice2_url
    && a.charges_gst === b.charges_gst
}

function numberInput(raw: string): number | null {
  return raw === '' ? null : Number(raw)
}

export default function StatementOfAccountsTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeStatementCapture(job.assessment_data?.statement_of_accounts),
    [job.assessment_data?.statement_of_accounts],
  )
  const [capture, setCapture] = useState<StatementOfAccountsCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [xeroPaid, setXeroPaid] = useState<XeroInvoicePaid | null>(null)

  useEffect(() => {
    setCapture(saved)
  }, [job.id, job.updated_at, saved])

  useEffect(() => {
    let live = true
    fetch(`/api/jobs/${job.id}/xero-deposit`)
      .then(res => (res.ok ? res.json() as Promise<XeroDepositResult> : null))
      .then(result => {
        if (!live || !result?.connected || !result.invoice) return
        const paid = result.invoice
        setXeroPaid(paid)
        setCapture(prev => prev.deposit_amount == null
          ? { ...prev, deposit_amount: paid.amount_paid, deposit_date: prev.deposit_date || paid.paid_on || '' }
          : prev)
      })
      .catch(() => {})
    return () => { live = false }
  }, [job.id])

  const isDirty = !capturesEqual(capture, saved)
  useRegisterUnsavedChanges('statement-of-accounts', isDirty)

  const figures = useMemo(
    () => statementV2Figures(job.assessment_data, capture),
    [job.assessment_data, capture],
  )
  const rows = useMemo(() => statementV2Rows(figures), [figures])
  const invoices = useMemo(() => statementV2Invoices(figures), [figures])
  const xeroDiffers = xeroPaid != null
    && (capture.deposit_amount !== xeroPaid.amount_paid || (xeroPaid.paid_on != null && capture.deposit_date !== xeroPaid.paid_on))

  function patch(next: Partial<StatementOfAccountsCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
    setSavedFlash(false)
  }

  async function save(): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const next = { ...capture, deposit_taken: (capture.deposit_amount ?? 0) > 0 }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: { ...merged, statement_of_accounts: next } }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      onJobUpdate(data.job)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveAndCompose() {
    if (figures.problems.length > 0) {
      setSaveError(figures.problems[0])
      return
    }
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/statement_of_accounts?compose=1`)
  }

  const amountsNote = capture.charges_gst ? 'Inc GST' : 'No GST'

  return (
    <div style={{ paddingBottom: 120 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        The statement is the House Survey, Contents Disposal Record and Biohazard Cleaning Record totals, less the deposit.
      </p>

      <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
        <div><strong>Property:</strong> {job.site_address || '—'}</div>
      </div>

      {figures.estimates_note && (
        <p style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>{figures.estimates_note}</p>
      )}

      <section style={{ ...CARD, border: '1px solid rgba(148,163,184,0.45)', background: 'linear-gradient(165deg, rgba(100,116,139,0.22) 0%, var(--surface) 58%)', fontSize: 14 }}>
        <div style={HEADING}>Summary</div>
        {rows.map((row, index) => (
          <div key={`${row.label}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontWeight: row.strong ? 700 : 400 }}>
            <span>{row.label}</span>
            <span>{row.amount < 0 ? `(${formatAud(-row.amount)})` : formatAud(row.amount)}</span>
          </div>
        ))}
        {figures.problems.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: '#F87171', fontSize: 13 }}>
            {figures.problems.map(problem => <li key={problem}>{problem}</li>)}
          </ul>
        )}
      </section>

      {invoices.length > 0 && (
        <section style={{ ...CARD, fontSize: 14 }}>
          <div style={HEADING}>How the balance is paid</div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 12px' }}>{STATEMENT_INVOICES_NOTE}</p>
          {invoices.map(invoice => (
            <div key={invoice.heading} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 700 }}>
                <span>{invoice.heading}</span>
                <span>{invoice.amountLabel} {formatAud(Math.abs(invoice.amount))}</span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>{invoice.detail}</div>
            </div>
          ))}
        </section>
      )}

      <section style={CARD}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
          <input type="checkbox" checked={capture.charges_gst} onChange={e => patch({ charges_gst: e.target.checked })} />
          This job charges GST
        </label>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <label style={LABEL}>Deposit paid ($, {amountsNote})</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={capture.deposit_amount ?? ''}
                onChange={e => patch({ deposit_amount: numberInput(e.target.value) })}
                placeholder="0.00"
                style={INPUT}
              />
              {figures.suggested_deposit != null && capture.deposit_amount !== figures.suggested_deposit && (
                <button type="button" onClick={() => patch({ deposit_amount: figures.suggested_deposit })} style={HINT}>
                  Suggested: half the quotes, {formatAud(figures.suggested_deposit)}
                </button>
              )}
            </div>
            <div>
              <label style={LABEL}>Deposit date</label>
              <input type="date" value={capture.deposit_date} onChange={e => patch({ deposit_date: e.target.value })} style={INPUT} />
            </div>
          </div>
          {xeroPaid && xeroDiffers && (
            <button
              type="button"
              onClick={() => patch({ deposit_amount: xeroPaid.amount_paid, deposit_date: xeroPaid.paid_on ?? capture.deposit_date })}
              style={{ ...HINT, marginTop: 0, textAlign: 'left' }}
            >
              Xero shows {formatAud(xeroPaid.amount_paid)} paid{xeroPaid.paid_on ? ` on ${formatLongDate(xeroPaid.paid_on)}` : ''}{xeroPaid.invoice_number ? ` (${xeroPaid.invoice_number})` : ''}. Use it
            </button>
          )}

          <div>
            <label style={LABEL}>Adjustment ($, {amountsNote}, optional)</label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              A negative amount reduces the balance. The reason is printed with it.
            </div>
            <input
              type="number"
              step="0.01"
              value={capture.manual_adjustment ?? ''}
              onChange={e => patch({ manual_adjustment: numberInput(e.target.value) })}
              placeholder="0.00"
              style={INPUT}
            />
            {capture.manual_adjustment != null && (
              <div style={{ marginTop: 10 }}>
                <label style={LABEL}>Reason</label>
                <input
                  type="text"
                  value={capture.manual_adjustment_reason}
                  onChange={e => patch({ manual_adjustment_reason: e.target.value })}
                  placeholder="Required with an adjustment"
                  style={INPUT}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={CARD}>
        <div style={HEADING}>Invoices</div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <label style={LABEL}>Invoice 1 number (estimate)</label>
              <input type="text" value={capture.invoice_number} onChange={e => patch({ invoice_number: e.target.value })} placeholder="INV-1001" style={INPUT} />
            </div>
            <div>
              <label style={LABEL}>Invoice 1 payment link</label>
              <input type="url" value={capture.invoice_url} onChange={e => patch({ invoice_url: e.target.value })} placeholder="https://" style={INPUT} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <label style={LABEL}>Invoice 2 or credit note number</label>
              <input type="text" value={capture.invoice2_number} onChange={e => patch({ invoice2_number: e.target.value })} placeholder="INV-1002" style={INPUT} />
            </div>
            <div>
              <label style={LABEL}>Invoice 2 payment link</label>
              <input type="url" value={capture.invoice2_url} onChange={e => patch({ invoice2_url: e.target.value })} placeholder="https://" style={INPUT} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Create invoice 2 (or a credit note) in Xero for the difference shown above, then enter its number and link here.
          </div>
        </div>
      </section>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 25,
          background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
          padding: '10px 16px max(12px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {saveError && (
            <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }} role="alert">
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !isDirty}
              onClick={() => void save()}
              style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}
            >
              {saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void saveAndCompose()}
              style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}
            >
              Save as document
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
