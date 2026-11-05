/*
 * components/settings/XeroSection.tsx
 *
 * Connect / disconnect Xero for the org (admins only; hidden for everyone
 * else). Once connected, every accepted quote lands on the job's one draft
 * invoice in Xero, which staff approve and send from Xero.
 */
'use client'

import { useEffect, useState } from 'react'

interface XeroStatus {
  configured: boolean
  connected: boolean
  tenant_name: string | null
  connected_at: string | null
  redirect_uri: string
}

export default function XeroSection() {
  const [status, setStatus] = useState<XeroStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('xero')
    if (result === 'connected') setNotice('Xero connected.')
    else if (result === 'not_configured') setNotice('Xero app keys are not set on the server yet.')
    else if (result === 'error') setNotice(`Xero connection failed${params.get('reason') ? `: ${params.get('reason')}` : '.'}`)

    let cancelled = false
    fetch('/api/xero')
      .then(async r => {
        if (cancelled) return
        if (!r.ok) { setHidden(true); return }
        setStatus(await r.json())
      })
      .catch(() => { if (!cancelled) setHidden(true) })
    return () => { cancelled = true }
  }, [])

  async function disconnect() {
    if (!confirm('Disconnect Xero? New acceptances will stop creating draft invoices until you reconnect.')) return
    setBusy(true)
    try {
      const r = await fetch('/api/xero', { method: 'DELETE' })
      if (r.ok) {
        setStatus(s => s && { ...s, connected: false, tenant_name: null, connected_at: null })
        setNotice('Xero disconnected.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (hidden) return null

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>
        Xero
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        When a client accepts a quote, the job&apos;s draft invoice in Xero is created or updated with every accepted quote on the job.
        Nothing is sent from here: approve the invoice and request the deposit in Xero.
      </div>

      {notice && (
        <div style={{ fontSize: 12, marginBottom: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          {notice}
        </div>
      )}

      {!status ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : status.connected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#4ADE80', fontWeight: 700 }}>
            ● Connected{status.tenant_name ? ` to ${status.tenant_name}` : ''}
          </span>
          {status.connected_at && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              since {new Date(status.connected_at).toLocaleDateString('en-AU')}
            </span>
          )}
          <button
            onClick={disconnect}
            disabled={busy}
            style={{ marginLeft: 'auto', color: '#F87171', background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}
          >
            Disconnect
          </button>
        </div>
      ) : status.configured ? (
        <a
          href="/api/xero/connect"
          style={{ display: 'inline-block', background: 'var(--accent)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
        >
          Connect Xero
        </a>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Xero app keys are not set. Add XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_TOKEN_KEY in Vercel, and register
          <code style={{ margin: '0 4px' }}>{status.redirect_uri}</code>
          as the redirect URI in the Xero developer app.
        </div>
      )}
    </div>
  )
}
