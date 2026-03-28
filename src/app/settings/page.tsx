'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { CompanyProfile } from '@/lib/types'

const DEFAULT_PROFILE: Omit<CompanyProfile, 'id' | 'updated_at'> = {
  name: 'Brisbane Biohazard Cleaning',
  abn: '',
  phone: '',
  email: '',
  address: '',
  licence: '',
  tagline: 'Professional Biohazard Remediation Services',
  logo_url: null,
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<typeof DEFAULT_PROFILE>(DEFAULT_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState('')
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(data => {
        if (data.company) {
          setProfile({
            name: data.company.name ?? DEFAULT_PROFILE.name,
            abn: data.company.abn ?? '',
            phone: data.company.phone ?? '',
            email: data.company.email ?? '',
            address: data.company.address ?? '',
            licence: data.company.licence ?? '',
            tagline: data.company.tagline ?? DEFAULT_PROFILE.tagline,
            logo_url: data.company.logo_url ?? null,
          })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true)
    setError('')
    try {
      const ext = file.name.split('.').pop()
      const fileName = `company-logo-${Date.now()}.${ext}`

      const urlRes = await fetch('/api/company/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, contentType: file.type }),
      })
      const { signedUrl, publicUrl, error: urlErr } = await urlRes.json()
      if (urlErr) throw new Error(urlErr)

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

      setProfile(p => ({ ...p, logo_url: publicUrl }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setUploadingLogo(false)
    }
  }

  function field(label: string, key: keyof typeof DEFAULT_PROFILE, placeholder?: string) {
    return (
      <div className="field">
        <label>{label}</label>
        <input
          value={(profile[key] as string) ?? ''}
          onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder ?? ''}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}>
        <div className="spinner" />
        Loading...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/">
            <button className="btn btn-ghost" style={{ padding: '6px 0', fontSize: 14 }}>← Jobs</button>
          </Link>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Company Profile</div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, maxWidth: 560 }}>

        {/* Logo */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 14 }}>
            Company Logo
          </div>

          {profile.logo_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ position: 'relative', width: 120, height: 60, background: 'var(--surface-2)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <Image src={profile.logo_url} alt="Company logo" fill style={{ objectFit: 'contain', padding: 8 }} unoptimized />
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Logo uploaded</div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => logoRef.current?.click()}
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                className="btn btn-secondary"
                onClick={() => logoRef.current?.click()}
                disabled={uploadingLogo}
                style={{ width: '100%', padding: 20, borderStyle: 'dashed', fontSize: 14 }}
              >
                {uploadingLogo ? <><span className="spinner" /> Uploading...</> : '🖼 Upload Logo'}
              </button>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                PNG or SVG recommended — appears on all generated documents
              </div>
            </div>
          )}

          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) uploadLogo(file)
            }}
          />
        </div>

        {/* Company details */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 14 }}>
            Company Details
          </div>
          {field('Company Name', 'name', 'Brisbane Biohazard Cleaning')}
          {field('Tagline', 'tagline', 'Professional Biohazard Remediation Services')}
          {field('ABN', 'abn', '12 345 678 901')}
          {field('Licence Number', 'licence', 'QLD Biohazard Licence #')}
        </div>

        {/* Contact */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 14 }}>
            Contact Information
          </div>
          {field('Phone', 'phone', '07 xxxx xxxx')}
          {field('Email', 'email', 'info@example.com.au')}
          {field('Address', 'address', 'Brisbane, QLD')}
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#F87171', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={save}
          disabled={saving}
          style={{ width: '100%', fontSize: 16, padding: 14 }}
        >
          {saving ? <><span className="spinner" /> Saving...</> : saved ? '✓ Saved' : 'Save Profile'}
        </button>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16, textAlign: 'center' }}>
          These details appear on every generated Quote, SOW and Report
        </div>
      </div>
    </div>
  )
}
