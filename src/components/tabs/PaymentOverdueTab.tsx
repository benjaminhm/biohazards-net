'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import { normalizeStatementCapture, statementFigures } from '@/lib/statementOfAccounts'
import {
  formatLongDate,
  normalizePaymentOverdueCapture,
  overdueInvoiceOptions,
  payerSourceHint,
  paymentReminderResult,
  resolveContractedPayer,
  todayIso,
  daysBetween,
  parseIsoDate,
  type AccountPayer,
  type PaymentOverdueCapture,
} from '@/lib/paymentOverdue'

interface Props {
  job: Job
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
  boxSizing: 'border-box',
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

function capturesEqual(a: PaymentOverdueCapture, b: PaymentOverdueCapture): boolean {
  return (Object.keys(a) as (keyof PaymentOverdueCapture)[]).every(key => a[key] === b[key])
}

function seededCapture(job: Job, account: AccountPayer | null): PaymentOverdueCapture {
  const saved = normalizePaymentOverdueCapture(job.assessment_data?.payment_overdue)
  if (saved.payer_name) return saved
  const payer = resolveContractedPayer(job, account)
  return {
    ...saved,
    payer_name: payer.name,
    payer_address: payer.address,
    payer_abn: payer.abn,
  }
}

export default function PaymentOverdueTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const [account, setAccount] = useState<AccountPayer | null>(null)
  const baseline = useMemo(() => seededCapture(job, account), [job, account])
  const [capture, setCapture] = useState<PaymentOverdueCapture>(baseline)
  const baselineRef = useRef(baseline)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    const id = job.client_account_id
    if (!id) {
      setAccount(null)
      return
    }
    let cancelled = false
    fetch(`/api/accounts/${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        const row = data?.account
        setAccount(row
          ? {
              legal_name: typeof row.legal_name === 'string' ? row.legal_name : '',
              billing_address: typeof row.billing_address === 'string' ? row.billing_address : '',
              abn: typeof row.abn === 'string' ? row.abn : '',
            }
          : null)
      })
      .catch(() => {
        if (!cancelled) setAccount(null)
      })
    return () => { cancelled = true }
  }, [job.client_account_id])

  useEffect(() => {
    setCapture(prev => (capturesEqual(prev, baselineRef.current) ? baseline : prev))
    baselineRef.current = baseline
  }, [baseline])

  const isDirty = !capturesEqual(capture, baseline)
  useRegisterUnsavedChanges('payment-overdue', isDirty)

  const statement = useMemo(
    () => normalizeStatementCapture(job.assessment_data?.statement_of_accounts),
    [job.assessment_data?.statement_of_accounts],
  )
  const figures = useMemo(() => statementFigures(statement), [statement])
  const options = useMemo(() => overdueInvoiceOptions(statement), [statement])
  const letterDate = capture.letter_date || todayIso()
  const result = useMemo(
    () => paymentReminderResult(job.site_address || '', { ...capture, letter_date: letterDate }, statement, letterDate),
    [capture, job.site_address, letterDate, statement],
  )
  const seed = useMemo(() => resolveContractedPayer(job, account), [job, account])
  const matchesSeed = capture.payer_name.trim() === seed.name.trim() && capture.payer_address.trim() === seed.address.trim()

  function patch(next: Partial<PaymentOverdueCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
    setSavedFlash(false)
    setSaveError('')
  }

  async function save(next = capture): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_data: { ...merged, payment_overdue: next },
        }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      onJobUpdate(data.job)
      setCapture(normalizePaymentOverdueCapture(data.job.assessment_data?.payment_overdue))
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      return true
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function generate() {
    const next = { ...capture, letter_date: letterDate }
    const checked = paymentReminderResult(job.site_address || '', next, statement, letterDate)
    if (!checked.ok) {
      setSaveError(checked.issues[0])
      return
    }
    const ok = await save(next)
    if (ok) router.push(`/jobs/${job.id}/docs/payment_reminder?compose=1`)
  }

  const chargesGst = figures.gst_mode !== 'no_gst'

  return (
    <div style={{ paddingBottom: 120 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Payment Overdue</h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 0 }}>
        The invoices and amounts come from the Statement of Accounts. Mark which of them is late.
        The late amount is that invoice’s remaining balance. The 14, 21, and 28 day dates start on the letter date.
      </p>

      <section style={cardStyle}>
        <div style={headingStyle}>Statement of Accounts</div>
        {statement.invoice1_amount == null && statement.invoice2_amount == null ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Enter the invoices on Statement of Accounts first.</p>
        ) : (
          figures.lines.map((line, index) => (
            <div
              key={`${line.label}-${index}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 8,
                fontWeight: line.strong ? 700 : 400,
              }}
            >
              <span>{line.label}</span>
              <span>{formatAud(chargesGst ? line.inc : line.ex)}</span>
            </div>
          ))
        )}
      </section>

      <section style={cardStyle}>
        <div style={headingStyle}>Contracted payer</div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
          {payerSourceHint(seed.source, matchesSeed)}
        </p>
        <label style={LABEL}>Name</label>
        <input style={{ ...INPUT, marginBottom: 12 }} value={capture.payer_name} onChange={e => patch({ payer_name: e.target.value })} />
        <label style={LABEL}>Address for the letter of demand</label>
        <textarea style={{ ...INPUT, marginBottom: 12, minHeight: 72 }} value={capture.payer_address} onChange={e => patch({ payer_address: e.target.value })} />
        <label style={LABEL}>ABN</label>
        <input style={INPUT} value={capture.payer_abn} onChange={e => patch({ payer_abn: e.target.value })} />
      </section>

      <section style={cardStyle}>
        <div style={headingStyle}>Personal guarantor</div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
          Leave this blank when nobody personally guaranteed payment. A guarantor is not the person who books the job.
        </p>
        <label style={LABEL}>Name</label>
        <input style={{ ...INPUT, marginBottom: 12 }} value={capture.guarantor_name} onChange={e => patch({ guarantor_name: e.target.value })} />
        <label style={LABEL}>Their address</label>
        <textarea style={{ ...INPUT, marginBottom: 12, minHeight: 72 }} value={capture.guarantor_address} onChange={e => patch({ guarantor_address: e.target.value })} />
        <label style={LABEL}>Guarantee reference</label>
        <input style={INPUT} value={capture.guarantee_reference} onChange={e => patch({ guarantee_reference: e.target.value })} placeholder="Engagement dated …" />
      </section>

      <section style={cardStyle}>
        <div style={headingStyle}>Which invoice is late</div>
        {options.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>No invoice on the statement has a balance outstanding.</p>
        ) : options.map(option => {
          const late = option.key === 'invoice1' ? capture.invoice1_late : capture.invoice2_late
          const submitted = option.key === 'invoice1' ? capture.invoice1_submitted : capture.invoice2_submitted
          const due = option.key === 'invoice1' ? capture.invoice1_due : capture.invoice2_due
          const days = parseIsoDate(due) && parseIsoDate(letterDate) ? daysBetween(due, letterDate) : null
          return (
            <div key={option.key} style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={late}
                  onChange={e => patch(option.key === 'invoice1' ? { invoice1_late: e.target.checked } : { invoice2_late: e.target.checked })}
                />
                <span>{option.label} is late — {formatAud(option.remainingInc)} outstanding</span>
              </label>
              {late && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 10 }}>
                  <div>
                    <label style={LABEL}>Submitted</label>
                    <input
                      type="date"
                      style={INPUT}
                      value={submitted}
                      onChange={e => patch(option.key === 'invoice1' ? { invoice1_submitted: e.target.value } : { invoice2_submitted: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>Agreed due date</label>
                    <input
                      type="date"
                      style={INPUT}
                      value={due}
                      onChange={e => patch(option.key === 'invoice1' ? { invoice1_due: e.target.value } : { invoice2_due: e.target.value })}
                    />
                  </div>
                  {days != null && days > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--text-muted)' }}>
                      {days === 1 ? '1 day' : `${days} days`} late on the letter date.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {(['invoice1', 'invoice2'] as const).filter(key => (
          (key === 'invoice1' ? capture.invoice1_late : capture.invoice2_late)
          && !options.some(option => option.key === key)
        )).map(key => (
          <p key={key} style={{ margin: '0 0 8px', fontSize: 14 }}>
            {key === 'invoice1' ? 'Invoice 1' : 'Invoice 2'} is marked late, and the statement no longer has a balance on it.{' '}
            <button
              type="button"
              onClick={() => patch(key === 'invoice1' ? { invoice1_late: false } : { invoice2_late: false })}
              style={{ background: 'none', border: 'none', color: 'var(--blue)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >
              Clear it
            </button>
          </p>
        ))}
      </section>

      <section style={cardStyle}>
        <div style={headingStyle}>Timeline</div>
        <label style={LABEL}>Letter date</label>
        <input
          type="date"
          style={{ ...INPUT, maxWidth: 220, marginBottom: 12 }}
          value={letterDate}
          onChange={e => patch({ letter_date: e.target.value })}
        />
        {result.ok ? (
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>
            <div><strong>{formatLongDate(result.draft.payBy)}</strong> — 14-day reminder. Pay the late balance by this date.</div>
            <div style={{ marginTop: 8 }}><strong>{formatLongDate(result.draft.demandOn)}</strong> — letter of demand to {result.draft.payerName} at {result.draft.payerAddress}.</div>
            {result.draft.guarantor && (
              <div style={{ marginTop: 8 }}>
                <strong>{formatLongDate(result.draft.demandOn)}</strong> — letter of demand also to {result.draft.guarantor.name} at {result.draft.guarantor.address}.
              </div>
            )}
            <div style={{ marginTop: 8 }}><strong>{formatLongDate(result.draft.finalOn)}</strong> — final demand, and legal action commences.</div>
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)', fontSize: 14 }}>
            {result.issues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
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
            <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }} role="alert">{saveError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={saving || !isDirty} onClick={() => void save()} style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}>
              {saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving || !result.ok} onClick={() => void generate()} style={{ flex: '1 1 160px', padding: 12, fontWeight: 700 }}>
              Generate reminder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  marginBottom: 16,
}

const headingStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: 13,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 12,
}
