'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import { formatLongDate } from '@/lib/paymentOverdue'
import {
  normalizeStatementCapture,
  statementInvoicesNote,
  statementQuotes,
  breakdownTotal,
  statementV2Figures,
  statementV2Adjustments,
  statementV2Invoices,
  statementV2InvoicesTotal,
  statementV2Rows,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'
import type { XeroDepositResult, XeroInvoicePaid } from '@/lib/xero/payments'
import type { StatementDocResult } from '@/lib/xero/statementDocs'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 44,
  fontSize: 16,
  padding: '10px 12px',
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

const XERO_VIEW = {
  invoice2: (id: string) => `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(id)}`,
  credit_note: (id: string) => `https://go.xero.com/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${encodeURIComponent(id)}`,
}

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
    && a.credit_note_number === b.credit_note_number
    && a.charges_gst === b.charges_gst
    && a.invoice1_paid_in_full === b.invoice1_paid_in_full
    && [...a.ignored_quotes].sort().join() === [...b.ignored_quotes].sort().join()
}

const APPROVED = new Set(['AUTHORISED', 'PAID'])

/**
 * What the Xero button does next for this statement: its label and the help
 * under it. `invoice1Linked` is whether invoice 1 was raised from the job.
 */
function xeroRaiseAction(
  needs: { invoice2: boolean; credit: boolean },
  capture: StatementOfAccountsCapture,
  invoice1Linked: boolean,
): { label: string; help: string } {
  const stale = [
    !needs.invoice2 && capture.xero_invoice2_id
      ? `The statement no longer needs ${`invoice 2 ${capture.invoice2_number}`.trim()}: ${APPROVED.has(capture.xero_invoice2_status) ? 'credit it in Xero if that is right' : 'delete the draft in Xero'}.`
      : '',
    !needs.credit && capture.xero_credit_note_id
      ? `The statement no longer needs ${`credit note ${capture.credit_note_number}`.trim()}: ${APPROVED.has(capture.xero_credit_note_status) ? 'check it in Xero' : 'delete the draft in Xero'}.`
      : '',
  ].filter(Boolean)
  const help = (...parts: string[]) => [...parts, ...stale].filter(Boolean).join(' ')

  if (needs.credit) {
    const status = capture.xero_credit_note_status
    const exists = Boolean(capture.xero_credit_note_id) && status !== 'VOIDED' && status !== 'DELETED'
    if (capture.credit_note_applied) {
      return { label: 'Update from the statement in Xero', help: help('The credit note has been applied to invoice 1 in Xero.') }
    }
    const typed = capture.invoice_number.trim()
    const canApply = invoice1Linked || Boolean(typed)
    const apply = capture.invoice1_paid_in_full
      ? 'Invoice 1 was paid in full, so once the credit note is approved the credit is the client\'s: refund it or keep it as credit in Xero, then press again.'
      : invoice1Linked
        ? "Once it is approved, press again: it is applied to invoice 1, and invoice 1's pay button then asks for the reduced amount."
        : typed
          ? `Invoice 1 was not raised from this job. Once the credit note is approved, pressing again applies it to invoice ${typed} (typed under Invoices) if Xero has it for the same contact; if not, allocate it to invoice 1 by hand in Xero and press again.`
          : "Invoice 1 was not raised from this job, so the credit note cannot be applied automatically. Once it is approved, allocate it to invoice 1 by hand in Xero, then press again so the statement shows invoice 1's reduced amount. Or type invoice 1's number under Invoices and the button applies it."
    const save = "Then save the statement as a document again, so the client's copy has invoice 1's pay button."
    if (!exists) {
      return {
        label: 'Create credit note in Xero (draft)',
        help: help('The job came in under the estimate, so this creates only a credit note for the difference, as a draft; there is no invoice 2. Check and approve it in Xero.', apply, save),
      }
    }
    if (!APPROVED.has(status)) {
      return { label: 'Update the draft credit note in Xero', help: help('Updates the draft credit note from the statement. Check and approve it in Xero.', apply, save) }
    }
    return {
      label: canApply && !capture.invoice1_paid_in_full ? 'Apply the credit note to invoice 1 in Xero' : 'Check the credit note in Xero',
      help: help(apply, save),
    }
  }

  if (needs.invoice2) {
    const status = capture.xero_invoice2_status
    const exists = Boolean(capture.xero_invoice2_id) && status !== 'VOIDED' && status !== 'DELETED'
    const save = "Then save the statement as a document again, so the client's copy has the pay buttons."
    if (!exists) {
      return {
        label: 'Create invoice 2 in Xero (draft)',
        help: help('The job came in over the estimate, so this creates invoice 2 for the extra, as a draft. Check and approve it in Xero, then press again to add its pay link.', save),
      }
    }
    if (!APPROVED.has(status)) {
      return { label: 'Update the draft invoice 2 in Xero', help: help('Updates the draft invoice 2 from the statement. Once it is approved in Xero, press again to add its pay link.', save) }
    }
    if (!capture.invoice2_url) return { label: "Add invoice 2's pay link", help: help('Invoice 2 is approved in Xero: press to add its pay link.', save) }
    return { label: 'Update from the statement in Xero', help: help('Invoice 2 is approved in Xero and its pay link is on the statement.') }
  }

  return { label: 'Update from the statement in Xero', help: help('The job came in at the estimate, so it needs no invoice 2 or credit note.') }
}

