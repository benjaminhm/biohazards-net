/*
 * app/jobs/[id]/docs/[type]/page.tsx
 *
 * Document generation and editing page for a specific doc type on a job.
 * This is the full-featured successor to GenerateModal — it provides:
 *
 *   1. Document generation via POST /api/build-document (streaming or single-shot).
 *   2. A chat-based editing interface powered by POST /api/chat-document.
 *      Each message round-trips to Claude with the full conversation history.
 *   3. A live preview pane that renders the current content as HTML via buildPrintHTML.
 *   4. An InstructionsPanel for editing per-type document_rules (AI style guide)
 *      without leaving the page.
 *   5. Save to DB and print/share via /api/documents + /api/print/[docId].
 *
 * The page auto-generates on first load if no existing document of that type
 * exists for the job (?generate=1 query param is set by the DocumentsTab link).
 * If an existing document is found, it's loaded into draft for editing instead.
 *
 * The chat panel history includes the initial generation as the first assistant
 * message so subsequent edits have full context of the original content.
 *
 * Wrapped in <Suspense> because useSearchParams() is used inside and Next.js
 * requires Suspense for client components that read search params.
 */
'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { DocType, Job, Photo, CompanyProfile } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { useUser } from '@/lib/userContext'

// ── Instructions panel ────────────────────────────────────────────────────────

