/*
 * app/website/page.tsx
 *
 * Website Dashboard — edit launch fields, AI generate stub, publish (orgs.features.website_card).
 */
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useUser } from '@/lib/userContext'
import { getPublicWebsiteLaunchChecks, isPublicWebsiteLaunchReady } from '@/lib/websiteLaunchReadiness'

type CompanyRow = Record<string, unknown> | null

function buildCompanyPatch(
  company: CompanyRow,
  form: {
    name: string
    phone: string
    email: string
    tagline: string
    servicesText: string
    areasText: string
  },
  website_live?: boolean
) {
  const services = form.servicesText.split('\n').map(s => s.trim()).filter(Boolean)
  const areas_served = form.areasText.split('\n').map(s => s.trim()).filter(Boolean)
  const c = company ?? {}
  return {
    name: form.name.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    tagline: form.tagline.trim(),
    abn: String(c.abn ?? ''),
    address: String(c.address ?? ''),
    licence: String(c.licence ?? ''),
    logo_url: c.logo_url ?? null,
    subdomain: String(c.subdomain ?? ''),
    custom_domain: String(c.custom_domain ?? ''),
    document_rules: c.document_rules,
    services,
    areas_served,
    ...(website_live !== undefined ? { website_live } : {}),
  }
}

export default function WebsitePage() {
  const { org, loading: userLoading } = useUser()
  const enabled = org?.features?.website_card === true

  const [company, setCompany] = useState<CompanyRow>(null)
  const [loadingCompany, setLoadingCompany] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [tagline, setTagline] = useState('')
  const [servicesText, setServicesText] = useState('')
  const [areasText, setAreasText] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk, setSaveOk] = useState(false)

  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState('')

  const loadCompany = useCallback(async () => {
    setLoadingCompany(true)
    try {
      const res = await fetch('/api/company')
      const data = await res.json()
      const row = (data.company ?? null) as CompanyRow
      setCompany(row)
      if (row) {
        setName(String(row.name ?? ''))
        setPhone(String(row.phone ?? ''))
        setEmail(String(row.email ?? ''))
        setTagline(String(row.tagline ?? ''))
        const services = row.services
        const areas = row.areas_served
        setServicesText(Array.isArray(services) ? services.map(s => String(s)).join('\n') : '')
        setAreasText(Array.isArray(areas) ? areas.map(a => String(a)).join('\n') : '')
      }
    } catch {
      setCompany(null)
    } finally {
      setLoadingCompany(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) void loadCompany()
  }, [enabled, loadCompany])

  const checks = useMemo(
    () =>
      getPublicWebsiteLaunchChecks({
        name,
        phone,
        email,
        tagline,
        services: servicesText.split('\n').map(s => s.trim()).filter(Boolean),
        areas_served: areasText.split('\n').map(s => s.trim()).filter(Boolean),
      }),
    [name, phone, email, tagline, servicesText, areasText]
  )
  const launchReady = isPublicWebsiteLaunchReady(checks)
  const websiteLive = company?.website_live === true
  const subdomain = String(company?.subdomain ?? '').trim() || 'your-company'
  const publicUrl = `https://${subdomain}.biohazards.net`

  async function handleSaveDetails() {
    setSaving(true)
    setSaveError('')
    setSaveOk(false)
    try {
      const body = buildCompanyPatch(company, { name, phone, email, tagline, servicesText, areasText })
      const res = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Save failed')
      setCompany(data.company ?? company)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleLaunch() {
    if (!launchReady) return
    setLaunching(true)
    setLaunchError('')
    try {
      const genRes = await fetch('/api/website/generate', { method: 'POST' })
      const genData = await genRes.json().catch(() => ({}))
      if (!genRes.ok) {
        throw new Error(typeof genData.error === 'string' ? genData.error : 'AI generation step failed')
      }

      const body = buildCompanyPatch(company, { name, phone, email, tagline, servicesText, areasText }, true)
      const res = await fetch('/api/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Launch failed')
      setCompany(data.company ?? company)
    } catch (e: unknown) {
      setLaunchError(e instanceof Error ? e.message : 'Launch failed')
    } finally {
      setLaunching(false)
    }
  }

  const showGate = !userLoading && org && !enabled

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 14,
    fontFamily: 'inherit',
  }

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-dim)',
    marginBottom: 6,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: '24px 20px 48px', maxWidth: 900, margin: '0 auto' }}>
      <Link
        href="/"
        style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}
      >
        ← Dashboard
      </Link>

      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 }}>
        Website Dashboard
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 28, maxWidth: 640 }}>
        Build and launch your public presence on biohazards.net, then add domains, email, and growth services.
      </p>

      {showGate ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          The Website Dashboard is not enabled for your organisation. Contact your platform administrator if you need access.
        </p>
      ) : loadingCompany && enabled ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</p>
      ) : (
        <>
          {/* ── Live status ── */}
          <section style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
              Public site
            </div>
            {websiteLive ? (
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: 14,
                  border: '1px solid rgba(34,197,94,0.35)',
                  background: 'rgba(34,197,94,0.08)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#4ADE80' }}>● Live</div>
                <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 14, wordBreak: 'break-all' }}>
                  {publicUrl} ↗
                </a>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
                  Edit branding, document rules, and full profile in{' '}
                  <Link href="/settings" style={{ color: 'var(--accent)' }}>Settings</Link>
                  . Use the fields below anytime to update the copy that feeds your public pages.
                </p>
              </div>
            ) : null}

            {!websiteLive && (
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}
              >
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text)' }}>Launch</strong> runs the AI pipeline (stub today), then publishes your profile to{' '}
                  <strong style={{ color: 'var(--text)' }}>{subdomain}.biohazards.net</strong>. Save your details first, complete the checklist, then launch.
                </p>

                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>
                  Launch details
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>Company name</label>
                    <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Business name" />
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+61…" />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="hello@…" />
                  </div>
                  <div>
                    <label style={labelStyle}>Tagline</label>
                    <input style={inputStyle} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Short line under your name" />
                  </div>
                  <div>
                    <label style={labelStyle}>Services (one per line)</label>
                    <textarea
                      value={servicesText}
                      onChange={e => setServicesText(e.target.value)}
                      rows={5}
                      placeholder={'Biohazard cleaning\nTrauma cleanup\n…'}
                      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Areas served (one per line)</label>
                    <textarea
                      value={areasText}
                      onChange={e => setAreasText(e.target.value)}
                      rows={4}
                      placeholder={'Brisbane\nGold Coast\n…'}
                      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                    />
                  </div>
                </div>

                {saveError ? <p style={{ fontSize: 13, color: '#F87171', marginBottom: 10 }}>{saveError}</p> : null}
                {saveOk ? <p style={{ fontSize: 13, color: '#4ADE80', marginBottom: 10 }}>Saved.</p> : null}

                <button
                  type="button"
                  onClick={() => void handleSaveDetails()}
                  disabled={saving}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: '1px solid var(--border-2)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: saving ? 'wait' : 'pointer',
                    marginBottom: 22,
                  }}
                >
                  {saving ? 'Saving…' : 'Save details'}
                </button>

                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Launch checklist
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {checks.map(c => (
                    <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ fontSize: 14, color: c.ok ? '#4ADE80' : 'var(--text-dim)' }}>{c.ok ? '✓' : '○'}</span>
                      <span style={{ color: c.ok ? 'var(--text)' : 'var(--text-muted)' }}>{c.label}</span>
                    </div>
                  ))}
                </div>

                {!launchReady && (
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
                    Complete the fields above, or finish in{' '}
                    <Link href="/settings" style={{ color: 'var(--accent)', fontWeight: 600 }}>Settings</Link>.
                  </p>
                )}

                {launchError ? (
                  <p style={{ fontSize: 13, color: '#F87171', marginBottom: 12 }}>{launchError}</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleLaunch()}
                  disabled={!launchReady || launching}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    borderRadius: 10,
                    border: 'none',
                    background: launchReady ? '#4ADE80' : 'var(--surface-2)',
                    color: launchReady ? '#111' : 'var(--text-dim)',
                    fontWeight: 800,
                    fontSize: 15,
                    cursor: launchReady ? 'pointer' : 'not-allowed',
                    opacity: launching ? 0.75 : 1,
                  }}
                >
                  {launching ? 'Generating & launching…' : '🚀 Launch Website'}
                </button>
              </div>
            )}
          </section>

          {/* When live: still allow quick edits */}
          {websiteLive && (
            <section style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>
                Update public copy
              </div>
              <div style={{ padding: '18px 20px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>Company name</label>
                    <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Tagline</label>
                    <input style={inputStyle} value={tagline} onChange={e => setTagline(e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Services (one per line)</label>
                    <textarea value={servicesText} onChange={e => setServicesText(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Areas served (one per line)</label>
                    <textarea value={areasText} onChange={e => setAreasText(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
                  </div>
                </div>
                {saveError ? <p style={{ fontSize: 13, color: '#F87171', marginBottom: 10 }}>{saveError}</p> : null}
                {saveOk ? <p style={{ fontSize: 13, color: '#4ADE80', marginBottom: 10 }}>Saved.</p> : null}
                <button
                  type="button"
                  onClick={() => void handleSaveDetails()}
                  disabled={saving}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: '1px solid var(--border-2)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: saving ? 'wait' : 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : 'Save public copy'}
                </button>
              </div>
            </section>
          )}

          {/* ── Analytics (placeholder) ── */}
          <section style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
              Performance
            </div>
            <div
              style={{
                padding: '20px',
                borderRadius: 14,
                border: '1px dashed var(--border)',
                background: 'var(--surface)',
                opacity: 0.9,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Visitors &amp; conversions</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                Charts for sessions, goals, and leads will appear here when analytics APIs are connected (e.g. GA4, Plausible, or edge analytics).
              </p>
            </div>
          </section>

          {/* ── Upsells (rough) ── */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>
              Grow your presence
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              <UpsellCard
                icon="🌐"
                title="Your own domain"
                subtitle="Buy and connect a custom domain — reseller or Cloudflare path TBD."
                stripe="#06B6D4"
              />
              <UpsellCard
                icon="✉"
                title="Professional email"
                subtitle="Branded inboxes (e.g. hello@yourbusiness.com) — setup and billing TBD."
                stripe="#8B5CF6"
              />
              <UpsellCard
                icon="📣"
                title="Google Ads management"
                subtitle="Campaign setup, optimisation, and reporting — service packages TBD."
                stripe="#EA580C"
              />
              <UpsellCard
                icon="🔍"
                title="SEO"
                subtitle="On-page and local SEO retainers — scope and pricing TBD."
                stripe="#22C55E"
              />
              <UpsellCard
                icon="📍"
                title="Google Business Profile"
                subtitle="GBP setup, posts, reviews, and citation building — bundles TBD."
                stripe="#3B82F6"
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function UpsellCard({
  icon,
  title,
  subtitle,
  stripe,
}: {
  icon: string
  title: string
  subtitle: string
  stripe: string
}) {
  return (
    <div
      style={{
        position: 'relative',
        padding: '16px 16px 14px',
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
        minHeight: 120,
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: stripe, opacity: 0.85 }} />
      <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, margin: 0 }}>{subtitle}</p>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, fontWeight: 600 }}>Coming soon</div>
    </div>
  )
}
