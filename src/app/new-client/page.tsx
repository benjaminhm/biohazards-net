'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

const JOB_TYPES = [
  { value: 'crime_scene', label: 'Crime Scene' },
  { value: 'hoarding', label: 'Hoarding' },
  { value: 'mold', label: 'Mould / Mold' },
  { value: 'sewage', label: 'Sewage' },
  { value: 'trauma', label: 'Trauma' },
  { value: 'unattended_death', label: 'Unattended Death' },
  { value: 'flood', label: 'Flood Damage' },
  { value: 'other', label: 'Other' },
]

export default function NewClientPage() {
  const [company, setCompany] = useState<{ name: string; logo_url: string | null; tagline: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    client_name: '',
    client_phone: '',
    client_email: '',
    site_address: '',
    job_type: 'other',
    notes: '',
  })

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => { if (d.company) setCompany(d.company) })
  }, [])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.client_name.trim() || !form.client_phone.trim()) {
      setError('Name and phone number are required.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          urgency: 'standard',
          status: 'lead',
          notes: form.notes
            ? `[Client enquiry] ${form.notes}`
            : '[Client enquiry via online form]',
        }),
      })
      if (!res.ok) throw new Error('Submission failed')

      // Notify operator
      await fetch('/api/notify-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })

      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please call us directly.')
    } finally {
      setSubmitting(false)
    }
  }

  const companyName = company?.name ?? 'Brisbane Biohazard Cleaning'
  const tagline = company?.tagline ?? 'Professional Biohazard Remediation Services'

  if (submitted) {
    return (
      <div style={{
        minHeight: '100vh', background: '#f8f8f8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: '#22C55E', display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 24px', fontSize: 28,
          }}>✓</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111', marginBottom: 12 }}>
            Thanks, {form.client_name.split(' ')[0]}
          </h1>
          <p style={{ fontSize: 16, color: '#555', lineHeight: 1.6, marginBottom: 24 }}>
            We&apos;ve received your enquiry and will be in touch shortly.
            If your situation is urgent, please call us directly.
          </p>
          <div style={{
            background: '#fff', border: '1px solid #e5e5e5',
            borderRadius: 10, padding: '16px 20px', textAlign: 'left',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 10 }}>
              Your enquiry
            </div>
            {[
              ['Name', form.client_name],
              ['Phone', form.client_phone],
              ['Email', form.client_email],
              ['Address', form.site_address],
              ['Job Type', JOB_TYPES.find(j => j.value === form.job_type)?.label ?? form.job_type],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 14 }}>
                <span style={{ color: '#888', minWidth: 70 }}>{label}</span>
                <span style={{ color: '#111', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f8f8f8',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e5e5', padding: '16px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {company?.logo_url && (
            <Image src={company.logo_url} alt={companyName} width={40} height={40} style={{ objectFit: 'contain', borderRadius: 6 }} />
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>{companyName}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{tagline}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px 60px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 6 }}>
          New Client Enquiry
        </h1>
        <p style={{ fontSize: 15, color: '#666', marginBottom: 28, lineHeight: 1.5 }}>
          Fill in your details below and we&apos;ll get back to you promptly.
          All enquiries are treated with complete discretion.
        </p>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '12px 14px', color: '#DC2626',
            marginBottom: 20, fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
              Your Name *
            </label>
            <input
              type="text"
              value={form.client_name}
              onChange={e => set('client_name', e.target.value)}
              placeholder="First and last name"
              autoFocus
              style={inputStyle}
            />
          </div>

          {/* Phone */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
              Phone Number *
            </label>
            <input
              type="tel"
              value={form.client_phone}
              onChange={e => set('client_phone', e.target.value)}
              placeholder="04xx xxx xxx"
              style={inputStyle}
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
              Email Address
            </label>
            <input
              type="email"
              value={form.client_email}
              onChange={e => set('client_email', e.target.value)}
              placeholder="your@email.com"
              style={inputStyle}
            />
          </div>

          {/* Address */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
              Site Address
            </label>
            <input
              type="text"
              value={form.site_address}
              onChange={e => set('site_address', e.target.value)}
              placeholder="Full street address"
              style={inputStyle}
            />
          </div>

          {/* Job Type */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
              Type of Service Required
            </label>
            <select
              value={form.job_type}
              onChange={e => set('job_type', e.target.value)}
              style={{ ...inputStyle, background: '#fff' }}
            >
              {JOB_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
              Brief Description
              <span style={{ fontWeight: 400, color: '#888', marginLeft: 6 }}>optional</span>
            </label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any additional details about the situation..."
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', padding: '15px 20px',
              background: '#FF6B35', color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 16, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1, transition: 'opacity 0.15s',
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Enquiry'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#999', marginTop: 14 }}>
            Your information is kept strictly confidential.
          </p>
        </form>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  background: '#fff', border: '1px solid #ddd',
  borderRadius: 8, fontSize: 15, color: '#111',
  boxSizing: 'border-box', outline: 'none',
}
