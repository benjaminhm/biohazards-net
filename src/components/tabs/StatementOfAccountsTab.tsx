'use client'

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, Job } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  normalizeStatementCapture,
  statementFigures,
  statementReferencePanel,
  surveyAreaQuantities,
  type StatementOfAccountsCapture,
  type StatementSurveyArea,
  type StatementReferenceBlock,
  type StatementReferenceLine,
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

function ReferencePanel({
  survey,
  quotes,
  disposal,
}: {
  survey: StatementReferenceBlock
  quotes: StatementReferenceBlock[]
  disposal: StatementReferenceBlock
}) {
  const quoteBlocks = quotes.length > 0
    ? quotes
    : [{
        heading: 'Quote / estimate',
        reference: '',
        detail: '',
        facts: [],
        gst_mode: 'no_gst' as const,
        lines: [],
        empty: 'No quote or estimate yet.',
      }]
  return (
    <section
      aria-label="Pricing reference"
      className="soa-ref-float"
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        marginBottom: 18,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        Reference
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 14px' }}>
        Survey area, quote prices, and contents disposal quantities and fees. These stay in this panel. They are not copied into the amounts below.
      </p>
      <div className="soa-ref-grid">
        <ReferenceBlock block={survey} />
        <div style={{ display: 'grid', gap: 12 }}>
          {quoteBlocks.map((block, index) => (
            <ReferenceBlock key={`${block.heading}-${block.reference}-${index}`} block={block} />
          ))}
        </div>
        <ReferenceBlock block={disposal} />
      </div>
    </section>
  )
}

function referenceMoney(amount: number): string {
  return Number.isFinite(amount) ? formatAud(amount) : '—'
}