function InstructionsPanel({ docType, docLabel, company, onSaved, onClose }: {
  docType: DocType
  docLabel: string
  company: CompanyProfile | null
  onSaved: (updated: CompanyProfile) => void
  onClose: () => void
}) {
  const [specific,    setSpecific]    = useState(company?.document_rules?.[docType] ?? '')
  const [general,     setGeneral]     = useState(company?.document_rules?.general ?? '')
  const [stylePdfUrl, setStylePdfUrl] = useState(company?.document_rules?.[docType + '_pdf'] ?? '')
  const [showGeneral, setShowGeneral] = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [uploadingPdf,setUploadingPdf]= useState(false)
  const [saveErr,     setSaveErr]     = useState('')
  const pdfRef = useRef<HTMLInputElement>(null)

  async function uploadPdf(file: File) {
    setUploadingPdf(true)
    try {
      const fileName = `style-guide-${docType}-${Date.now()}.pdf`
      const res = await fetch('/api/company/style-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, contentType: 'application/pdf' }),
      })
      const { signedUrl, publicUrl, error: urlErr } = await res.json()
      if (urlErr) throw new Error(urlErr)
      const up = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })
      if (!up.ok) throw new Error('Upload failed')
      setStylePdfUrl(publicUrl)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'PDF upload failed')
    } finally {
      setUploadingPdf(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaveErr('')
    try {
      const merged = {
        ...(company?.document_rules ?? {}),
        general,
        [docType]: specific,
        ...(stylePdfUrl ? { [docType + '_pdf']: stylePdfUrl } : {}),
      }
      const res = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_rules: merged }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onSaved(data.company)
      onClose()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>📋 {docLabel} Instructions</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              Claude reads these every time it builds or edits this document. Saves to your company profile.
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px', flexShrink: 0 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Doc-specific instructions */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
              {docLabel} Instructions
            </label>
            <textarea
              value={specific}
              onChange={e => setSpecific(e.target.value)}
              placeholder={`What should Claude always do for every ${docLabel}?\n\ne.g. Always break the quote into separate line items per area. Never go under $2,500. Include a note about disposal costs. Use the word "remediation" not "cleaning".`}
              rows={9}
              style={{ width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>

          {/* Style guide PDF */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4, color: 'var(--text)' }}>
              Style Guide PDF <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— optional</span>
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Upload an existing {docLabel} as a reference — Claude will match its formatting, structure, and tone.
            </div>
            {stylePdfUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ fontSize: 20 }}>📄</span>
                <span style={{ fontSize: 13, flex: 1, color: 'var(--text)' }}>Style guide uploaded</span>
                <button onClick={() => { setStylePdfUrl(''); if (pdfRef.current) pdfRef.current.value = '' }}
                  style={{ fontSize: 12, color: '#F87171', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Remove</button>
                <button onClick={() => pdfRef.current?.click()}
                  style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Replace</button>
              </div>
            ) : (
              <button onClick={() => pdfRef.current?.click()} disabled={uploadingPdf}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {uploadingPdf ? <><span className="spinner" /> Uploading PDF…</> : '📄 Upload existing PDF as style guide'}
              </button>
            )}
            <input ref={pdfRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadPdf(f) }} />
          </div>

          {/* General rules — collapsible */}
          <div>
            <button onClick={() => setShowGeneral(g => !g)}
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              {showGeneral ? '▾' : '▸'} General Instructions <span style={{ fontWeight: 400 }}>(all doc types)</span>
            </button>
            {showGeneral && (
              <textarea
                value={general}
                onChange={e => setGeneral(e.target.value)}
                placeholder="Voice and tone rules that apply to every document type…"
                rows={5}
                style={{ width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: 8 }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        {saveErr && (
          <div style={{ padding: '8px 20px', fontSize: 12, color: '#F87171', background: 'rgba(239,68,68,0.08)' }}>{saveErr}</div>
        )}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>
            {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Instructions'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Contenteditable section ───────────────────────────────────────────────────

function Editable({ value, onChange, multiline = true, style }: {
  value: string; onChange: (v: string) => void; multiline?: boolean; style?: React.CSSProperties
}) {
  const ref  = useRef<HTMLDivElement>(null)
  const last = useRef(value)

  useEffect(() => {
    if (ref.current && value !== last.current) {
      ref.current.innerText = value
      last.current = value
    }
  }, [value])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={e => { const v = e.currentTarget.innerText; last.current = v; onChange(v) }}
      onKeyDown={e => { if (!multiline && e.key === 'Enter') e.preventDefault() }}
      style={{ outline: 'none', cursor: 'text', minHeight: '1em', ...style }}
    >
      {value}
    </div>
  )
}

function TCell({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: '9px 12px', borderBottom: '1px solid #eee', verticalAlign: 'top', ...style }}>
      <Editable value={value} onChange={onChange} multiline={false} />
    </td>
  )
}

// ── Doc building blocks ───────────────────────────────────────────────────────

function DocLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#FF6B35', marginTop: 26, marginBottom: 8 }}>{children}</div>
}

function DocSection({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <>
    <DocLabel>{label}</DocLabel>
    <Editable value={value || ''} onChange={onChange}
      style={{ fontSize: 13, color: '#333', lineHeight: 1.6, padding: '6px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.02)', minHeight: `${rows * 1.5}em` }} />
  </>
}

type LI = { description: string; qty: number; unit: string; rate: number; total: number }
function LineItemsDoc({ items, onChange }: { items: LI[]; onChange: (v: LI[]) => void }) {
  function upd(i: number, f: string, v: string) {
    const next = items.map((li, idx) => {
      if (idx !== i) return li
      const u = { ...li, [f]: f === 'description' || f === 'unit' ? v : parseFloat(v) || 0 }
      if (f === 'qty' || f === 'rate') u.total = u.qty * u.rate
      return u
    })
    onChange(next)
  }
  const sub = items.reduce((s, i) => s + i.total, 0)
  const gst = Math.round(sub * 0.1 * 100) / 100
  return <>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
      <thead>
        <tr style={{ background: '#1a1a1a', color: '#fff' }}>
          {['Description', 'Qty', 'Unit', 'Rate', 'Total'].map((h, i) => (
            <th key={h} style={{ padding: '9px 12px', textAlign: i === 0 ? 'left' : 'right', fontSize: 12 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((li, i) => (
          <tr key={i}>
            <TCell value={li.description} onChange={v => upd(i, 'description', v)} />
            <TCell value={String(li.qty)} onChange={v => upd(i, 'qty', v)} style={{ textAlign: 'right', width: 50 }} />
            <TCell value={li.unit} onChange={v => upd(i, 'unit', v)} style={{ width: 60 }} />
            <TCell value={String(li.rate)} onChange={v => upd(i, 'rate', v)} style={{ textAlign: 'right', width: 80 }} />
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, width: 90, borderBottom: '1px solid #eee' }}>${li.total.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 40, color: '#666' }}><span>Subtotal</span><span style={{ minWidth: 80, textAlign: 'right' }}>${sub.toFixed(2)}</span></div>
      {gst > 0 && <div style={{ display: 'flex', gap: 40, color: '#666' }}><span>GST (10%)</span><span style={{ minWidth: 80, textAlign: 'right' }}>${gst.toFixed(2)}</span></div>}
      <div style={{ display: 'flex', gap: 40, fontWeight: 700, fontSize: 15, borderTop: '2px solid #1a1a1a', paddingTop: 8 }}>
        <span>TOTAL</span><span style={{ minWidth: 80, textAlign: 'right', color: '#FF6B35' }}>${(sub + gst).toFixed(2)}</span>
      </div>
    </div>
  </>
}

type WS = { step: string; hazards: string; risk_before: string; controls: string; risk_after: string; responsible: string }
function StepsDoc({ steps, onChange }: { steps: WS[]; onChange: (v: WS[]) => void }) {
  function upd(i: number, f: keyof WS, v: string) { onChange(steps.map((s, idx) => idx === i ? { ...s, [f]: v } : s)) }
  const rc = (r: string) => r?.startsWith('H') ? '#dc2626' : r?.startsWith('M') ? '#d97706' : '#16a34a'
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: '#1a1a1a', color: '#fff' }}>
        {['#','Step / Task','Hazards','R↑','Controls','R↓','By'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11 }}>{h}</th>)}
      </tr></thead>
      <tbody>{steps.map((s, i) => (
        <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
          <td style={{ padding: '8px 10px', color: '#999', fontSize: 11 }}>{i + 1}</td>
          <td style={{ padding: '4px 6px' }}><Editable value={s.step} onChange={v => upd(i, 'step', v)} style={{ fontSize: 12, minHeight: '2em' }} /></td>
          <td style={{ padding: '4px 6px' }}><Editable value={s.hazards} onChange={v => upd(i, 'hazards', v)} style={{ fontSize: 12, minHeight: '2em' }} /></td>
          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: rc(s.risk_before) }}>{s.risk_before}</td>
          <td style={{ padding: '4px 6px' }}><Editable value={s.controls} onChange={v => upd(i, 'controls', v)} style={{ fontSize: 12, minHeight: '2em' }} /></td>
          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: rc(s.risk_after) }}>{s.risk_after}</td>
          <td style={{ padding: '4px 6px' }}><Editable value={s.responsible} onChange={v => upd(i, 'responsible', v)} multiline={false} style={{ fontSize: 12 }} /></td>
        </tr>
      ))}</tbody>
    </table>
  )
}

