/*
 * app/new-client/page.tsx
 *
 * Public client intake form — no authentication required. Used when a staff
 * member sends the intake link to a client via /intake-send.
 *
 * The form collects client details, job type, and up to 10 site photos. Photos
 * are uploaded using the same signed URL pattern as the internal photos tab:
 *   1. POST /api/intake/upload-url → signed Supabase Storage URL.
 *   2. PUT file directly to Storage from the browser.
 *   3. Public URL stored locally, then submitted with the form.
 *
 * On submit, POST /api/intake creates a job record with status='lead' and
 * fires a background lead notification to the internal team (notify-lead).
 *
 * A session ID (generateSessionId) is generated on mount and sent with photos
 * to namespace Storage objects for this submission, preventing collisions if the
 * same client reloads and tries to upload again.
 *
 * Company branding (name, logo) is fetched from /api/company so the form
 * matches the org's identity on their subdomain.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

const JOB_TYPES = [
  { value: 'unattended_death', label: 'Unattended Death' },
  { value: 'trauma',           label: 'Trauma / Assault Scene' },
  { value: 'crime_scene',      label: 'Crime Scene' },
  { value: 'hoarding',         label: 'Hoarding Cleanout' },
  { value: 'mold',             label: 'Mould Remediation' },
  { value: 'sewage',           label: 'Sewage / Waste' },
  { value: 'flood',            label: 'Flood Damage' },
  { value: 'other',            label: 'Other' },
]

interface UploadedPhoto {
  file: File
  previewUrl: string
  publicUrl: string | null
  uploading: boolean
  error: boolean
}

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function NewClientPage() {
  const [company, setCompany] = useState<{ name: string; logo_url: string | null; phone?: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const sessionId = useRef(generateSessionId())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    client_name:  '',
    client_phone: '',
    client_email: '',
    site_address: '',
    organisation: '',
    position:     '',
    job_type:     'other',
    situation:    '',
  })

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => { if (d.company) setCompany(d.company) })
  }, [])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return

    const newPhotos: UploadedPhoto[] = files.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      publicUrl: null,
      uploading: true,
      error: false,
    }))

    setPhotos(prev => [...prev, ...newPhotos])

    // Upload each photo
    await Promise.all(newPhotos.map(async (p, i) => {
      try {
        const urlRes = await fetch('/api/intake/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId.current, fileName: p.file.name, contentType: p.file.type }),
        })
        const { signedUrl, publicUrl } = await urlRes.json()
        await fetch(signedUrl, { method: 'PUT', body: p.file, headers: { 'Content-Type': p.file.type } })

        setPhotos(prev => prev.map((ph, idx) =>
          ph.previewUrl === newPhotos[i].previewUrl
            ? { ...ph, publicUrl, uploading: false }
            : ph
        ))
      } catch {
        setPhotos(prev => prev.map(ph =>
          ph.previewUrl === newPhotos[i].previewUrl
            ? { ...ph, uploading: false, error: true }
            : ph
        ))
      }
    }))

    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removePhoto(previewUrl: string) {
    setPhotos(prev => prev.filter(p => p.previewUrl !== previewUrl))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.client_name.trim() || !form.client_phone.trim()) {
      setError('Your name and phone number are required.')
      return
    }
    if (photos.some(p => p.uploading)) {
      setError('Please wait for photos to finish uploading.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const photo_urls = photos.filter(p => p.publicUrl).map(p => p.publicUrl as string)
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photo_urls }),
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
  const companyPhone = company?.phone ?? null

  // ── Success screen ──
  if (submitted) {
    return (
      <div style={{
        minHeight: '100vh', background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        <div style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%',
            background: '#F0FDF4', border: '2px solid #22C55E',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px', fontSize: 26, color: '#16A34A',
          }}>
            ✓
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 10 }}>
            Thank you, {form.client_name.split(' ')[0]}.
          </h1>
          <p style={{ fontSize: 15, color: '#555', lineHeight: 1.65, marginBottom: 28 }}>
            We&apos;ve received your details and will be in touch shortly.
            {companyPhone && (
              <> For urgent situations, call us directly on{' '}
                <a href={`tel:${companyPhone}`} style={{ color: '#FF6B35', fontWeight: 600 }}>{companyPhone}</a>.
              </>
            )}
          </p>
          <div style={{ fontSize: 13, color: '#999' }}>{companyName}</div>
        </div>
      </div>
    )
  }

  // ── Form ──
  return (
    <div style={{
      minHeight: '100vh', background: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#111',
    }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #EBEBEB', padding: '16px 20px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {company?.logo_url && (
            <Image src={company.logo_url} alt={companyName} width={32} height={32} style={{ objectFit: 'contain', borderRadius: 4 }} />
          )}
          <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{companyName}</span>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* Intro */}
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8, color: '#111' }}>
          Request an Assessment
        </h1>
        <p style={{ fontSize: 15, color: '#666', marginBottom: 32, lineHeight: 1.65 }}>
          Fill in your details below and we&apos;ll get back to you as soon as possible.
          Everything you share is confidential.
        </p>

        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 8, padding: '12px 14px', color: '#B91C1C',
            marginBottom: 24, fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={submit}>

          {/* ── Your details ── */}
          <SectionLabel>Your Details</SectionLabel>

          <Field label="Full Name *">
            <ClientInput
              type="text"
              value={form.client_name}
              onChange={e => set('client_name', e.target.value)}
              placeholder="First and last name"
              autoFocus
            />
          </Field>

          <Field label="Phone Number *">
            <ClientInput
              type="tel"
              value={form.client_phone}
              onChange={e => set('client_phone', e.target.value)}
              placeholder="04xx xxx xxx"
            />
          </Field>

          <Field label="Email Address">
            <ClientInput
              type="email"
              value={form.client_email}
              onChange={e => set('client_email', e.target.value)}
              placeholder="your@email.com"
            />
          </Field>

          {/* ── Organisation (optional) ── */}
          <div style={{ height: 1, background: '#F0F0F0', margin: '24px 0' }} />
          <SectionLabel>Organisation <OptLabel>if applicable</OptLabel></SectionLabel>

          <Field label="Company / Agency / Government Body">
            <ClientInput
              type="text"
              value={form.organisation}
              onChange={e => set('organisation', e.target.value)}
              placeholder="e.g. Suncorp, Dept. of Housing, Ray White"
            />
          </Field>

          <Field label="Your Role or Position">
            <ClientInput
              type="text"
              value={form.position}
              onChange={e => set('position', e.target.value)}
              placeholder="e.g. Insurance Assessor, Property Manager, Family Member"
            />
          </Field>

          {/* ── Site details ── */}
          <div style={{ height: 1, background: '#F0F0F0', margin: '24px 0' }} />
          <SectionLabel>Location & Service</SectionLabel>

          <Field label="Site Address *">
            <ClientInput
              type="text"
              value={form.site_address}
              onChange={e => set('site_address', e.target.value)}
              placeholder="Full street address where the work is needed"
            />
          </Field>

          <Field label="Type of Service">
            <select
              value={form.job_type}
              onChange={e => set('job_type', e.target.value)}
              style={selectStyle}
            >
              {JOB_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          {/* ── Situation ── */}
          <div style={{ height: 1, background: '#F0F0F0', margin: '24px 0' }} />
          <SectionLabel>Situation</SectionLabel>

          <Field label="What Happened?">
            <textarea
              value={form.situation}
              onChange={e => set('situation', e.target.value)}
              placeholder="Tell us as much as you're comfortable sharing. The more detail you can provide, the better we can prepare."
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
            />
          </Field>

          {/* ── Photos ── */}
          <div style={{ height: 1, background: '#F0F0F0', margin: '24px 0' }} />
          <SectionLabel>Photos <OptLabel>optional but recommended</OptLabel></SectionLabel>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 1.5 }}>
            Photos help us bring the right equipment and give you an accurate quote faster.
            You can upload up to 10 images.
          </p>

          {/* Photo grid */}
          {photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
              {photos.map(p => (
                <div key={p.previewUrl} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#F5F5F5', border: '1px solid #E5E5E5' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {p.uploading && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                    </div>
                  )}
                  {p.error && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(239,68,68,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                      Failed
                    </div>
                  )}
                  {!p.uploading && (
                    <button
                      type="button"
                      onClick={() => removePhoto(p.previewUrl)}
                      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', fontSize: 13, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {photos.length < 10 && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%', padding: '13px',
                  border: '1.5px dashed #D1D5DB', borderRadius: 10,
                  background: '#FAFAFA', color: '#666',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  marginBottom: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <span style={{ fontSize: 18 }}>📷</span>
                {photos.length === 0 ? 'Add Photos' : 'Add More Photos'}
              </button>
            </>
          )}

          {/* ── Submit ── */}
          <div style={{ height: 1, background: '#F0F0F0', margin: '28px 0 24px' }} />

          <button
            type="submit"
            disabled={submitting || photos.some(p => p.uploading)}
            style={{
              width: '100%', padding: '16px 20px',
              background: '#FF6B35', color: '#fff',
              border: 'none', borderRadius: 10,
              fontSize: 16, fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {submitting ? 'Sending…' : 'Send My Details'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#AAA', marginTop: 14, lineHeight: 1.5 }}>
            Your information is kept strictly confidential and will only be used to assess your enquiry.
          </p>

        </form>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

/* ── Sub-components ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#999', marginBottom: 16 }}>
      {children}
    </div>
  )
}

function OptLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#BBB', marginLeft: 6, fontSize: 11 }}>{children}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function ClientInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={inputStyle} />
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px',
  background: '#fff', border: '1.5px solid #E5E7EB',
  borderRadius: 8, fontSize: 15, color: '#111',
  boxSizing: 'border-box', outline: 'none',
  transition: 'border-color 0.15s',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23999' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
  paddingRight: 36,
}
