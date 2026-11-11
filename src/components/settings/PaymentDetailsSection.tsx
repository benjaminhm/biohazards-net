/*
 * components/settings/PaymentDetailsSection.tsx
 *
 * The bank account clients are told to pay into. Shown to a client on the pay
 * step, after they sign a quote, next to the deposit amount.
 *
 * Admins only: the section is hidden for everyone else (the API refuses them),
 * because changing these details changes where clients send money.
 */
'use client'

import { useEffect, useState } from 'react'

interface BankDetails {
  accountName: string
  bsb: string
  accountNumber: string
}

const EMPTY: BankDetails = { accountName: '', bsb: '', accountNumber: '' }

export default function PaymentDetailsSection() {
  const [form, setForm] = useState<BankDetails>(EMPTY)
  const [saved, setSaved] = useState<BankDetails | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/payment-details')
      .then(async r => {
        if (cancelled) return
        if (!r.ok) { setHidden(true); return }
        const data = (await r.json()) as { details: BankDetails | null; updatedAt: string | null }
        setSaved(data.details)
        setForm(data.details ?? EMPTY)
        setUpdatedAt(data.updatedAt)
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setHidden(true) })
    return () => { cancelled = true }
  }, [])

  if (hidden) return null

  const changed =
    form.accountName.trim() !== (saved?.accountName ?? '') ||
    form.bsb.trim() !== (saved?.bsb ?? '') ||
    form.accountNumber.trim() !== (saved?.accountNumber ?? '')
  const empty = !form.accountName.trim() && !form.bsb.trim() && !form.accountNumber.trim()

  async function save() {
    if (busy || !changed) return
    if (saved && !confirm(
      empty
        ? 'Remove the bank details? Clients will no longer see bank transfer details after signing.'
        : 'Change the bank details? Every client who opens their pay step from now on will be told to pay into the new account.',
    )) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await fetch('/api/payment-details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error ?? 'Could not save')
      setSaved(data.details ?? null)
      setForm(data.details ?? EMPTY)
      setUpdatedAt(data.updatedAt ?? null)
      setNotice(data.details ? 'Saved.' : 'Bank details removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const input = (label: string, key: keyof BankDetails, placeholder: string, inputMode: 'text' | 'numeric') => (
    <div className="field" style={{ flex: key === 'accountName' ? '1 1 100%' : '1 1 160px' }}>
      <label htmlFor={`pay-${key}`}>{label}</label>
      <input
        id={`pay-${key}`}
        value={form[key]}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        maxLength={key === 'accountName' ? 80 : 14}
        onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setNotice(''); setError('') }}
      />
    </div>
  )

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>
        Payment details
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        The bank account clients pay their deposit into. After a client signs a quote, their page shows the deposit, these
        details and the quote reference to put on the transfer. Only admins can see or change this.
      </div>

      {!loaded ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {input('Account name', 'accountName', 'Name on the account', 'text')}
            {input('BSB', 'bsb', '000-000', 'numeric')}
            {input('Account number', 'accountNumber', '12345678', 'numeric')}
          </div>
          {!saved && (
            <div style={{ fontSize: 12, color: '#FBBF24', marginBottom: 10, lineHeight: 1.5 }}>
              No bank details are saved, so clients are not shown bank transfer details after signing.
            </div>
          )}
          {error && <div role="alert" style={{ fontSize: 12, color: '#F87171', marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !changed} style={{ fontSize: 13, padding: '8px 16px' }}>
              {busy ? 'Saving…' : 'Save payment details'}
            </button>
            {notice && <span style={{ fontSize: 12, color: '#4ADE80' }}>{notice}</span>}
            {saved && updatedAt && !notice && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Last changed {new Date(updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
