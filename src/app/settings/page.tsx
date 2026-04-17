/*
 * app/settings/page.tsx
 *
 * Company settings page — admin-only. Manages the company's CompanyProfile
 * record plus the document_rules system that controls how Claude writes documents.
 *
 * Two sections:
 *
 * 1. Company Profile
 *    - Basic info: name, ABN, phone, email, address, tagline, licence, website.
 *    - Logo upload via signed URL pattern (POST /api/company/logo → PUT to Storage).
 *    - Saved via PATCH /api/company. PGRST116 (no row) is handled by upsert on the server.
 *
 * 2. Document Rules (AI Instructions)
 *    - RULE_TABS maps to each document type plus a "General" tab.
 *    - Each tab has a free-text instruction field stored in company.document_rules[docType].
 *    - The "general" tab stores baseline instructions injected into every generation prompt.
 *    - Per-document-type tabs let admins override Claude's tone, structure, and content
 *      for that specific document (e.g. "for reports always include a risk matrix").
 *    - A style guide PDF can be uploaded per doc type; it's base64-fetched by
 *      /api/build-document and passed to Claude as a vision input for format matching.
 *
 * Admin management (promote/demote) is also shown here via GET/DELETE /api/admins.
 * ConfirmDeleteModal guards the demote action for the last-admin check UX.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { CompanyProfile, DocType } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { useUser } from '@/lib/userContext'
import { getPublicWebsiteLaunchChecks, isPublicWebsiteLaunchReady } from '@/lib/websiteLaunchReadiness'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import EquipmentCatalogueSection from '@/components/settings/EquipmentCatalogueSection'

interface Admin { id: string; clerk_user_id: string; name: string; email: string }

const RULE_TABS: { id: string; label: string }[] = [
  { id: 'general', label: 'General' },
  ...Object.entries(DOC_TYPE_LABELS).map(([id, label]) => ({ id, label })),
]

const DEFAULT_GENERAL_RULES = `You are writing documents for an Australian biohazard remediation company. Always:
- Use a confident, professional tone — no fluff or filler language
- Be specific to the actual job, site, and client — never generic
- Reference Australian standards, legislation and geography where relevant
- Use Australian spelling (e.g. organisation, colour, authorise)
- Keep language clear and direct — this is a professional services business`

const DEFAULT_PROFILE: Omit<CompanyProfile, 'id' | 'updated_at'> = {
  name: 'Company',
  abn: '',
  phone: '',
  email: '',
  address: '',
  licence: '',
  tagline: '',
  logo_url: null,
  subdomain: '',
  custom_domain: '',
  document_rules: { general: DEFAULT_GENERAL_RULES },
}

export default function SettingsPage() {
  const { userId } = useUser()
  const [profile, setProfile] = useState<typeof DEFAULT_PROFILE>(DEFAULT_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState('')
  const [activeRuleTab, setActiveRuleTab] = useState('general')
  const logoRef = useRef<HTMLInputElement>(null)

  // Administrators
  // Website launch state
  const [servicesText, setServicesText]   = useState('')   // one service per line
  const [areasText, setAreasText]         = useState('')   // one area per line
  const [websiteLive, setWebsiteLive]     = useState(false)
  const [launching, setLaunching]         = useState(false)
  const [launchDone, setLaunchDone]       = useState(false)

  const [admins, setAdmins]             = useState<Admin[]>([])
  const [removingId, setRemovingId]     = useState<string | null>(null)
  const [confirmAdmin, setConfirmAdmin] = useState<Admin | null>(null)
  const [adminError, setAdminError]     = useState('')
  const [inviteLink, setInviteLink]     = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [generatingInvite, setGeneratingInvite] = useState(false)

  useEffect(() => {
    fetch('/api/admins').then(r => r.json()).then(d => setAdmins(d.admins ?? []))
  }, [])

  async function removeAdmin(orgUserId: string) {
    setAdminError('')
    setRemovingId(orgUserId)
    const res = await fetch('/api/admins', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgUserId }),
    })
    const data = await res.json()
    if (data.error) {
      setAdminError(data.error)
    } else {
      setAdmins(a => a.filter(x => x.id !== orgUserId))
    }
    setRemovingId(null)
  }

  async function generateAdminInvite() {
    setGeneratingInvite(true)
    setInviteLink('')
    setInviteCopied(false)
    const res = await fetch('/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    const data = await res.json()
    if (data.token) setInviteLink(`${window.location.origin}/invite/${data.token}`)
    setGeneratingInvite(false)
  }

  function copyAdminInvite() {
    navigator.clipboard.writeText(inviteLink)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

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
            subdomain: data.company.subdomain ?? '',
            custom_domain: data.company.custom_domain ?? '',
            document_rules: data.company.document_rules ?? DEFAULT_PROFILE.document_rules,
          })
          // Load website fields — stored as arrays, edited as line-separated text
          if (Array.isArray(data.company.services)) {
            setServicesText((data.company.services as string[]).join('\n'))
          }
          if (Array.isArray(data.company.areas_served)) {
            setAreasText((data.company.areas_served as string[]).join('\n'))
          }
          setWebsiteLive(data.company.website_live ?? false)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    try {
      // Convert line-separated text back to arrays for services / areas
      const services = servicesText.split('\n').map(s => s.trim()).filter(Boolean)
      const areas_served = areasText.split('\n').map(s => s.trim()).filter(Boolean)

      const res = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, services, areas_served }),
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

  async function launchWebsite() {
    setLaunching(true)
    try {
      // Save latest services/areas then flip website_live
      const services = servicesText.split('\n').map(s => s.trim()).filter(Boolean)
      const areas_served = areasText.split('\n').map(s => s.trim()).filter(Boolean)
      await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, services, areas_served, website_live: true }),
      })
      setWebsiteLive(true)
      setLaunchDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Launch failed')
    } finally {
      setLaunching(false)
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
        <div data-devid="P4-E2" className="card" style={{ marginBottom: 24 }}>
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
        <div data-devid="P4-E1" className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 14 }}>
            Company Details
          </div>
          {field('Company Name', 'name', 'Your company name')}
          {field('Tagline', 'tagline', 'Short line under your name on documents and PDFs')}
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

        {/* Document Instructions */}
        <div data-devid="P4-E3" className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>
            Document Instructions
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            Claude reads these every time it generates or edits a document. You can also edit these live on the editor page via the <strong>📋 Instructions</strong> button.
          </div>

          {/* Tab row — scrollable */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, scrollbarWidth: 'none' }}>
            {RULE_TABS.map(tab => {
              const hasInstructions = !!profile.document_rules?.[tab.id]
              const hasPdf = tab.id !== 'general' && !!profile.document_rules?.[tab.id + '_pdf']
              const hasTemplateJson = tab.id !== 'general' && !!profile.document_rules?.[`${tab.id}_template_json`]
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveRuleTab(tab.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap',
                    border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0,
                    background: activeRuleTab === tab.id ? 'var(--accent)' : 'var(--bg)',
                    color: activeRuleTab === tab.id ? '#fff' : 'var(--text-muted)',
                    fontWeight: activeRuleTab === tab.id ? 700 : 400,
                  }}
                >
                  {tab.label}
                  {hasInstructions ? ' ●' : ''}{hasPdf ? ' 📄' : ''}{hasTemplateJson ? ' {}' : ''}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {activeRuleTab === 'general'
              ? 'Applied to ALL document types — voice, tone, Australian spelling, formatting preferences'
              : `${DOC_TYPE_LABELS[activeRuleTab as DocType] ?? activeRuleTab} Instructions — only applied to this document type`}
          </div>

          <textarea
            value={profile.document_rules?.[activeRuleTab] ?? ''}
            onChange={e => setProfile(p => ({
              ...p,
              document_rules: { ...(p.document_rules ?? {}), [activeRuleTab]: e.target.value },
            }))}
            placeholder={activeRuleTab === 'general'
              ? 'e.g. Always use Australian spelling. Never use filler phrases. Confident, direct tone…'
              : `What should Claude always do for every ${DOC_TYPE_LABELS[activeRuleTab as DocType] ?? activeRuleTab}?\n\ne.g. Always break into line items per area. Never go under $2,500…`}
            rows={9}
            style={{
              width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.6,
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', color: 'var(--text)',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />

          {activeRuleTab !== 'general' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Template JSON (optional)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Structured hints (valid JSON). No PDF required. Same keys as in the job document editor Instructions panel.
              </div>
              <textarea
                value={profile.document_rules?.[`${activeRuleTab}_template_json`] ?? ''}
                onChange={e => setProfile(p => ({
                  ...p,
                  document_rules: { ...(p.document_rules ?? {}), [`${activeRuleTab}_template_json`]: e.target.value },
                }))}
                placeholder={'{\n  "tone": "insurer_formal",\n  "must_mention": ["chain of custody"]\n}'}
                rows={6}
                spellCheck={false}
                style={{
                  width: '100%', resize: 'vertical', fontSize: 12, lineHeight: 1.5,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px', color: 'var(--text)',
                  fontFamily: 'ui-monospace, monospace', boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {activeRuleTab !== 'general' && profile.document_rules?.[activeRuleTab + '_pdf'] && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <span>📄</span>
              <span style={{ flex: 1 }}>Style guide PDF uploaded for this doc type</span>
              <button
                onClick={() => setProfile(p => {
                  const dr = { ...(p.document_rules ?? {}) }
                  delete dr[activeRuleTab + '_pdf']
                  return { ...p, document_rules: dr }
                })}
                style={{ color: '#F87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                Remove
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            💡 To upload a style guide PDF, open the document editor and click <strong>📋 Instructions</strong>
          </div>
        </div>

        {/* ── Equipment catalogue ── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <EquipmentCatalogueSection />
        </div>

        {/* ── Website ── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              Public Website
            </div>
            {websiteLive && (
              <a
                href={`https://${profile.subdomain || 'your-company'}.biohazards.net`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#4ADE80', fontWeight: 700, textDecoration: 'none' }}
              >
                ● Live ↗
              </a>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            {websiteLive
              ? `Your website is live at ${profile.subdomain || 'your-company'}.biohazards.net`
              : 'Complete all fields below then launch your public website. Clients can find you, see your services, and request a callback.'}
          </div>

          {/* Checklist — same rules as Website Dashboard (lib/websiteLaunchReadiness) */}
          {!websiteLive && (() => {
            const checks = getPublicWebsiteLaunchChecks({
              name: profile.name,
              phone: profile.phone,
              email: profile.email,
              tagline: profile.tagline,
              services: servicesText.split('\n').map(s => s.trim()).filter(Boolean),
              areas_served: areasText.split('\n').map(s => s.trim()).filter(Boolean),
            })
            const allDone = isPublicWebsiteLaunchReady(checks)
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {checks.map(c => (
                    <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ fontSize: 14, color: c.ok ? '#4ADE80' : 'var(--text-dim)' }}>
                        {c.ok ? '✓' : '○'}
                      </span>
                      <span style={{ color: c.ok ? 'var(--text)' : 'var(--text-muted)' }}>{c.label}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={launchWebsite}
                  disabled={!allDone || launching}
                  style={{
                    width: '100%', padding: '13px', borderRadius: 10, border: 'none',
                    background: allDone ? '#4ADE80' : 'var(--surface-2)',
                    color: allDone ? '#111' : 'var(--text-dim)',
                    fontWeight: 800, fontSize: 15, cursor: allDone ? 'pointer' : 'not-allowed',
                    opacity: launching ? 0.7 : 1, transition: 'all 0.15s',
                  }}
                >
                  {launching ? '🚀 Launching…' : launchDone ? '✓ Website Launched!' : '🚀 Launch Website'}
                </button>
              </div>
            )
          })()}

          {/* Services */}
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Services <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(one per line)</span></label>
            <textarea
              value={servicesText}
              onChange={e => setServicesText(e.target.value)}
              placeholder={'Biohazard Cleaning\nCrime Scene & Trauma Cleanup\nUnattended Death Restoration\nForensic Cleaning\nSewage Cleaning'}
              rows={5}
              style={{ width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>

          {/* Areas served */}
          <div className="field">
            <label>Areas Served <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(one per line)</span></label>
            <textarea
              value={areasText}
              onChange={e => setAreasText(e.target.value)}
              placeholder={'Brisbane\nLogan\nGold Coast\nIpswich\nMoreton Bay'}
              rows={4}
              style={{ width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Administrators */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 14 }}>
            Administrators
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {admins.map(admin => {
              const isYou = admin.clerk_user_id === userId
              const isOnly = admins.length === 1
              const initials = admin.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
              return (
                <div key={admin.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--accent)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13,
                  }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{admin.name}</span>
                      {isYou && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,107,53,0.15)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>You</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{admin.email}</div>
                  </div>
                  {isOnly ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', flexShrink: 0 }}>Locked</span>
                  ) : (
                    <button
                      onClick={() => setConfirmAdmin(admin)}
                      disabled={removingId === admin.id}
                      style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)', background: 'none', color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {adminError && (
            <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12 }}>{adminError}</div>
          )}

          {/* Invite new admin */}
          {!inviteLink ? (
            <button onClick={generateAdminInvite} disabled={generatingInvite}
              style={{ width: '100%', padding: '11px', borderRadius: 10, border: '1px dashed var(--border)', background: 'none', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: generatingInvite ? 0.6 : 1 }}>
              {generatingInvite ? 'Generating…' : '+ Invite Administrator'}
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Send this link — expires in 7 days, single use</div>
              <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', color: '#111', fontSize: 12, wordBreak: 'break-all', userSelect: 'text', marginBottom: 8 }}>
                {inviteLink}
              </div>
              <button onClick={copyAdminInvite}
                style={{ width: '100%', padding: '11px', borderRadius: 10, background: inviteCopied ? '#10B981' : 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {inviteCopied ? '✓ Copied' : '📋 Copy Link'}
              </button>
            </div>
          )}
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

      {confirmAdmin && (
        <ConfirmDeleteModal
          title={`Remove ${confirmAdmin.name} as Administrator?`}
          description="They will be demoted to Team Member. You can re-promote them at any time from their profile."
          confirmName={confirmAdmin.name}
          onConfirm={async () => {
            await removeAdmin(confirmAdmin.id)
            setConfirmAdmin(null)
          }}
          onCancel={() => setConfirmAdmin(null)}
        />
      )}
    </div>
  )
}