function ReferenceBlock({ block }: { block: StatementReferenceBlock }) {
  const showGst = block.gst_mode !== 'no_gst'
  const quantity = block.quantityColumn === true
  const columns = quantity
    ? showGst ? 'minmax(0, 1.1fr) auto auto auto' : 'minmax(0, 1.1fr) auto auto'
    : showGst ? '1.3fr auto auto' : '1.3fr auto'
  return (
    <div
      style={{
        padding: '12px 12px 4px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        minWidth: 0,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2 }}>{block.heading}</div>
      {block.reference && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{block.reference}</div>
      )}
      {block.detail && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{block.detail}</div>
      )}
      {block.facts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {block.facts.map(fact => (
            <div
              key={fact.label}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 4 }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{fact.label}</span>
              <span style={{ fontWeight: 700 }}>{fact.value}</span>
            </div>
          ))}
        </div>
      )}
      {block.empty && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>{block.empty}</div>
      )}
      {block.lines.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: columns,
              gap: 8,
              marginBottom: 6,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            <span>{block.itemHeading || 'Item'}</span>
            {quantity && <span style={{ textAlign: 'right' }}>{block.quantityHeading || 'Quantity'}</span>}
            {quantity && showGst && <span style={{ textAlign: 'right' }}>Ex GST</span>}
            {showGst && !quantity && <span style={{ textAlign: 'right' }}>Before GST</span>}
            <span style={{ textAlign: 'right' }}>{quantity && !showGst ? 'Ex GST' : showGst ? 'Inc GST' : 'Amount'}</span>
          </div>
          {block.lines.map((line, index) => (
            <div
              key={`${line.label}-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: columns,
                gap: 8,
                marginBottom: 6,
                fontWeight: line.strong ? 700 : 400,
                borderTop: line.strong ? '1px solid var(--border)' : undefined,
                paddingTop: line.strong ? 6 : undefined,
              }}
            >
              <span>{line.label}</span>
              {quantity && <span style={{ textAlign: 'right' }}>{line.quantity || '—'}</span>}
              {showGst && <span style={{ textAlign: 'right' }}>{referenceMoney(line.ex)}</span>}
              <span style={{ textAlign: 'right' }}>
                {referenceMoney(showGst ? line.inc : line.ex)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function surveyAreasEqual(a: StatementSurveyArea[] | null, b: StatementSurveyArea[] | null): boolean {
  if (a == null || b == null) return a == null && b == null
  return a.length === b.length && a.every((area, index) => area.label === b[index].label && area.sqm === b[index].sqm)
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
    && a.invoice1_callout === b.invoice1_callout
    && a.invoice1_contents === b.invoice1_contents
    && a.invoice1_cleaning === b.invoice1_cleaning
    && surveyAreasEqual(a.survey_areas, b.survey_areas)
    && a.invoice2_m3 === b.invoice2_m3
    && a.invoice2_skips === b.invoice2_skips
    && a.invoice2_trailers === b.invoice2_trailers
    && a.invoice2_utes === b.invoice2_utes
    && a.invoice2_tip_receipts === b.invoice2_tip_receipts
    && a.invoice2_prepaid === b.invoice2_prepaid
    && a.charges_gst === b.charges_gst
    && a.deposit_date === b.deposit_date
    && a.adjustment_reason === b.adjustment_reason
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
  const reference = useMemo(
    () => statementReferencePanel(job.assessment_data, documents),
    [job.assessment_data, documents],
  )
  const surveySeed = useMemo(
    () => surveyAreaQuantities(job.assessment_data),
    [job.assessment_data],
  )
  const surveyAreas = capture.survey_areas ?? surveySeed

  function patch(next: Partial<StatementOfAccountsCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
    setSavedFlash(false)
  }

  function setSurveyAreas(next: StatementSurveyArea[]) {
    patch({ survey_areas: next })
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
    if (capture.invoice1_adjusted_amount != null && !capture.adjustment_reason.trim()) {
      setSaveError('Enter why invoice 1 changed. The statement needs that reason before it can be generated.')
      return
    }
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
    <div style={{ paddingBottom: 120 }}>
      <style>{`
        .soa-ref-grid { display: grid; gap: 12px; }
        .soa-ref-float {
          position: sticky;
          top: 116px;
          z-index: 8;
          max-height: calc(100vh - 116px - 84px);
          overflow: auto;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
        }
        @media (min-width: 760px) {
          .soa-ref-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
        }
      `}</style>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
        Type each amount. After every step the statement shows an overpay or an underpay.
      </p>

      <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
        <div><strong>Property:</strong> {job.site_address || '—'}</div>
      </div>

      <ReferencePanel
        survey={reference.survey}
        quotes={reference.quotes}
        disposal={reference.disposal}
      />

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
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Survey area for each room. These print on the statement and are not added to the invoice.</div>
              {surveyAreas.map((area, index) => (
                <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 120px auto', gap: 8, alignItems: 'end' }}>
                  <div>
                    <label style={LABEL}>Area</label>
                    <input
                      type="text"
                      value={area.label}
                      onChange={e => {
                        const next = surveyAreas.map((row, rowIndex) => rowIndex === index ? { ...row, label: e.target.value } : row)
                        setSurveyAreas(next)
                      }}
                      placeholder="Room"
                      style={INPUT}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>m²</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={area.sqm ?? ''}
                      onChange={e => {
                        const raw = e.target.value
                        const next = surveyAreas.map((row, rowIndex) => (
                          rowIndex === index ? { ...row, sqm: raw === '' ? null : Number(raw) } : row
                        ))
                        setSurveyAreas(next)
                      }}
                      placeholder="0"
                      style={INPUT}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSurveyAreas(surveyAreas.filter((_, rowIndex) => rowIndex !== index))}
                    style={{ ...INPUT, width: 'auto', padding: '8px 10px', cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSurveyAreas([...surveyAreas, { label: '', sqm: null }])}
                style={{ ...INPUT, width: 'auto', justifySelf: 'start', padding: '8px 12px', cursor: 'pointer' }}
              >
                Add area
              </button>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>How this invoice is made up. Leave a line blank to omit it. The amounts must add up to the invoice.</div>
              {([
                ['Call out ($)', 'invoice1_callout'],
                ['Contents ($)', 'invoice1_contents'],
                ['Cleaning ($)', 'invoice1_cleaning'],
              ] as const).map(([label, key]) => (
                <div key={key}>
                  <label style={LABEL}>{label}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={capture[key] ?? ''}
                    onChange={e => {
                      const raw = e.target.value
                      patch({ [key]: raw === '' ? null : Number(raw) })
                    }}
                    placeholder="0.00"
                    style={INPUT}
                  />
                </div>
              ))}
            </div>
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
              <label style={{ ...LABEL, marginTop: 10 }}>Date received</label>
              <input
                type="date"
                value={capture.deposit_date}
                onChange={e => patch({ deposit_date: e.target.value })}
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
            {capture.invoice1_adjusted_amount != null && (
              <div style={{ marginTop: 10 }}>
                <label style={LABEL}>Why invoice 1 changed</label>
                <input
                  type="text"
                  value={capture.adjustment_reason}
                  onChange={e => patch({ adjustment_reason: e.target.value })}
                  placeholder="Required before the statement can be generated"
                  style={INPUT}
                />
              </div>
            )}
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
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Skips, trailers, utes, and tip receipts, less prepaid, must add up to this invoice. Cubic metres is a quantity.</div>
              <div>
                <label style={LABEL}>Cubic metres removed</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={capture.invoice2_m3 ?? ''}
                  onChange={e => {
                    const raw = e.target.value
                    patch({ invoice2_m3: raw === '' ? null : Number(raw) })
                  }}
                  placeholder="0"
                  style={INPUT}
                />
              </div>
              {([
                ['Skips ($)', 'invoice2_skips'],
                ['Trailers ($)', 'invoice2_trailers'],
                ['Utes ($)', 'invoice2_utes'],
                ['Tip receipts ($)', 'invoice2_tip_receipts'],
                ['Prepaid ($)', 'invoice2_prepaid'],
              ] as const).map(([label, key]) => (
                <div key={key}>
                  <label style={LABEL}>{label}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={capture[key] ?? ''}
                    onChange={e => {
                      const raw = e.target.value
                      patch({ [key]: raw === '' ? null : Number(raw) })
                    }}
                    placeholder="0.00"
                    style={INPUT}
                  />
                </div>
              ))}
            </div>
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
