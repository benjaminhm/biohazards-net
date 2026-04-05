/*
 * components/tabs/InvoiceTab.tsx
 *
 * Subcontractor invoice tab shown on /jobs/[id] when the viewer is a
 * subcontractor assigned to that job.
 *
 * On load, fetches GET /api/jobs/[id]/invoices which returns:
 *   - invoices      existing invoices for this person + job
 *   - can_invoice   true when caller is a subcontractor assigned here
 *   - bank_details  person's saved bank account details for form pre-fill
 *
 * One invoice per job: if an invoice already exists the creation form is
 * hidden and only the existing invoice is shown.
 *
 * Bank details are pre-filled from the person's profile on first render.
 * The subcontractor can edit them before submitting — the profile copy is
 * not modified here.
 *
 * Routes:
 *   GET  /api/jobs/[id]/invoices                     — load invoices
 *   POST /api/jobs/[id]/invoices                     — create new invoice
 *   POST /api/jobs/[id]/invoices/[invoiceId]/send    — send to accounts
 */
'use client'

import { useEffect, useState } from 'react'

interface InvoiceRow {
  id: string
  invoice_number: string
  agreed_amount: number
  works_undertaken: string | null
  bank_account_name: string | null
  bank_bsb: string | null
  bank_account_number: string | null
  status: string
  sent_at: string | null
  created_at: string
}

interface BankDetails {
  bank_account_name: string
  bank_bsb: string
  bank_account_number: string
}

interface InvoiceForm {
  works_undertaken: string
  agreed_amount: string
  bank_account_name: string
  bank_bsb: string
  bank_account_number: string
}

const EMPTY_FORM: InvoiceForm = {
  works_undertaken: '',
  agreed_amount: '',
  bank_account_name: '',
  bank_bsb: '',
  bank_account_number: '',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export default function InvoiceTab({ jobId }: { jobId: string }) {
  const [invoices, setInvoices]   = useState<InvoiceRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<InvoiceForm>(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sentIds, setSentIds]     = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/invoices`)
      .then(r => r.json())
      .then(d => {
        setInvoices(d.invoices ?? [])
        // Pre-fill bank details from profile if present
        if (d.bank_details) {
          const bd: BankDetails = d.bank_details
          setForm(f => ({
            ...f,
            bank_account_name:   bd.bank_account_name   || f.bank_account_name,
            bank_bsb:            bd.bank_bsb            || f.bank_bsb,
            bank_account_number: bd.bank_account_number || f.bank_account_number,
          }))
        }
      })
      .finally(() => setLoading(false))
  }, [jobId])

  // One invoice per job: if one already exists, never show the creation form
  const hasInvoice = invoices.length > 0

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault()
    if (!form.agreed_amount) return
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          works_undertaken:    form.works_undertaken || null,
          agreed_amount:       parseFloat(form.agreed_amount),
          bank_account_name:   form.bank_account_name || null,
          bank_bsb:            form.bank_bsb || null,
          bank_account_number: form.bank_account_number || null,
        }),
      })
      const data = await res.json()
      if (data.invoice) {
        setInvoices(prev => [data.invoice, ...prev])
        setShowForm(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function sendInvoice(invoiceId: string) {
    setSendingId(invoiceId)
    try {
      await fetch(`/api/jobs/${jobId}/invoices/${invoiceId}/send`, { method: 'POST' })
      setSentIds(prev => new Set([...prev, invoiceId]))
    } finally {
      setSendingId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header — only show New Invoice button if no invoice exists yet */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {hasInvoice ? 'Your invoice for this job' : 'Invoice accounts for work completed on this job'}
        </div>
        {!hasInvoice && (
          <button
            onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            {showForm ? 'Cancel' : '+ New Invoice'}
          </button>
        )}
      </div>

      {/* New invoice form */}
      {showForm && !hasInvoice && (
        <form onSubmit={createInvoice} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Works Undertaken">
            <textarea
              value={form.works_undertaken}
              onChange={e => setForm(f => ({ ...f, works_undertaken: e.target.value }))}
              placeholder="Describe the work completed…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          <Field label="Agreed Amount ($)">
            <input
              type="number" step="0.01" min="0" required
              value={form.agreed_amount}
              onChange={e => setForm(f => ({ ...f, agreed_amount: e.target.value }))}
              placeholder="0.00"
              style={inputStyle}
            />
          </Field>
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 2 }}>
            Bank Details
          </div>
          <Field label="Account Name">
            <input
              value={form.bank_account_name}
              onChange={e => setForm(f => ({ ...f, bank_account_name: e.target.value }))}
              placeholder="Name on account"
              style={inputStyle}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="BSB">
              <input
                value={form.bank_bsb}
                onChange={e => setForm(f => ({ ...f, bank_bsb: e.target.value }))}
                placeholder="000-000"
                style={inputStyle}
              />
            </Field>
            <Field label="Account Number">
              <input
                value={form.bank_account_number}
                onChange={e => setForm(f => ({ ...f, bank_account_number: e.target.value }))}
                placeholder="12345678"
                style={inputStyle}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{ padding: '12px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: saving ? 0.6 : 1, marginTop: 4 }}
          >
            {saving ? 'Saving…' : 'Save Invoice'}
          </button>
        </form>
      )}

      {/* Invoice list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          <span className="spinner" />
        </div>
      ) : invoices.length === 0 && !showForm ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          No invoice submitted yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {invoices.map(inv => {
            const isSent    = inv.status === 'sent' || sentIds.has(inv.id)
            const isSending = sendingId === inv.id
            return (
              <div key={inv.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: inv.works_undertaken ? 10 : 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{inv.invoice_number}</div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--accent)' }}>
                      ${Number(inv.agreed_amount).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      {new Date(inv.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </div>
                {inv.works_undertaken && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
                    {inv.works_undertaken}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
                    background: isSent ? 'rgba(34,197,94,0.1)' : 'rgba(100,100,100,0.1)',
                    color: isSent ? '#4ADE80' : '#888',
                  }}>
                    {isSent
                      ? `✓ Sent${inv.sent_at ? ' · ' + new Date(inv.sent_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : ''}`
                      : 'Draft'}
                  </span>
                  {!isSent && (
                    <button
                      onClick={() => sendInvoice(inv.id)}
                      disabled={isSending}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: isSending ? 0.6 : 1 }}
                    >
                      {isSending ? '…' : '✉ Send to Accounts'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