type RR = { hazard: string; likelihood: string; consequence: string; risk_rating: string; controls: string; residual_risk: string }
function RisksDoc({ risks, onChange }: { risks: RR[]; onChange: (v: RR[]) => void }) {
  function upd(i: number, f: keyof RR, v: string) { onChange(risks.map((r, idx) => idx === i ? { ...r, [f]: v } : r)) }
  const rc = (r: string) => r?.startsWith('H') ? '#dc2626' : r?.startsWith('M') ? '#d97706' : '#16a34a'
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: '#1a1a1a', color: '#fff' }}>
        {['Hazard','Like.','Cons.','Rating','Controls','Residual'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11 }}>{h}</th>)}
      </tr></thead>
      <tbody>{risks.map((r, i) => (
        <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
          <td style={{ padding: '4px 6px' }}><Editable value={r.hazard} onChange={v => upd(i, 'hazard', v)} style={{ fontSize: 12 }} /></td>
          <td style={{ padding: '8px 10px', fontWeight: 700, color: rc(r.likelihood) }}>{r.likelihood}</td>
          <td style={{ padding: '8px 10px', fontWeight: 700, color: rc(r.consequence) }}>{r.consequence}</td>
          <td style={{ padding: '8px 10px', fontWeight: 700, color: rc(r.risk_rating) }}>{r.risk_rating}</td>
          <td style={{ padding: '4px 6px' }}><Editable value={r.controls} onChange={v => upd(i, 'controls', v)} style={{ fontSize: 12 }} /></td>
          <td style={{ padding: '8px 10px', fontWeight: 700, color: rc(r.residual_risk) }}>{r.residual_risk}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

type WI = { description: string; quantity: string; unit: string; disposal_method: string; facility: string }
function WasteDoc({ items, onChange }: { items: WI[]; onChange: (v: WI[]) => void }) {
  function upd(i: number, f: keyof WI, v: string) { onChange(items.map((w, idx) => idx === i ? { ...w, [f]: v } : w)) }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: '#1a1a1a', color: '#fff' }}>
        {['Description','Qty','Unit','Disposal','Facility'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11 }}>{h}</th>)}
      </tr></thead>
      <tbody>{items.map((w, i) => (
        <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
          {(['description','quantity','unit','disposal_method','facility'] as const).map(f => (
            <TCell key={f} value={String(w[f])} onChange={v => upd(i, f, v)} />
          ))}
        </tr>
      ))}</tbody>
    </table>
  )
}

