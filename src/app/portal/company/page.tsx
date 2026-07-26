/*
 * app/portal/company/page.tsx
 *
 * The client's own company profile. Keeping this accurate is why it lives with
 * the client rather than with our staff: they know their registered name, ABN and
 * accounts payable inbox better than we do, and correct details here flow onto
 * quotes and invoices.
 */
'use client'

import { useEffect, useState } from 'react'
import { usePortal } from '@/components/portal/PortalContext'
import {
  MUTED,
  Notice,
  buttonStyle,
  card,
  eyebrow,
  h1,
  input,
  label,
  meta,
} from '@/components/portal/portalUi'

export default function PortalCompanyPage() {
  const { me, loading, refresh } = usePortal()
  const [form, setForm] = useState({
    legal_name: '',
    trading_as: '',
    abn: '',
    billing_email: '',
    billing_address: '',
    phone: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!me) return
    setForm({
      legal_name: me.account.legal_name ?? '',
      trading_as: me.account.trading_as ?? '',
      abn: me.account.abn ?? '',
      billing_email: me.account.billing_email ?? '',
      billing_address: me.account.billing_address ?? '',
      phone: me.account.phone ?? '',
    })
  }, [me])

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portal/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not save your details')
      setSaved(true)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !me) return <p style={meta}>Loading…</p>

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={eyebrow}>Your details</div>
      <h1 style={h1}>Company profile</h1>
      <p style={{ ...meta, margin: '10px 0 24px' }}>
        These details appear on your quotes and invoices. Keep them current so our paperwork matches
        your records.
      </p>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Your details have been saved.</Notice>}

      <form onSubmit={save} style={card}>
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="p-legal" style={label}>
            Registered company name
          </label>
          <input
            id="p-legal"
            required
            value={form.legal_name}
            onChange={e => set('legal_name', e.target.value)}
            style={input}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor="p-trading" style={label}>
            Trading as
          </label>
          <input
            id="p-trading"
            value={form.trading_as}
            onChange={e => set('trading_as', e.target.value)}
            style={input}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor="p-abn" style={label}>
            ABN
          </label>
          <input id="p-abn" value={form.abn} onChange={e => set('abn', e.target.value)} style={input} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor="p-phone" style={label}>
            Phone
          </label>
          <input id="p-phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} style={input} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor="p-billing" style={label}>
            Accounts payable email
          </label>
          <input
            id="p-billing"
            type="email"
            value={form.billing_email}
            onChange={e => set('billing_email', e.target.value)}
            placeholder="accounts@yourcompany.com.au"
            style={input}
          />
          <p style={{ ...meta, marginTop: 6, fontSize: 12 }}>Where we send invoices.</p>
        </div>

        <div style={{ marginBottom: 22 }}>
          <label htmlFor="p-address" style={label}>
            Billing address
          </label>
          <textarea
            id="p-address"
            rows={3}
            value={form.billing_address}
            onChange={e => set('billing_address', e.target.value)}
            style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <button type="submit" disabled={saving} style={buttonStyle('primary', saving)}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
      </form>

      <div style={{ ...card, marginTop: 16 }}>
        <div style={label}>Signed in as</div>
        <div style={{ fontSize: 15 }}>
          {me.contact.name}
          {me.contact.title ? ` · ${me.contact.title}` : ''}
        </div>
        <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{me.contact.email}</div>
        <p style={{ ...meta, marginTop: 12, fontSize: 12 }}>
          To add or remove people who can access this account, or to change who can approve quotes,
          contact us at {me.brand.email || 'our office'}.
        </p>
      </div>
    </div>
  )
}