function signedAud(n: number): string {
  return n < -0.004 ? `(${formatAud(-n)})` : formatAud(n)
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
  const [xeroConnected, setXeroConnected] = useState(false)
  const [invoice1Linked, setInvoice1Linked] = useState(false)
  const [raising, setRaising] = useState(false)
  const [raiseNotes, setRaiseNotes] = useState<string[]>([])
  const [raiseError, setRaiseError] = useState('')
  const [showOptions, setShowOptions] = useState(
    () => !saved.charges_gst || saved.ignored_quotes.length > 0 || saved.invoice1_paid_in_full || saved.manual_adjustment != null,
  )
  const [showManualInvoices, setShowManualInvoices] = useState(false)
  const loadedJobIdRef = useRef(job.id)
  const captureRef = useRef(capture)
  captureRef.current = capture
  const savingRef = useRef(false)
  const skipSyncForUpdatedAtRef = useRef<string | null>(null)

  const isDirty = !capturesEqual(capture, saved)
  useRegisterUnsavedChanges('statement-of-accounts', isDirty)
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty

  useEffect(() => {
    if (job.id !== loadedJobIdRef.current) {
      loadedJobIdRef.current = job.id
      skipSyncForUpdatedAtRef.current = null
      setCapture(saved)
      return
    }
    if (skipSyncForUpdatedAtRef.current === job.updated_at) {
      skipSyncForUpdatedAtRef.current = null
      return
    }
    if (dirtyRef.current || savingRef.current) return
    setCapture(saved)
  }, [job.id, job.updated_at, saved])

  useEffect(() => {
    let live = true
    fetch(`/api/jobs/${job.id}/xero-deposit`)
      .then(res => (res.ok ? res.json() as Promise<XeroDepositResult> : null))
      .then(result => {
        if (!live || !result?.connected) return
        setXeroConnected(true)
        setInvoice1Linked(result.linked)
        if (!result.invoice) return
        const paid = result.invoice
        setXeroPaid(paid)
        setCapture(prev => prev.deposit_amount == null
          ? { ...prev, deposit_amount: paid.amount_paid, deposit_date: prev.deposit_date || paid.paid_on || '' }
          : prev)
      })
      .catch(() => {})
    return () => { live = false }
  }, [job.id])

  // Auto-save edits shortly after typing stops (prevents lost work on iPad/tablet)
  useEffect(() => {
    if (!isDirty || saving) return
    const timer = setTimeout(() => {
      void save()
    }, 750)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, saving, capture])

  const figures = useMemo(
    () => statementV2Figures(job.assessment_data, capture),
    [job.assessment_data, capture],
  )
  const quotes = useMemo(() => statementQuotes(job.assessment_data), [job.assessment_data])
  const rows = useMemo(() => statementV2Rows(figures), [figures])
  const invoices = useMemo(() => statementV2Invoices(figures), [figures])
  const xeroDiffers = xeroPaid != null
    && (capture.deposit_amount !== xeroPaid.amount_paid || (xeroPaid.paid_on != null && capture.deposit_date !== xeroPaid.paid_on))

  function patch(next: Partial<StatementOfAccountsCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
    setSavedFlash(false)
  }

  async function save(): Promise<boolean> {
    if (savingRef.current) return false
    const snapshot = captureRef.current
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const snapFigures = statementV2Figures(job.assessment_data, snapshot)
      const next = { ...snapshot, deposit_taken: snapFigures.deposit > 0.004 }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: { ...merged, statement_of_accounts: next } }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      skipSyncForUpdatedAtRef.current = data.job.updated_at
      onJobUpdate(data.job)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      savingRef.current = false
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

  async function raiseInXero() {
    setRaiseError('')
    setRaiseNotes([])
    if (figures.problems.length > 0) {
      setRaiseError(figures.problems[0])
      return
    }
    if (isDirty && !(await save())) return
    setRaising(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/statement-xero`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { job?: Job | null; results?: StatementDocResult[]; error?: string }
      if (data.job) onJobUpdate(data.job)
      setRaiseNotes((data.results ?? []).map(result => result.note))
      if (!res.ok) setRaiseError(data.error || `Xero failed (${res.status})`)
    } catch (e) {
      setRaiseError(e instanceof Error ? e.message : 'Xero failed')
    } finally {
      setRaising(false)
    }
  }

  const invoicesTotal = statementV2InvoicesTotal(invoices)
  const split = statementV2Adjustments(figures)
  const needsXeroDoc = Boolean(split.invoice2 || split.credit_note)
  const raiseAction = xeroRaiseAction({ invoice2: Boolean(split.invoice2), credit: Boolean(split.credit_note) }, capture, invoice1Linked)
  const xeroDrafts = [
    ...(capture.xero_invoice2_id ? [{ kind: 'invoice2' as const, id: capture.xero_invoice2_id, label: `Invoice 2 ${capture.invoice2_number}`.trim(), status: capture.xero_invoice2_status }] : []),
    ...(capture.xero_credit_note_id ? [{ kind: 'credit_note' as const, id: capture.xero_credit_note_id, label: `Credit note ${capture.credit_note_number}`.trim(), status: capture.xero_credit_note_status }] : []),
  ]
  const raiseLabel = raising ? 'Working with Xero…' : raiseAction.label

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
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 12px' }}>{statementInvoicesNote(figures)}</p>
          {invoices.map(invoice => (
            <div key={invoice.heading} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 700 }}>
                <span>{invoice.heading}</span>
                <span>{invoice.amountLabel} {formatAud(invoice.amountShown)}</span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>{invoice.detail}</div>
              {invoice.payNote && <div style={{ color: '#FBBF24', fontSize: 13, marginTop: 4 }}>{invoice.payNote}</div>}
              {invoice.breakdown.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                        <th style={{ textAlign: 'left', fontWeight: 600, padding: '4px 6px 4px 0' }}>Quote</th>
                        <th style={{ fontWeight: 600, padding: 4 }}>Actual</th>
                        <th style={{ fontWeight: 600, padding: 4 }}>Estimate</th>
                        <th style={{ fontWeight: 600, padding: 4 }}>Ex GST</th>
                        <th style={{ fontWeight: 600, padding: 4 }}>GST</th>
                        <th style={{ fontWeight: 600, padding: '4px 0 4px 4px' }}>Inc GST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...invoice.breakdown, breakdownTotal(invoice)].map((row, index, all) => (
                        <tr key={`${row.label}-${index}`} style={{ textAlign: 'right', borderTop: '1px solid var(--border)', fontWeight: index === all.length - 1 ? 700 : 400 }}>
                          <td style={{ textAlign: 'left', padding: '4px 6px 4px 0' }}>{row.label}</td>
                          <td style={{ padding: 4 }}>{row.actual_ex == null ? '' : formatAud(row.actual_ex)}</td>
                          <td style={{ padding: 4 }}>{row.estimate_ex == null ? '' : formatAud(row.estimate_ex)}</td>
                          <td style={{ padding: 4 }}>{signedAud(row.difference_ex)}</td>
                          <td style={{ padding: 4 }}>{signedAud(row.gst)}</td>
                          <td style={{ padding: '4px 0 4px 4px' }}>{signedAud(row.difference_inc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {invoicesTotal && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800 }}>
              <span>{invoicesTotal.label}</span>
              <span>{formatAud(invoicesTotal.amount)}</span>
            </div>
          )}
          {xeroConnected && (needsXeroDoc || xeroDrafts.length > 0) && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button type="button" className="btn btn-primary" disabled={raising || saving} onClick={() => void raiseInXero()} style={{ padding: '10px 14px', fontWeight: 700 }}>
                {raiseLabel}
              </button>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {raiseAction.help}
              </div>
              {xeroDrafts.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
                  {xeroDrafts.map(draft => (
                    <a key={draft.kind} href={XERO_VIEW[draft.kind](draft.id)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                      Open {draft.label} in Xero{draft.status ? ` (${draft.status.toLowerCase()})` : ''}
                    </a>
                  ))}
                </div>
              )}
              {raiseNotes.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {raiseNotes.map(note => <li key={note}>{note}</li>)}
                </ul>
              )}
              {raiseError && <div style={{ color: '#F87171', fontSize: 13, marginTop: 8 }} role="alert">{raiseError}</div>}
            </div>
          )}
        </section>
      )}

      {/* Deposit — primary editable section */}
      <section style={CARD}>
        <div style={HEADING}>{capture.invoice1_paid_in_full ? 'Invoice 1 paid' : 'Deposit'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={LABEL}>{capture.invoice1_paid_in_full ? 'Invoice 1 paid' : 'Deposit paid'} ($, {amountsNote})</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={capture.invoice1_paid_in_full ? figures.deposit : capture.deposit_amount ?? ''}
              onChange={e => patch({ deposit_amount: numberInput(e.target.value) })}
              disabled={capture.invoice1_paid_in_full}
              placeholder="0.00"
              style={capture.invoice1_paid_in_full ? { ...INPUT, opacity: 0.7 } : INPUT}
            />
            {capture.invoice1_paid_in_full && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>The whole estimate.</div>
            )}
            {figures.suggested_deposit != null && capture.deposit_amount !== figures.suggested_deposit && (
              <button type="button" onClick={() => patch({ deposit_amount: figures.suggested_deposit })} style={HINT}>
                Suggested: half the quotes, {formatAud(figures.suggested_deposit)}
              </button>
            )}
          </div>
          <div>
            <label style={LABEL}>{capture.invoice1_paid_in_full ? 'Date paid' : 'Deposit date'}</label>
            <input type="date" value={capture.deposit_date} onChange={e => patch({ deposit_date: e.target.value })} style={INPUT} />
          </div>
        </div>
        {xeroPaid && xeroDiffers && !capture.invoice1_paid_in_full && (
          <button
            type="button"
            onClick={() => patch({ deposit_amount: xeroPaid.amount_paid, deposit_date: xeroPaid.paid_on ?? capture.deposit_date })}
            style={{ ...HINT, marginTop: 10, textAlign: 'left', display: 'block' }}
          >
            Xero shows {formatAud(xeroPaid.amount_paid)} paid{xeroPaid.paid_on ? ` on ${formatLongDate(xeroPaid.paid_on)}` : ''}{xeroPaid.invoice_number ? ` (${xeroPaid.invoice_number})` : ''}. Use it
          </button>
        )}
      </section>

      {/* Collapsible Adjustments & options (GST, excluded quotes, paid in full, manual adjustment) */}
      <section style={CARD}>
        <button
          type="button"
          onClick={() => setShowOptions(s => !s)}
          aria-expanded={showOptions}
          style={{
            width: '100%',
            minHeight: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>
            {showOptions ? '▾ Adjustments & options' : '▸ Adjustments & options'}
            {!showOptions && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                {[
                  capture.charges_gst ? 'GST on' : 'No GST',
                  capture.invoice1_paid_in_full ? 'Paid in full' : null,
                  capture.ignored_quotes.length > 0 ? `${capture.ignored_quotes.length} quote excluded` : null,
                  capture.manual_adjustment != null ? `Adj ${signedAud(capture.manual_adjustment)}` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
        </button>

        {showOptions && (
          <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700, minHeight: 36, cursor: 'pointer' }}>
              <input type="checkbox" checked={capture.charges_gst} onChange={e => patch({ charges_gst: e.target.checked })} style={{ width: 18, height: 18 }} />
              This job charges GST
            </label>

            {quotes.length > 0 && (
              <div>
                <div style={LABEL}>Exclude quotes from statement</div>
                {quotes.map(quote => (
                  <label key={quote.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, marginBottom: 6, minHeight: 36, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={capture.ignored_quotes.includes(quote.key)}
                      onChange={e => patch({
                        ignored_quotes: e.target.checked
                          ? [...capture.ignored_quotes, quote.key]
                          : capture.ignored_quotes.filter(k => k !== quote.key),
                      })}
                      style={{ width: 18, height: 18 }}
                    />
                    Leave out {quote.label}, {formatAud(quote.amount_ex)} ex GST
                  </label>
                ))}
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700, minHeight: 36, cursor: 'pointer' }}>
              <input type="checkbox" checked={capture.invoice1_paid_in_full} onChange={e => patch({ invoice1_paid_in_full: e.target.checked })} style={{ width: 18, height: 18 }} />
              Invoice 1 (the estimate) was paid in full up front
            </label>

            <div>
              <label style={LABEL}>Manual adjustment ($, {amountsNote}, optional)</label>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                A negative amount reduces the balance. The reason is printed with it.
              </div>
              <input
                type="number"
                inputMode="decimal"
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
        )}
      </section>

      {/* Collapsible Manual Xero invoice numbers & links (auto-filled by Xero button above) */}
      <section style={CARD}>
        <button
          type="button"
          onClick={() => setShowManualInvoices(s => !s)}
          aria-expanded={showManualInvoices || !xeroConnected}
          style={{
            width: '100%',
            minHeight: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>
            {(showManualInvoices || !xeroConnected) ? '▾ Manual Xero invoice numbers & links' : '▸ Manual Xero invoice numbers & links (auto-filled by Xero)'}
            {!(showManualInvoices || !xeroConnected) && (capture.invoice_number || capture.invoice2_number || capture.credit_note_number) && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                {[capture.invoice_number, capture.invoice2_number, capture.credit_note_number].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
        </button>

        {(showManualInvoices || !xeroConnected) && (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label style={LABEL}>Invoice 1 number (estimate)</label>
                <input type="text" value={capture.invoice_number} onChange={e => patch({ invoice_number: e.target.value })} placeholder="INV-1001" style={INPUT} />
              </div>
              <div>
                <label style={LABEL}>Invoice 1 payment link</label>
                <input type="url" value={capture.invoice_url} onChange={e => patch({ invoice_url: e.target.value })} placeholder="https://" style={INPUT} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label style={LABEL}>Invoice 2 or credit note number</label>
                <input type="text" value={capture.invoice2_number} onChange={e => patch({ invoice2_number: e.target.value })} placeholder="INV-1002" style={INPUT} />
              </div>
              <div>
                <label style={LABEL}>Invoice 2 payment link</label>
                <input type="url" value={capture.invoice2_url} onChange={e => patch({ invoice2_url: e.target.value })} placeholder="https://" style={INPUT} />
              </div>
            </div>
            <div>
              <label style={LABEL}>Credit note number</label>
              <input type="text" value={capture.credit_note_number} onChange={e => patch({ credit_note_number: e.target.value })} placeholder="CN-0001" style={INPUT} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              The Xero button above fills these in. Type them only for an invoice or credit note made in Xero by hand.
            </div>
          </div>
        )}
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: saving ? 'var(--text-muted)' : savedFlash || !isDirty ? '#10B981' : 'var(--text-muted)', minWidth: 74 }}>
              {saving ? 'Saving…' : isDirty ? 'Unsaved…' : 'Saved ✓'}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void saveAndCompose()}
              style={{ flex: '1 1 200px', minHeight: 44, padding: '0 16px', fontWeight: 700, fontSize: 14 }}
            >
              Save as document
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