// ── Document body ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DocumentBody({ type, content, company, orgName, onChange }: {
  type: DocType
  content: Record<string, any>
  company: CompanyProfile | null
  /** From /api/me when company_profile row is missing */
  orgName?: string | null
  onChange: (k: string, v: unknown) => void
}) {
  const name    = company?.name    || orgName    || 'Company'
  const tagline = company?.tagline || 'Professional services'
  const sec = (label: string, key: string, rows = 3) => (
    <DocSection key={key} label={label} value={content[key] || ''} onChange={v => onChange(key, v)} rows={rows} />
  )
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', color: '#1a1a1a', lineHeight: 1.5 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          {company?.logo_url && <img src={company.logo_url} alt={name} style={{ maxHeight: 52, maxWidth: 150, objectFit: 'contain', display: 'block', marginBottom: 6 }} />}
          <div style={{ fontWeight: 700, fontSize: 18 }}>{name}</div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{tagline}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#555' }}>
          <Editable value={content.reference || ''} onChange={v => onChange('reference', v)} multiline={false} style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 13 }} />
          <div style={{ marginTop: 2 }}>{new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          {company?.abn && <div style={{ marginTop: 2 }}>ABN {company.abn}</div>}
        </div>
      </div>
      <div style={{ height: 3, background: '#FF6B35', borderRadius: 2, marginBottom: 24 }} />
      <Editable value={content.title || ''} onChange={v => onChange('title', v)} multiline={false}
        style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }} />

      {type === 'quote' && <>
        {sec('Overview', 'intro', 3)}
        <DocLabel>Scope &amp; Pricing</DocLabel>
        <LineItemsDoc items={content.line_items || []} onChange={v => { const s = v.reduce((a: number, i: LI) => a + i.total, 0); onChange('line_items', v); onChange('subtotal', s); onChange('gst', Math.round(s * 0.1 * 100) / 100); onChange('total', s + Math.round(s * 0.1 * 100) / 100) }} />
        {sec('Notes & Conditions', 'notes', 2)}
        {sec('Payment Terms', 'payment_terms', 2)}
        {sec('Quote Validity', 'validity', 1)}
      </>}
      {type === 'sow' && <>{sec('Executive Summary','executive_summary',3)}{sec('Scope of Work','scope',5)}{sec('Methodology','methodology',4)}{sec('Safety Protocols','safety_protocols',3)}{sec('Waste Disposal','waste_disposal',2)}{sec('Timeline','timeline',2)}{sec('Exclusions','exclusions',2)}{sec('Disclaimer','disclaimer',2)}{sec('Acceptance','acceptance',2)}</>}
      {type === 'swms' && <>{sec('Project Details','project_details',2)}<DocLabel>Work Steps, Hazards &amp; Controls</DocLabel><StepsDoc steps={content.steps||[]} onChange={v=>onChange('steps',v)} />{sec('PPE Required','ppe_required',3)}{sec('Emergency Procedures','emergency_procedures',3)}{sec('Legislation & References','legislation_references',2)}{sec('Worker Declarations','declarations',2)}</>}
      {type === 'authority_to_proceed' && <>{sec('Scope of Works Authorised','scope_summary',3)}{sec('Site Access Details','access_details',2)}{sec('Special Conditions','special_conditions',2)}{sec('Liability Acknowledgment','liability_acknowledgment',3)}{sec('Payment Authorisation','payment_authorisation',2)}{sec('Acceptance','acceptance',2)}</>}
      {type === 'engagement_agreement' && <>{sec('Parties','parties',2)}{sec('Services','services_description',3)}{sec('Fees & Payment','fees_and_payment',3)}{sec('Limitation of Liability','liability_limitations',3)}{sec('Confidentiality','confidentiality',2)}{sec('Dispute Resolution','dispute_resolution',2)}{sec('Termination','termination',2)}{sec('Governing Law','governing_law',1)}{sec('Acceptance','acceptance',2)}</>}
      {type === 'report' && <>{sec('Executive Summary','executive_summary',3)}{sec('Site Conditions on Arrival','site_conditions',3)}{sec('Works Carried Out','works_carried_out',5)}{sec('Methodology','methodology',3)}{sec('Products & Equipment Used','products_used',3)}{sec('Waste Disposal','waste_disposal',2)}{sec('Photo Record Notes','photo_record',2)}{sec('Outcome','outcome',2)}{sec('Technician Sign-Off','technician_signoff',2)}</>}
      {type === 'certificate_of_decontamination' && <>
        {sec('Date of Works','date_of_works',1)}{sec('Works Summary','works_summary',3)}{sec('Decontamination Standard','decontamination_standard',2)}{sec('Products Used','products_used',2)}
        <div style={{ margin: '24px 0', padding: 20, background: '#f0fdf4', border: '2px solid #16a34a', borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#16a34a', marginBottom: 8 }}>Outcome</div>
          <Editable value={content.outcome_statement||''} onChange={v=>onChange('outcome_statement',v)} style={{ fontSize: 14, color: '#15803d', fontWeight: 600, lineHeight: 1.5, minHeight: '2em' }} />
        </div>
        {sec('Limitations','limitations',2)}{sec('Certifier Statement','certifier_statement',2)}
      </>}
      {type === 'waste_disposal_manifest' && <>{sec('Collection Date','collection_date',1)}<DocLabel>Waste Items</DocLabel><WasteDoc items={content.waste_items||[]} onChange={v=>onChange('waste_items',v)} />{sec('Transport Details','transport_details',2)}{sec('Declaration','declaration',3)}</>}
      {type === 'jsa' && <>{sec('Job Description','job_description',2)}<DocLabel>Steps, Hazards &amp; Controls</DocLabel><StepsDoc steps={content.steps||[]} onChange={v=>onChange('steps',v)} />{sec('PPE Required','ppe_required',2)}{sec('Emergency Contacts','emergency_contacts',2)}{sec('Sign-Off Statement','sign_off',2)}</>}
      {type === 'nda' && <>{sec('Parties','parties',2)}{sec('Confidential Information','confidential_information_definition',3)}{sec('Obligations','obligations',3)}{sec('Exceptions','exceptions',2)}{sec('Term','term',2)}{sec('Remedies','remedies',2)}{sec('Governing Law','governing_law',1)}{sec('Acceptance','acceptance',2)}</>}
      {type === 'risk_assessment' && <>{sec('Site Description','site_description',2)}{sec('Assessment Date','assessment_date',1)}{sec('Assessor','assessor',1)}<DocLabel>Risk Register</DocLabel><RisksDoc risks={content.risks||[]} onChange={v=>onChange('risks',v)} />{sec('Overall Risk Rating','overall_risk_rating',1)}{sec('Recommendations','recommendations',2)}{sec('Review Date','review_date',1)}</>}

      {/* Signature block */}
      <div style={{ marginTop: 40, borderTop: '1px solid #eee', paddingTop: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, marginTop: 24 }}>
          <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#666' }}>Authorised Signature</div>
          <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#666' }}>Date</div>
        </div>
      </div>
    </div>
  )
}

