'use client'

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  documentReference,
  latestDisposalDocument,
  latestQuoteDocument,
  normalizeStatementCapture,
  statementFigures,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'

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

function capturesEqual(a: StatementOfAccountsCapture, b: StatementOfAccountsCapture): boolean {
  return a.deposit_taken === b.deposit_taken
    && a.deposit_amount === b.deposit_amount
    && a.deposit_includes_gst === b.deposit_includes_gst
    && a.original_invoice_number === b.original_invoice_number
    && a.original_invoice_url === b.original_invoice_url
    && a.new_invoice_number === b.new_invoice_number
    && a.new_invoice_url === b.new_invoice_url
    && a.invoice1_adjusted_amount === b.invoice1_adjusted_amount
    && a.invoice1_adjusted_includes_gst === b.invoice1_adjusted_includes_gst
    && a.invoice1_amount === b.invoice1_amount
    && a.invoice2_amount === b.invoice2_amount
    && a.charges_gst === b.charges_gst
}

export default function StatementOfAccountsTab({ job, documents, onJobUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(
    () => normalizeStatementCapture(job.assessment_data?.statement_of_accounts),
    [job.assessment_data?.statement_of_accounts],
  )
  const [capture, setCapture] = useState<StatementOfAccountsCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setCapture(normalizeStatementCapture(job.assessment_data?.statement_of_accounts))
  }, [job.id, job.updated_at])

  const isDirty = !capturesEqual(capture, saved)
  useRegisterUnsavedChanges('statement-of-accounts', isDirty)

  const figures = useMemo(() => statementFigures(capture), [capture])
  const chargesGst = figures.gst_mode !== 'no_gst'
  const quoteReference = documentReference(latestQuoteDocument(documents), '—')

  function patch(next: Partial<StatementOfAccountsCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
    setSavedFlash(false)
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
          assessment_data: { ...merged, statement_of_accounts: next },
        }),
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
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/statement_of_accounts?compose=1`)
  }

  const line = (label: string, before: number, amount: number, strong = false) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: chargesGst ? '1.4fr 1fr 1fr' : '1.4fr 1fr',
        gap: 8,
        marginBottom: 8,
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span>{label}</span>
      {chargesGst && <span style={{ textAlign: 'right' }}>{formatAud(before)}</span>}
      <span style={{ textAlign: 'right' }}>{formatAud(amount)}</span>
    </div>
  )
  const payLink = (url: string) => {
    const href = url.trim()
    if (!/^https?:\/\//i.test(href)) return '—'
    return <a href={href} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{href}</a>
  }

  return (
    <div style={{ maxWidth: 720, paddingBottom: 120 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        Type each amount. After every step the statement shows an overpay or an underpay. The quote and the contents record are named here only. Their dollars are not used.
      </p>

      <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
        <div style={{ marginBottom: 6 }}><strong>Property:</strong> {job.site_address || '—'}</div>
        <div style={{ marginBottom: 6 }}><strong>Quote / estimate:</strong> {quoteReference}</div>
        <div><strong>Contents disposal record:</strong> {documentReference(latestDisposalDocument(documents), '—')}</div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={capture.charges_gst}
          onChange={e => patch({ charges_gst: e.target.checked })}
        />
        Amounts include GST
      </label>

      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL}>Invoice 1 amount ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.invoice1_amount ?? ''}
              onChange={e => {
                const raw = e.target.value
                patch({ invoice1_amount: raw === '' ? null : Number(raw) })
              }}
              placeholder="0.00"
              style={INPUT}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={capture.deposit_taken}
              onChange={e => patch({ deposit_taken: e.target.checked })}
            />
            A deposit was paid
          </label>
          {capture.deposit_taken && (
            <div>
              <label style={LABEL}>Deposit ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={capture.deposit_amount ?? ''}
                onChange={e => {
                  const raw = e.target.value
                  patch({ deposit_amount: raw === '' ? null : Number(raw) })
                }}
                placeholder="0.00"
                style={INPUT}
              />
            </div>
          )}
          <div>
            <label style={LABEL}>Invoice 1 after adjustment ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.invoice1_adjusted_amount ?? ''}
              onChange={e => {
                const raw = e.target.value
                patch({ invoice1_adjusted_amount: raw === '' ? null : Number(raw) })
              }}
              placeholder="Leave blank if invoice 1 has not changed"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>Invoice 2 amount ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={capture.invoice2_amount ?? ''}
              onChange={e => {
                const raw = e.target.value
                patch({ invoice2_amount: raw === '' ? null : Number(raw) })
              }}
              placeholder="Leave blank until the next invoice"
              style={INPUT}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
          Invoices
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL}>Original invoice number</label>
            <input
              type="text"
              value={capture.original_invoice_number}
              onChange={e => patch({ original_invoice_number: e.target.value })}
              placeholder="INV-1001"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>Original invoice link</label>
            <input
              type="url"
              value={capture.original_invoice_url}
              onChange={e => patch({ original_invoice_url: e.target.value })}
              placeholder="https://"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>New invoice number</label>
            <input
              type="text"
              value={capture.new_invoice_number}
              onChange={e => patch({ new_invoice_number: e.target.value })}
              placeholder="INV-1002"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>New invoice link</label>
            <input
              type="url"
              value={capture.new_invoice_url}
              onChange={e => patch({ new_invoice_url: e.target.value })}
              placeholder="https://"
              style={INPUT}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid rgba(148,163,184,0.45)',
          background: 'linear-gradient(165deg, rgba(100,116,139,0.22) 0%, var(--surface) 58%)',
          marginBottom: 18,
          fontSize: 14,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: chargesGst ? '1.4fr 1fr 1fr' : '1.4fr 1fr',
            gap: 8,
            marginBottom: 10,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#E2E8F0',
          }}
        >
          <span>Item</span>
          {chargesGst && <span style={{ textAlign: 'right' }}>Before GST</span>}
          <span style={{ textAlign: 'right' }}>Amount</span>
        </div>
        {figures.lines.map((item, index) => (
          <Fragment key={index}>{line(item.label, item.ex, item.inc, item.strong === true)}</Fragment>
        ))}
        {figures.owing_inc < 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>This balance is a credit.</div>
        )}
      </div>
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          marginBottom: 18,
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
          Make a payment
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          <span>Invoice</span>
          <span style={{ textAlign: 'right' }}>Pay</span>
          <span>Link</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 8, marginBottom: 10, alignItems: 'start' }}>
          <span>Invoice 1{capture.original_invoice_number.trim() ? ` ${capture.original_invoice_number.trim()}` : ''}</span>
          <span style={{ textAlign: 'right' }}>{formatAud(figures.original_owing_inc)}</span>
          <span>{payLink(capture.original_invoice_url)}</span>
        </div>
        {figures.has_invoice2 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.8fr 1.4fr', gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              <span>Invoice</span>
              <span style={{ textAlign: 'right' }}>Before GST</span>
              <span style={{ textAlign: 'right' }}>After GST</span>
              <span>Link</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.8fr 1.4fr', gap: 8, alignItems: 'start' }}>
              <span>Invoice 2{capture.new_invoice_number.trim() ? ` ${capture.new_invoice_number.trim()}` : ''}</span>
              <span style={{ textAlign: 'right' }}>{formatAud(figures.invoice2_owing_ex)}</span>
              <span style={{ textAlign: 'right' }}>{formatAud(figures.invoice2_owing_inc)}</span>
              <span>{payLink(capture.new_invoice_url)}</span>
            </div>
          </>
        )}
      </div>

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
