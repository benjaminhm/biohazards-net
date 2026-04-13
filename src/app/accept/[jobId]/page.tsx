/*
 * app/accept/[jobId]/page.tsx
 *
 * Public quote summary page — no authentication required. Legacy links may
 * still point here from old PDFs. Signing is handled externally (e.g. PandaDoc);
 * this page no longer records acceptance in-app.
 *
 * Quote line items and pricing are fetched and displayed so the client can
 * see what they've accepted without needing the original PDF.
 *
 * Company branding is applied to match the org's subdomain identity.
 */
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface QuoteData {
  job: {
    id: string
    client_name: string
    site_address: string
    job_type: string
    status: string
    urgency: string
  }
  quote: {
    title: string
    reference: string
    intro: string
    subtotal: number
    gst: number
    total: number
    payment_terms: string
    validity: string
    line_items: Array<{
      description: string
      qty: number
      unit: string
      rate: number
      total: number
    }>
  } | null
}

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene',
  hoarding: 'Hoarding',
  mold: 'Mold',
  sewage: 'Sewage',
  trauma: 'Trauma',
  unattended_death: 'Unattended Death',
  flood: 'Flood',
  other: 'Other',
}

export default function AcceptQuotePage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [data, setData] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')

  const fmt = (n: number) =>
    `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  useEffect(() => {
    fetch(`/api/accept/${jobId}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        if (d.job?.status === 'accepted') setAccepted(true) // legacy jobs only
        setLoading(false)
      })
      .catch(() => {
        setError('Unable to load quote. Please contact us directly.')
        setLoading(false)
      })
  }, [jobId])

  // Light theme page — client facing
  const page: React.CSSProperties = {
    minHeight: '100vh',
    background: '#F5F5F5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#111',
    padding: '0 0 60px',
  }

  const container: React.CSSProperties = {
    maxWidth: 560,
    margin: '0 auto',
    padding: '0 20px',
  }

  if (loading) {
    return (
      <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          Loading quote...
        </div>
      </div>
    )
  }

  if (error || !data?.job) {
    return (
      <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Quote not found</div>
          <div style={{ color: '#888', fontSize: 14 }}>{error || 'This link may have expired.'}</div>
          <div style={{ marginTop: 16, fontSize: 13, color: '#888' }}>
            Contact us: <a href="tel:0731231234" style={{ color: '#FF6B35' }}>07 xxxx xxxx</a>
          </div>
        </div>
      </div>
    )
  }

  const { job, quote } = data

  if (accepted) {
    return (
      <div style={page}>
        {/* Header */}
        <div style={{ background: '#111', padding: '20px 0' }}>
          <div style={container}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FF6B35' }}>
              Brisbane Biohazard Cleaning
            </div>
          </div>
        </div>
        <div style={{ height: 4, background: '#FF6B35' }} />

        <div style={{ ...container, paddingTop: 60, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 32 }}>
            ✓
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12, color: '#111' }}>
            Quote Accepted
          </h1>
          <p style={{ fontSize: 15, color: '#555', lineHeight: 1.6, marginBottom: 32 }}>
            Thank you, <strong>{job.client_name}</strong>. Your acceptance has been received.
            Our team will be in touch shortly to confirm scheduling.
          </p>
          <div style={{ background: 'white', borderRadius: 12, padding: '20px 24px', textAlign: 'left', border: '1px solid #e5e5e5' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B35', marginBottom: 10 }}>
              What happens next
            </div>
            <div style={{ fontSize: 14, color: '#444', lineHeight: 1.8 }}>
              1. You will receive a confirmation call to confirm the booking date<br />
              2. A 50% deposit will be required to lock in your booking<br />
              3. Our team will arrive at {job.site_address} on the agreed date
            </div>
          </div>
          <div style={{ marginTop: 32, fontSize: 13, color: '#999' }}>
            Brisbane Biohazard Cleaning · biohazards.net
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={page}>
      {/* Header */}
      <div style={{ background: '#111', padding: '20px 0' }}>
        <div style={container}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FF6B35' }}>
            Brisbane Biohazard Cleaning
          </div>
        </div>
      </div>
      <div style={{ height: 4, background: '#FF6B35' }} />

      <div style={{ ...container, paddingTop: 32 }}>
        {/* Quote title */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B35', marginBottom: 6 }}>
            {quote?.reference || 'Quote'}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111', marginBottom: 6 }}>
            {quote?.title || `${JOB_TYPE_LABELS[job.job_type] || job.job_type} Remediation Quote`}
          </h1>
          <div style={{ fontSize: 14, color: '#666' }}>
            Prepared for <strong>{job.client_name}</strong> · {job.site_address}
          </div>
        </div>

        {/* Overview */}
        {quote?.intro && (
          <div style={{ background: 'white', borderRadius: 10, padding: '18px 20px', marginBottom: 20, border: '1px solid #e5e5e5' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 8 }}>
              Overview
            </div>
            <p style={{ fontSize: 14, color: '#333', lineHeight: 1.7, margin: 0 }}>{quote.intro}</p>
          </div>
        )}

        {/* Line items */}
        {quote?.line_items && quote.line_items.length > 0 && (
          <div style={{ background: 'white', borderRadius: 10, overflow: 'hidden', marginBottom: 20, border: '1px solid #e5e5e5' }}>
            <div style={{ padding: '12px 20px', background: '#111' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B35' }}>
                Scope & Pricing
              </div>
            </div>
            {quote.line_items.map((item, i) => (
              <div key={i} style={{
                padding: '12px 20px',
                borderBottom: i < quote.line_items.length - 1 ? '1px solid #f0f0f0' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
                background: i % 2 === 1 ? '#fafafa' : 'white',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#222', marginBottom: 2 }}>{item.description}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{item.qty} {item.unit} × {fmt(item.rate)}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}>
                  {fmt(item.total)}
                </div>
              </div>
            ))}

            {/* Totals */}
            <div style={{ padding: '12px 20px', borderTop: '2px solid #e5e5e5', background: '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: '#888' }}>Subtotal</span>
                <span style={{ fontSize: 13, color: '#333' }}>{fmt(quote.subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: '#888' }}>GST (10%)</span>
                <span style={{ fontSize: 13, color: '#333' }}>{fmt(quote.gst)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #e5e5e5' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>Total</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#FF6B35' }}>{fmt(quote.total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Terms */}
        {quote?.payment_terms && (
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8, lineHeight: 1.5 }}>
            💳 {quote.payment_terms}
          </div>
        )}
        {quote?.validity && (
          <div style={{ fontSize: 13, color: '#888', marginBottom: 28, lineHeight: 1.5 }}>
            ⏱ {quote.validity}
          </div>
        )}

        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', marginBottom: 8 }}>Signing &amp; confirmation</div>
          <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.65, margin: 0 }}>
            Quote acceptance and signatures are handled through our document signing process (e.g. PandaDoc), not through this page. If you need the signing link or have questions, please contact us directly.
          </p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 1.6 }}>
          Questions? Call us directly to discuss the payment terms above.
        </div>

        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #e5e5e5', fontSize: 12, color: '#bbb', textAlign: 'center' }}>
          Brisbane Biohazard Cleaning · biohazards.net
        </div>
      </div>
    </div>
  )
}