// ── Chat suggestions ──────────────────────────────────────────────────────────

const STARTERS = [
  'Change the tone to be more direct',
  'Make the intro shorter',
  'Remove generic filler phrases',
  'Make it sound more personal',
]

// ── Main page ─────────────────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; text: string }

function DocEditorInner() {
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { org: ctxOrg } = useUser()

  const jobId   = params.id as string
  const docType = params.type as DocType
  const docId   = searchParams.get('docId')

  const [job,              setJob]             = useState<Job | null>(null)
  const [photos,           setPhotos]          = useState<Photo[]>([])
  const [company,          setCompany]         = useState<CompanyProfile | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [content,          setContent]         = useState<Record<string, any>>({})
  const [savedDocId,       setSavedDocId]      = useState<string | null>(docId)
  const [building,         setBuilding]        = useState(false)
  const [saving,           setSaving]          = useState(false)
  const [saveOk,           setSaveOk]          = useState(false)
  const [saveErr,          setSaveErr]         = useState('')
  const [messages,         setMessages]        = useState<ChatMsg[]>([])
  const [input,            setInput]           = useState('')
  const [chatting,         setChatting]        = useState(false)
  const [showInstructions, setShowInstructions]= useState(false)
  const [isMobile,         setIsMobile]        = useState(false)
  const [mobileTab,        setMobileTab]        = useState<'doc' | 'chat'>('chat')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const docLabel   = DOC_TYPE_LABELS[docType] ?? docType
  const hasContent = Object.keys(content).length > 0

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Default to doc tab when editing an existing doc
  useEffect(() => { if (docId && hasContent) setMobileTab('doc') }, [docId, hasContent])

  useEffect(() => {
    async function load() {
      const [jobRes, companyRes] = await Promise.all([
        fetch(`/api/jobs/${jobId}`).then(r => r.json()),
        fetch('/api/company').then(r => r.json()),
      ])
      setJob(jobRes.job); setPhotos(jobRes.photos ?? []); setCompany(companyRes.company ?? null)
      if (docId) {
        const d = await fetch(`/api/documents/${docId}`).then(r => r.json())
        if (d.document?.content) setContent(d.document.content)
      }
    }
    load()
  }, [jobId, docId])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, chatting])

  function updateField(key: string, val: unknown) { setContent(c => ({ ...c, [key]: val })) }

  const buildWithClaude = useCallback(async () => {
    if (!job) return
    setBuilding(true)
    setMessages([{ role: 'assistant', text: `Building your ${docLabel} from the assessment data…` }])
    try {
      const res = await fetch('/api/build-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: docType, job, photos, company }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setContent(data.content)
      setMessages([{ role: 'assistant', text: `Done ✓  Your ${docLabel} is ready. Tap the Document tab to review, or tell me what to change.` }])
      setMobileTab('doc')
    } catch (err: unknown) {
      setMessages([{ role: 'assistant', text: `Error: ${err instanceof Error ? err.message : 'Build failed'}` }])
    } finally { setBuilding(false) }
  }, [job, photos, company, docType, docLabel])

  function getDocRules(): string {
    const dr = company?.document_rules ?? {}
    return [dr.general, dr[docType]].filter(Boolean).join('\n\n')
  }

  async function sendMessage() {
    const msg = input.trim()
    if (!msg || chatting || !hasContent) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: msg }])
    setChatting(true)
    try {
      const res = await fetch('/api/chat-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: docType, content, message: msg, rules: getDocRules() }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setContent(data.content)
      setMessages(m => [...m, { role: 'assistant', text: data.reply || 'Done ✓' }])
    } catch (err: unknown) {
      setMessages(m => [...m, { role: 'assistant', text: `Error: ${err instanceof Error ? err.message : 'Failed'}` }])
    } finally { setChatting(false) }
  }

  async function save(andOpen = false) {
    if (!hasContent) return
    setSaving(true); setSaveErr('')
    try {
      const url = savedDocId ? `/api/documents/${savedDocId}` : '/api/documents'
      const res = await fetch(url, { method: savedDocId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, type: docType, content, file_url: null }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const id = data.document?.id ?? savedDocId
      setSavedDocId(id)
      if (andOpen) {
        const printUrl = `${window.location.origin}/api/print/${id}`
        if (window.matchMedia('(display-mode: standalone)').matches) window.location.href = printUrl
        else window.open(printUrl, '_blank')
      } else {
        setSaveOk(true); setTimeout(() => setSaveOk(false), 2500)
        router.push(`/jobs/${jobId}?tab=documents`)
      }
    } catch (err: unknown) { setSaveErr(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  // ── Shared panel contents ────────────────────────────────────────────────────

  const chatPanelInner = (
    <>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button data-devid="P3-E2" onClick={buildWithClaude} disabled={building || !job}
          style={{ width: '100%', padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700, background: building ? 'var(--surface-2)' : 'var(--accent)', color: building ? 'var(--text-muted)' : '#fff', border: 'none', cursor: building || !job ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: building || !job ? 0.7 : 1 }}>
          {building ? <><span className="spinner" /> Building…</> : '✨ Build with Claude'}
        </button>
        <button data-devid="P3-E3" onClick={() => setShowInstructions(true)}
          style={{ width: '100%', padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--bg)', color: company?.document_rules?.[docType] ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          📋 {docLabel} Instructions{company?.document_rules?.[docType] ? ' ●' : ''}
        </button>
        {['quote','sow','report'].includes(docType) && (
          <button data-devid="P3-E4"
            onClick={() => updateField('include_photos', content.include_photos === false ? true : false)}
            style={{ width: '100%', padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: content.include_photos === false ? 'var(--text-muted)' : 'var(--accent)' }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{content.include_photos === false ? '🚫' : '📷'}</span>
            Photos {content.include_photos === false ? 'excluded' : 'included'}
          </button>
        )}
      </div>
      <div data-devid="P3-E5" style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && !building && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
            {hasContent ? 'Tap any section on the document to edit directly, or tell me what to change.' : 'Tap ✨ Build with Claude to generate your document.'}
          </div>
        )}
        {messages.length === 0 && hasContent && STARTERS.map(s => (
          <button key={s} onClick={() => setInput(s)}
            style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', lineHeight: 1.4 }}>
            {s}
          </button>
        ))}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '9px 12px', borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px', background: m.role === 'user' ? 'var(--accent)' : 'var(--bg)', color: m.role === 'user' ? '#fff' : 'var(--text)', border: m.role === 'assistant' ? '1px solid var(--border)' : 'none', fontSize: 13, lineHeight: 1.5 }}>
            {m.text}
          </div>
        ))}
        {chatting && <div style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: '12px 12px 12px 3px', background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}><span className="spinner" /> Updating…</div>}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea data-devid="P3-E6" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder={hasContent ? 'Tell Claude what to change… (Enter to send)' : 'Build document first…'}
            disabled={chatting || !hasContent} rows={2}
            style={{ flex: 1, resize: 'none', fontSize: 13, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', lineHeight: 1.4 }} />
          <button onClick={sendMessage} disabled={chatting || !input.trim() || !hasContent}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: 'pointer', alignSelf: 'flex-end', opacity: chatting || !input.trim() || !hasContent ? 0.4 : 1, flexShrink: 0 }}>↑</button>
        </div>
      </div>
    </>
  )

  const docPanelInner = (
    <div data-devid="P3-E9" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 12px 100px' : '32px 24px 80px', background: '#e8e8e8' }}>
      {!hasContent ? (
        <div style={{ maxWidth: 600, margin: isMobile ? '40px auto' : '80px auto', textAlign: 'center', color: 'var(--text-muted)', padding: '0 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>Empty document</div>
          <div style={{ fontSize: 13 }}>
            {isMobile
              ? <>Tap <strong>Chat</strong> below, then tap <strong>✨ Build with Claude</strong>.</>
              : <>Click <strong>✨ Build with Claude</strong> to generate your {docLabel}.</>}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 800, margin: '0 auto', background: '#fff', borderRadius: 4, boxShadow: '0 4px 32px rgba(0,0,0,0.12)', padding: isMobile ? '20px 16px' : '48px' }}>
          <DocumentBody type={docType} content={content} company={company} orgName={ctxOrg?.name} onChange={updateField} />
        </div>
      )}
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Top bar */}
      <div data-devid="P3-E1" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, zIndex: 20 }}>
        <button onClick={() => router.push(`/jobs/${jobId}?tab=documents`)} style={{ fontSize: 18, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{docLabel}</div>
          {job && <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.client_name} — {job.site_address}</div>}
        </div>
        {saveErr && <div style={{ fontSize: 12, color: '#F87171', flexShrink: 0 }}>{saveErr}</div>}
        {saveOk  && <div style={{ fontSize: 12, color: '#4ADE80', flexShrink: 0 }}>✓</div>}
        <button data-devid="P3-E7" onClick={() => save(false)} disabled={saving || !hasContent} className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 12px', flexShrink: 0 }}>
          {saving ? '…' : isMobile ? '💾' : '💾 Save'}
        </button>
        <button data-devid="P3-E8" onClick={() => save(true)} disabled={saving || !hasContent} className="btn btn-primary" style={{ fontSize: 13, padding: '8px 12px', flexShrink: 0 }}>
          {isMobile ? '↗' : '↗ Preview & Send'}
        </button>
      </div>

      {showInstructions && (
        <InstructionsPanel
          docType={docType}
          docLabel={docLabel}
          company={company}
          onSaved={updated => setCompany(updated)}
          onClose={() => setShowInstructions(false)}
        />
      )}

      {isMobile ? (
        /* ── Mobile: full-width tabs ── */
        <>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
            {/* Document tab content */}
            <div style={{ display: mobileTab === 'doc' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0 }}>
              {docPanelInner}
            </div>
            {/* Chat tab content */}
            <div style={{ display: mobileTab === 'chat' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0, background: 'var(--surface)' }}>
              {chatPanelInner}
            </div>
          </div>
          {/* Bottom tab bar */}
          <div style={{ display: 'flex', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, zIndex: 10 }}>
            <button data-devid="P3-E10" onClick={() => setMobileTab('doc')}
              style={{ flex: 1, padding: '12px 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: mobileTab === 'doc' ? 'var(--accent)' : 'var(--text-muted)', borderTop: mobileTab === 'doc' ? '2px solid var(--accent)' : '2px solid transparent' }}>
              <span style={{ fontSize: 20 }}>📄</span>
              Document
            </button>
            <button data-devid="P3-E11" onClick={() => setMobileTab('chat')}
              style={{ flex: 1, padding: '12px 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: mobileTab === 'chat' ? 'var(--accent)' : 'var(--text-muted)', borderTop: mobileTab === 'chat' ? '2px solid var(--accent)' : '2px solid transparent', position: 'relative' }}>
              <span style={{ fontSize: 20 }}>💬</span>
              Chat
              {(building || chatting) && <span style={{ position: 'absolute', top: 8, right: '30%', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite' }} />}
            </button>
          </div>
        </>
      ) : (
        /* ── Desktop: side-by-side ── */
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ width: 300, minWidth: 260, maxWidth: 340, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', flexShrink: 0 }}>
            {chatPanelInner}
          </div>
          {docPanelInner}
        </div>
      )}
    </div>
  )
}

export default function DocEditorPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
      <DocEditorInner />
    </Suspense>
  )
}
