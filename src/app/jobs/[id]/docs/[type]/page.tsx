'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { DocType, Job, Photo, CompanyProfile } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { buildPrintHTML } from '@/lib/printDocument'

// ── Field definitions per doc type ────────────────────────────────────────────

type FieldType = 'text' | 'textarea' | 'line_items' | 'steps' | 'risks' | 'waste_items'

interface FieldDef {
  key: string
  label: string
  type: FieldType
  hint?: string
  rows?: number
}

const FIELDS: Record<DocType, FieldDef[]> = {
  quote: [
    { key: 'intro',          label: 'Overview / Introduction', type: 'textarea', rows: 4 },
    { key: 'line_items',     label: 'Line Items',              type: 'line_items' },
    { key: 'notes',          label: 'Notes & Conditions',      type: 'textarea', rows: 3 },
    { key: 'payment_terms',  label: 'Payment Terms',           type: 'textarea', rows: 2 },
    { key: 'validity',       label: 'Quote Validity',          type: 'text' },
  ],
  sow: [
    { key: 'executive_summary', label: 'Executive Summary',    type: 'textarea', rows: 4 },
    { key: 'scope',             label: 'Scope of Work',        type: 'textarea', rows: 5 },
    { key: 'methodology',       label: 'Methodology',          type: 'textarea', rows: 5 },
    { key: 'safety_protocols',  label: 'Safety Protocols',     type: 'textarea', rows: 4 },
    { key: 'waste_disposal',    label: 'Waste Disposal',       type: 'textarea', rows: 3 },
    { key: 'timeline',          label: 'Timeline',             type: 'textarea', rows: 2 },
    { key: 'exclusions',        label: 'Exclusions',           type: 'textarea', rows: 3 },
    { key: 'disclaimer',        label: 'Disclaimer',           type: 'textarea', rows: 3 },
    { key: 'acceptance',        label: 'Acceptance Clause',    type: 'textarea', rows: 2 },
  ],
  swms: [
    { key: 'project_details',       label: 'Project Details',         type: 'textarea', rows: 2 },
    { key: 'steps',                 label: 'Work Steps, Hazards & Controls', type: 'steps' },
    { key: 'ppe_required',          label: 'PPE Required',            type: 'textarea', rows: 4 },
    { key: 'emergency_procedures',  label: 'Emergency Procedures',    type: 'textarea', rows: 4 },
    { key: 'legislation_references',label: 'Legislation & References',type: 'textarea', rows: 2 },
    { key: 'declarations',          label: 'Worker Declarations',     type: 'textarea', rows: 2 },
  ],
  authority_to_proceed: [
    { key: 'scope_summary',          label: 'Scope of Works Authorised',  type: 'textarea', rows: 4 },
    { key: 'access_details',         label: 'Site Access Details',        type: 'textarea', rows: 3 },
    { key: 'special_conditions',     label: 'Special Conditions',         type: 'textarea', rows: 3 },
    { key: 'liability_acknowledgment',label: 'Liability Acknowledgment',  type: 'textarea', rows: 3 },
    { key: 'payment_authorisation',  label: 'Payment Authorisation',      type: 'textarea', rows: 3 },
    { key: 'acceptance',             label: 'Acceptance Clause',          type: 'textarea', rows: 2 },
  ],
  engagement_agreement: [
    { key: 'parties',            label: 'Parties',                type: 'textarea', rows: 3 },
    { key: 'services_description',label: 'Services Description',  type: 'textarea', rows: 4 },
    { key: 'fees_and_payment',   label: 'Fees & Payment',         type: 'textarea', rows: 4 },
    { key: 'liability_limitations',label: 'Limitation of Liability', type: 'textarea', rows: 4 },
    { key: 'confidentiality',    label: 'Confidentiality',        type: 'textarea', rows: 3 },
    { key: 'dispute_resolution', label: 'Dispute Resolution',     type: 'textarea', rows: 3 },
    { key: 'termination',        label: 'Termination',            type: 'textarea', rows: 3 },
    { key: 'governing_law',      label: 'Governing Law',          type: 'text' },
    { key: 'acceptance',         label: 'Acceptance Clause',      type: 'textarea', rows: 2 },
  ],
  report: [
    { key: 'executive_summary', label: 'Executive Summary',          type: 'textarea', rows: 4 },
    { key: 'site_conditions',   label: 'Site Conditions on Arrival', type: 'textarea', rows: 4 },
    { key: 'works_carried_out', label: 'Works Carried Out',          type: 'textarea', rows: 5 },
    { key: 'methodology',       label: 'Methodology',                type: 'textarea', rows: 4 },
    { key: 'products_used',     label: 'Products & Equipment Used',  type: 'textarea', rows: 3 },
    { key: 'waste_disposal',    label: 'Waste Disposal',             type: 'textarea', rows: 3 },
    { key: 'photo_record',      label: 'Photo Record Notes',         type: 'textarea', rows: 3 },
    { key: 'outcome',           label: 'Outcome',                    type: 'textarea', rows: 3 },
    { key: 'technician_signoff',label: 'Technician Sign-Off',        type: 'textarea', rows: 2 },
  ],
  certificate_of_decontamination: [
    { key: 'date_of_works',           label: 'Date of Works',              type: 'text' },
    { key: 'works_summary',           label: 'Works Summary',              type: 'textarea', rows: 4 },
    { key: 'decontamination_standard',label: 'Decontamination Standard',   type: 'textarea', rows: 3 },
    { key: 'products_used',           label: 'Products Used',              type: 'textarea', rows: 3 },
    { key: 'outcome_statement',       label: 'Outcome Statement',          type: 'textarea', rows: 3 },
    { key: 'limitations',             label: 'Limitations',                type: 'textarea', rows: 2 },
    { key: 'certifier_statement',     label: 'Certifier Statement',        type: 'textarea', rows: 2 },
  ],
  waste_disposal_manifest: [
    { key: 'collection_date',  label: 'Collection Date',    type: 'text' },
    { key: 'waste_items',      label: 'Waste Items',        type: 'waste_items' },
    { key: 'transport_details',label: 'Transport Details',  type: 'textarea', rows: 3 },
    { key: 'declaration',      label: 'Declaration',        type: 'textarea', rows: 3 },
  ],
  jsa: [
    { key: 'job_description',   label: 'Job Description',         type: 'textarea', rows: 3 },
    { key: 'steps',             label: 'Steps, Hazards & Controls', type: 'steps' },
    { key: 'ppe_required',      label: 'PPE Required',            type: 'textarea', rows: 3 },
    { key: 'emergency_contacts',label: 'Emergency Contacts',      type: 'textarea', rows: 3 },
    { key: 'sign_off',          label: 'Sign-Off Statement',      type: 'textarea', rows: 2 },
  ],
  nda: [
    { key: 'parties',                           label: 'Parties',                       type: 'textarea', rows: 3 },
    { key: 'confidential_information_definition',label: 'Confidential Information',     type: 'textarea', rows: 4 },
    { key: 'obligations',                       label: 'Obligations',                   type: 'textarea', rows: 4 },
    { key: 'exceptions',                        label: 'Exceptions',                    type: 'textarea', rows: 3 },
    { key: 'term',                              label: 'Term',                          type: 'textarea', rows: 2 },
    { key: 'remedies',                          label: 'Remedies',                      type: 'textarea', rows: 3 },
    { key: 'governing_law',                     label: 'Governing Law',                 type: 'text' },
    { key: 'acceptance',                        label: 'Acceptance Clause',             type: 'textarea', rows: 2 },
  ],
  risk_assessment: [
    { key: 'site_description',   label: 'Site Description',    type: 'textarea', rows: 3 },
    { key: 'assessment_date',    label: 'Assessment Date',     type: 'text' },
    { key: 'assessor',           label: 'Assessor',            type: 'text' },
    { key: 'risks',              label: 'Risk Register',       type: 'risks' },
    { key: 'overall_risk_rating',label: 'Overall Risk Rating', type: 'text' },
    { key: 'recommendations',    label: 'Recommendations',     type: 'textarea', rows: 3 },
    { key: 'review_date',        label: 'Review Date',         type: 'text' },
  ],
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface LineItem { description: string; qty: number; unit: string; rate: number; total: number }

function LineItemsEditor({ value, onChange }: { value: LineItem[]; onChange: (v: LineItem[]) => void }) {
  function update(i: number, field: keyof LineItem, val: string) {
    const next = value.map((item, idx) => {
      if (idx !== i) return item
      const updated = { ...item, [field]: field === 'description' || field === 'unit' ? val : parseFloat(val) || 0 }
      updated.total = updated.qty * updated.rate
      return updated
    })
    onChange(next)
  }
  const subtotal = value.reduce((s, li) => s + li.total, 0)
  const gst = Math.round(subtotal * 0.1 * 100) / 100
  const total = subtotal + gst

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1a1a1a', color: '#fff' }}>
              {['Description', 'Qty', 'Unit', 'Rate ($)', 'Total ($)'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: 12 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((li, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                {(['description', 'qty', 'unit', 'rate'] as const).map(f => (
                  <td key={f} style={{ padding: 4 }}>
                    <input
                      value={String(li[f])}
                      onChange={e => update(i, f, e.target.value)}
                      style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 13, color: 'var(--text)', textAlign: f === 'description' ? 'left' : 'right' }}
                    />
                  </td>
                ))}
                <td style={{ padding: '4px 10px', textAlign: 'right', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  ${li.total.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontSize: 13 }}>
        <div style={{ display: 'flex', gap: 40, color: 'var(--text-muted)' }}><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
        <div style={{ display: 'flex', gap: 40, color: 'var(--text-muted)' }}><span>GST (10%)</span><span>${gst.toFixed(2)}</span></div>
        <div style={{ display: 'flex', gap: 40, fontWeight: 700, fontSize: 15, borderTop: '2px solid var(--text)', paddingTop: 6 }}><span>TOTAL</span><span style={{ color: 'var(--accent)' }}>${total.toFixed(2)}</span></div>
      </div>
    </div>
  )
}

interface WorkStep { step: string; hazards: string; risk_before: string; controls: string; risk_after: string; responsible: string }

function StepsEditor({ value, onChange }: { value: WorkStep[]; onChange: (v: WorkStep[]) => void }) {
  function update(i: number, field: keyof WorkStep, val: string) {
    onChange(value.map((s, idx) => idx === i ? { ...s, [field]: val } : s))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {value.map((s, i) => (
        <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>STEP {i+1}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { f: 'step', l: 'Task' }, { f: 'hazards', l: 'Hazards' },
              { f: 'controls', l: 'Control Measures' }, { f: 'responsible', l: 'Responsible' },
            ].map(({ f, l }) => (
              <div key={f}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{l}</div>
                <textarea value={((s as unknown) as Record<string,string>)[f]} onChange={e => update(i, f as keyof WorkStep, e.target.value)} rows={2}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text)', resize: 'vertical' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
            {[{ f: 'risk_before', l: 'Risk Before (H/M/L)' }, { f: 'risk_after', l: 'Risk After (H/M/L)' }].map(({ f, l }) => (
              <div key={f}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{l}</div>
                <select value={((s as unknown) as Record<string,string>)[f]} onChange={e => update(i, f as keyof WorkStep, e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text)' }}>
                  <option value="H">H — High</option>
                  <option value="M">M — Medium</option>
                  <option value="L">L — Low</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface RiskRow { hazard: string; likelihood: string; consequence: string; risk_rating: string; controls: string; residual_risk: string }

function RisksEditor({ value, onChange }: { value: RiskRow[]; onChange: (v: RiskRow[]) => void }) {
  function update(i: number, field: keyof RiskRow, val: string) {
    onChange(value.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }
  const ratingOptions = [{ value: 'H', label: 'H — High' }, { value: 'M', label: 'M — Medium' }, { value: 'L', label: 'L — Low' }]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {value.map((r, i) => (
        <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>RISK {i+1}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Hazard</div>
              <input value={r.hazard} onChange={e => update(i, 'hazard', e.target.value)}
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text)' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Controls</div>
              <input value={r.controls} onChange={e => update(i, 'controls', e.target.value)}
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text)' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
            {[{ f: 'likelihood', l: 'Likelihood' }, { f: 'consequence', l: 'Consequence' }, { f: 'risk_rating', l: 'Risk Rating' }, { f: 'residual_risk', l: 'Residual Risk' }].map(({ f, l }) => (
              <div key={f}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{l}</div>
                <select value={((r as unknown) as Record<string,string>)[f]} onChange={e => update(i, f as keyof RiskRow, e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text)' }}>
                  {ratingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface WasteItemRow { description: string; quantity: string; unit: string; disposal_method: string; facility: string }

function WasteItemsEditor({ value, onChange }: { value: WasteItemRow[]; onChange: (v: WasteItemRow[]) => void }) {
  function update(i: number, field: keyof WasteItemRow, val: string) {
    onChange(value.map((w, idx) => idx === i ? { ...w, [field]: val } : w))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {value.map((w, i) => (
        <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>ITEM {i+1}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            {[{ f: 'description', l: 'Description' }, { f: 'quantity', l: 'Quantity' }, { f: 'unit', l: 'Unit' }].map(({ f, l }) => (
              <div key={f}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{l}</div>
                <input value={((w as unknown) as Record<string,string>)[f]} onChange={e => update(i, f as keyof WasteItemRow, e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text)' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            {[{ f: 'disposal_method', l: 'Disposal Method' }, { f: 'facility', l: 'Facility' }].map(({ f, l }) => (
              <div key={f}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{l}</div>
                <input value={((w as unknown) as Record<string,string>)[f]} onChange={e => update(i, f as keyof WasteItemRow, e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text)' }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function DocEditorInner() {
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()

  const jobId   = params.id as string
  const docType = params.type as DocType
  const docId   = searchParams.get('docId') // set when editing existing doc

  const [job,     setJob]     = useState<Job | null>(null)
  const [photos,  setPhotos]  = useState<Photo[]>([])
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [fields,  setFields]  = useState<Record<string, unknown>>({})
  const [building,setBuilding]= useState(false)
  const [saving,  setSaving]  = useState(false)
  const [buildErr,setBuildErr]= useState('')
  const [saveErr, setSaveErr] = useState('')
  const [saveOk,  setSaveOk]  = useState(false)
  const [savedDocId, setSavedDocId] = useState<string | null>(docId)

  const docLabel = DOC_TYPE_LABELS[docType] ?? docType

  // Load job, photos, company, and existing doc (if editing)
  useEffect(() => {
    async function load() {
      const [jobRes, companyRes] = await Promise.all([
        fetch(`/api/jobs/${jobId}`).then(r => r.json()),
        fetch('/api/company').then(r => r.json()),
      ])
      setJob(jobRes.job)
      setPhotos(jobRes.photos ?? [])
      setCompany(companyRes.company ?? null)

      if (docId) {
        const docRes = await fetch(`/api/documents/${docId}`).then(r => r.json())
        if (docRes.document?.content) setFields(docRes.document.content)
      }
    }
    load()
  }, [jobId, docId])

  function setField(key: string, value: unknown) {
    setFields(f => ({ ...f, [key]: value }))
  }

  const buildWithClaude = useCallback(async () => {
    if (!job) return
    setBuilding(true)
    setBuildErr('')
    try {
      const res = await fetch('/api/build-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: docType, job, photos, company }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Merge — don't overwrite reference/title if already set
      setFields(prev => ({ ...data.content, ...Object.fromEntries(Object.entries(prev).filter(([,v]) => v)) }))
    } catch (err: unknown) {
      setBuildErr(err instanceof Error ? err.message : 'Build failed')
    } finally {
      setBuilding(false)
    }
  }, [job, photos, company, docType])

  async function saveAndPreview() {
    if (!job) return
    setSaving(true)
    setSaveErr('')
    try {
      // Save or update document record
      const url    = savedDocId ? `/api/documents/${savedDocId}` : '/api/documents'
      const method = savedDocId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, type: docType, content: fields, file_url: null }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const id = data.document?.id ?? savedDocId
      setSavedDocId(id)

      // Open print page
      const appUrl  = window.location.origin
      const printUrl = `${appUrl}/api/print/${id}`
      const isPWA = window.matchMedia('(display-mode: standalone)').matches
      if (isPWA) {
        window.location.href = printUrl
      } else {
        window.open(printUrl, '_blank')
      }
    } catch (err: unknown) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveOnly() {
    if (!job) return
    setSaving(true)
    setSaveErr('')
    try {
      const url    = savedDocId ? `/api/documents/${savedDocId}` : '/api/documents'
      const method = savedDocId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, type: docType, content: fields, file_url: null }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSavedDocId(data.document?.id ?? savedDocId)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
      router.push(`/jobs/${jobId}?tab=documents`)
    } catch (err: unknown) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Live preview HTML (for screen-only inline preview)
  const previewHtml = (() => {
    try {
      if (!Object.keys(fields).length) return null
      return buildPrintHTML(docType, fields, photos, company, jobId, window?.location?.origin ?? '', {
        client_name: job?.client_name,
        client_email: job?.client_email,
        client_phone: job?.client_phone,
        printUrl: savedDocId ? `${window?.location?.origin}/api/print/${savedDocId}` : '',
      })
    } catch { return null }
  })()

  const fieldDefs = FIELDS[docType] ?? []
  const hasFields = Object.values(fields).some(v => v !== undefined && v !== '' && (Array.isArray(v) ? v.length > 0 : true))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/jobs/${jobId}?tab=documents`)}
          style={{ fontSize: 18, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{docLabel}</div>
          {job && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{job.client_name} — {job.site_address}</div>}
        </div>
        <button
          onClick={buildWithClaude}
          disabled={building || !job}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: building ? 'var(--surface-2)' : 'var(--surface-2)',
            border: '1px solid var(--border)', color: 'var(--accent)',
            cursor: building || !job ? 'not-allowed' : 'pointer',
            opacity: building || !job ? 0.6 : 1,
          }}
        >
          {building ? <><span className="spinner" /> Building…</> : '✨ Build with Claude'}
        </button>
      </div>

      {buildErr && (
        <div style={{ background: 'rgba(239,68,68,0.1)', padding: '10px 20px', fontSize: 13, color: '#F87171' }}>{buildErr}</div>
      )}

      {/* Empty state */}
      {!hasFields && !building && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 }}>
          <div style={{ fontSize: 40 }}>📄</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Start your {docLabel}</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 340 }}>
            Click <strong>✨ Build with Claude</strong> to auto-populate all fields from your assessment, or fill them in manually below.
          </div>
        </div>
      )}

      {building && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontSize: 36 }}>✍️</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Claude is writing your {docLabel}…</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Usually takes 10–20 seconds</div>
        </div>
      )}

      {/* Fields */}
      {!building && (
        <div style={{ flex: 1, maxWidth: 800, width: '100%', margin: '0 auto', padding: '24px 20px 120px' }}>
          {fieldDefs.map(fd => (
            <div key={fd.key} style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
                {fd.label}
              </label>

              {fd.type === 'text' && (
                <input
                  value={String(fields[fd.key] ?? '')}
                  onChange={e => setField(fd.key, e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: 'var(--text)' }}
                />
              )}

              {fd.type === 'textarea' && (
                <textarea
                  value={String(fields[fd.key] ?? '')}
                  onChange={e => setField(fd.key, e.target.value)}
                  rows={fd.rows ?? 4}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: 'var(--text)', resize: 'vertical', lineHeight: 1.6 }}
                />
              )}

              {fd.type === 'line_items' && (
                <LineItemsEditor
                  value={(fields[fd.key] as LineItem[]) ?? []}
                  onChange={v => {
                    const sub = v.reduce((s, li) => s + li.total, 0)
                    const gst = Math.round(sub * 0.1 * 100) / 100
                    setFields(f => ({ ...f, line_items: v, subtotal: sub, gst, total: sub + gst }))
                  }}
                />
              )}

              {fd.type === 'steps' && (
                <StepsEditor
                  value={(fields[fd.key] as WorkStep[]) ?? []}
                  onChange={v => setField(fd.key, v)}
                />
              )}

              {fd.type === 'risks' && (
                <RisksEditor
                  value={(fields[fd.key] as RiskRow[]) ?? []}
                  onChange={v => setField(fd.key, v)}
                />
              )}

              {fd.type === 'waste_items' && (
                <WasteItemsEditor
                  value={(fields[fd.key] as WasteItemRow[]) ?? []}
                  onChange={v => setField(fd.key, v)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10,
        background: 'var(--surface)', borderTop: '1px solid var(--border)',
        padding: '12px 20px',
      }}>
        {saveErr && <div style={{ fontSize: 12, color: '#F87171', marginBottom: 8 }}>{saveErr}</div>}
        {saveOk  && <div style={{ fontSize: 12, color: '#4ADE80', marginBottom: 8 }}>✓ Saved</div>}
        <div style={{ display: 'flex', gap: 10, maxWidth: 800, margin: '0 auto' }}>
          <button onClick={saveOnly} disabled={saving || !hasFields} className="btn btn-secondary" style={{ flex: 1 }}>
            {saving ? <><span className="spinner" /> Saving…</> : '💾 Save'}
          </button>
          <button onClick={saveAndPreview} disabled={saving || !hasFields} className="btn btn-primary" style={{ flex: 2, fontSize: 15 }}>
            {saving ? <><span className="spinner" /> Opening…</> : '↗ Preview & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DocEditorPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>}>
      <DocEditorInner />
    </Suspense>
  )
}
