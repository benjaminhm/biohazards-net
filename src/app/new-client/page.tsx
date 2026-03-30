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
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Submission failed')

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
        minHeight: '100vh', background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(34,197,94,0.15)', border: '2px solid #22C55E',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 24px', fontSize: 28,
          }}>✓</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Lead saved — {form.client_name}
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 24 }}>
            Job created as a lead in your queue.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <a href="/" style={{
              padding: '11px 20px', background: 'var(--accent)', color: '#fff',
              borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none',
            }}>
              View Job Queue
            </a>
            <button
              onClick={() => { setSubmitted(false); setForm({ client_name: '', client_phone: '', client_email: '', site_address: '', job_type: 'other', notes: '' }) }}
              style={{
                padding: '11px 20px', background: 'var(--surface)',
                border: '1px solid var(--border)', color: 'var(--text)',
                borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              Add Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '16px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {company?.logo_url && (
              <Image src={company.logo_url} alt={companyName} width={36} height={36} style={{ objectFit: 'contain', borderRadius: 6 }} />
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{companyName}</div>
          </div>
          <a href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← Job Queue</a>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 24px 60px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          New Client Intake
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
          Log client details after a call or conversation. Job is created as a lead in your queue.
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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

        </form>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 15, color: 'var(--text)',
  boxSizing: 'border-box', outline: 'none',
}
