'use client'

import { useState, useEffect } from 'react'
import type { Job, AssessmentData, Document } from '@/lib/types'
import Link from 'next/link'

const DEFAULT_PAYMENT_TERMS = '50% deposit required prior to works commencing. Remainder due on completion, net 7 days.'
const DEFAULT_TERMS = `50% deposit required to confirm booking. Remainder payable on completion within 7 days of invoice. Late payments attract interest at 10% p.a. All biohazardous waste disposed of in accordance with applicable legislation. Contractor not liable for pre-existing structural damage. Client warrants authority to engage contractor for works at the stated premises.`

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
}

function mergeDefaults(saved: AssessmentData | null) {
  return {
    target_price:          saved?.target_price          ?? undefined,
    target_price_note:     saved?.target_price_note     ?? '',
    payment_terms:         saved?.payment_terms         ?? DEFAULT_PAYMENT_TERMS,
    terms_and_conditions:  saved?.terms_and_conditions  ?? DEFAULT_TERMS,
  }
}

export default function QuoteTab({ job, documents, onJobUpdate }: Props) {
  const [fields, setFields] = useState(mergeDefaults(job.assessment_data))
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    setFields(mergeDefaults(job.assessment_data))
  }, [job.id])

  function set<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields(f => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const merged: AssessmentData = {
        ...(job.assessment_data ?? {
          areas: [],
          contamination_level: 1,
          biohazard_type: '',
          ppe_required: { gloves: false, tyvek_suit: false, respirator: false, face_shield: false, boot_covers: false, double_bag: false },
          special_risks: { sharps: false, chemicals: false, structural_damage: false, infectious_disease: false, vermin: false, mold_spores: false },
          estimated_hours: 0,
          estimated_waste_litres: 0,
          access_restrictions: '',
          observations: '',
        }),
        target_price:         fields.target_price,
        target_price_note:    fields.target_price_note,
        payment_terms:        fields.payment_terms,
        terms_and_conditions: fields.terms_and_conditions,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const resp = await res.json()
      onJobUpdate(resp.job)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const section = (title: string) => (
    <div style={{
      fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--accent)',
      marginBottom: 12, marginTop: 28,
    }}>
      {title}
    </div>
  )

  // Find existing quote document if any
  const existingQuote = documents.find(d => d.type === 'quote')

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── Target price ── */}
      {section('Pricing')}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="field">
          <label>
            Target Amount
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              Claude works line items back from this
            </span>
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)', fontSize: 15, fontWeight: 600, pointerEvents: 'none',
            }}>$</span>
            <input
              type="number"
              value={fields.target_price ?? ''}
              onChange={e => {
                const n = parseFloat(e.target.value)
                set('target_price', isNaN(n) ? undefined : n)
              }}
              placeholder="0.00"
              min="0"
              step="50"
              style={{ paddingLeft: 24 }}
            />
          </div>
        </div>
        <div className="field">
          <label>GST Note</label>
          <input
            type="text"
            value={fields.target_price_note}
            onChange={e => set('target_price_note', e.target.value)}
            placeholder="e.g. inc. GST  or  + GST"
          />
        </div>
      </div>

      {/* ── Payment terms ── */}
      {section('Payment Terms')}
      <div className="field">
        <textarea
          value={fields.payment_terms}
          onChange={e => set('payment_terms', e.target.value)}
          rows={3}
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* ── T&Cs ── */}
      {section('Terms & Conditions')}
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, marginTop: -6, lineHeight: 1.5 }}>
        Included in Quote and Engagement Agreement documents.
      </p>
      <div className="field">
        <textarea
          value={fields.terms_and_conditions}
          onChange={e => set('terms_and_conditions', e.target.value)}
          rows={6}
          style={{ resize: 'vertical', fontSize: 13 }}
        />
      </div>

      {/* ── Save ── */}
      <button
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{ width: '100%', padding: 14, fontSize: 15, marginBottom: 24 }}
      >
        {saving ? <><span className="spinner" /> Saving...</> : saved ? '✓ Saved' : 'Save Quote Settings'}
      </button>

      {/* ── Generate / view quote document ── */}
      {section('Quote Document')}

      {existingQuote ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12,
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Quote</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Created {new Date(existingQuote.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
          <Link href={`/jobs/${job.id}/docs/quote?docId=${existingQuote.id}`}>
            <button className="btn btn-secondary" style={{ fontSize: 13 }}>Edit →</button>
          </Link>
        </div>
      ) : (
        <Link href={`/jobs/${job.id}/docs/quote`}>
          <button className="btn btn-secondary" style={{ width: '100%', padding: 14, fontSize: 14 }}>
            ＋ Generate Quote with Claude
          </button>
        </Link>
      )}
    </div>
  )
}
