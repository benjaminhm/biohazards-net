/*
 * app/accounts/page.tsx
 *
 * Trade Accounts manager — the staff view of commercial accounts.
 *
 * An account is a company we invoice repeatedly. Its contacts sign in at
 * accounts.<brand>.com.au to accept quotes and download reports, so this screen
 * is where staff create accounts, invite contacts, and see whether the standing
 * Terms & Conditions have been accepted.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { TRADING_NAME_OPTIONS } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'
import type { ClientAccount, ClientAccountContact } from '@/lib/types'

interface AccountRow extends ClientAccount {
  contacts: Pick<ClientAccountContact, 'id' | 'name' | 'email' | 'status' | 'last_login_at'>[]
  job_count: number
  terms_current: boolean
}

const BRAND_LABELS: Record<string, string> = Object.fromEntries(
  TRADING_NAME_OPTIONS.map(o => [o.id, o.label])
)

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/accounts', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not load accounts')
      setAccounts(data.accounts ?? [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(a =>
      [a.legal_name, a.trading_as, a.abn, a.billing_email, ...a.contacts.map(c => c.email)]
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [accounts, search])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="container" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
          <div>
            <Link href="/" className="eyebrow" style={{ color: 'var(--accent)' }}>
              ← Dashboard
            </Link>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 8 }}>
              Trade Accounts
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 6 }}>
              Commercial accounts with portal access. Contacts sign in by emailed link — no passwords.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ flexShrink: 0 }}>
            + New account
          </button>
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by company, ABN or contact email…"
          style={{ marginBottom: 20 }}
        />

        {error && (
          <div className="card" style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#F87171', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            {accounts.length === 0
              ? 'No trade accounts yet. Create one, then invite their first contact.'
              : 'No accounts match that search.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {filtered.map(account => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateAccountModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function AccountCard({ account }: { account: AccountRow }) {
  const activeContacts = account.contacts.filter(c => c.status === 'active')
  const everSignedIn = activeContacts.some(c => c.last_login_at)

  return (
    <Link href={`/accounts/${account.id}`} className="card" style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {account.trading_as || account.legal_name}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {BRAND_LABELS[account.trading_name] ?? account.trading_name}
            {account.abn ? ` · ABN ${account.abn}` : ''}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            {activeContacts.length} {activeContacts.length === 1 ? 'contact' : 'contacts'} ·{' '}
            {account.job_count} {account.job_count === 1 ? 'job' : 'jobs'}
            {!everSignedIn && activeContacts.length > 0 ? ' · never signed in' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
          {account.status !== 'active' && (
            <span className="badge" style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171' }}>
              {account.status}
            </span>
          )}
          {account.application_submitted_at && (
            <span className="badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
              Awaiting review
            </span>
          )}
          <span
            className="badge"
            style={
              account.terms_current
                ? { background: 'rgba(34,197,94,0.12)', color: '#4ADE80' }
                : { background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }
            }
          >
            {account.terms_current ? 'Terms signed' : 'Terms pending'}
          </span>
        </div>
      </div>
    </Link>
  )
}

function CreateAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [legalName, setLegalName] = useState('')
  const [tradingAs, setTradingAs] = useState('')
  const [abn, setAbn] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [tradingName, setTradingName] = useState<TradingNameId>(TRADING_NAME_OPTIONS[0].id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_name: legalName,
          trading_as: tradingAs,
          abn,
          billing_email: billingEmail,
          trading_name: tradingName,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not create account')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 100,
      }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="card"
        style={{ width: '100%', maxWidth: 460, padding: 24, background: 'var(--surface)' }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>New trade account</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          You can add contacts and invite them once the account exists.
        </p>

        {error && (
          <div style={{ color: '#F87171', fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        <div className="field">
          <label htmlFor="acc-brand">Trading brand</label>
          <select id="acc-brand" value={tradingName} onChange={e => setTradingName(e.target.value as TradingNameId)}>
            {TRADING_NAME_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="acc-legal">Legal name</label>
          <input
            id="acc-legal"
            required
            autoFocus
            value={legalName}
            onChange={e => setLegalName(e.target.value)}
            placeholder="Example Property Group Pty Ltd"
          />
        </div>

        <div className="field">
          <label htmlFor="acc-trading">Trading as (optional)</label>
          <input
            id="acc-trading"
            value={tradingAs}
            onChange={e => setTradingAs(e.target.value)}
            placeholder="Example Property"
          />
        </div>

        <div className="field">
          <label htmlFor="acc-abn">ABN (optional)</label>
          <input id="acc-abn" value={abn} onChange={e => setAbn(e.target.value)} placeholder="12 345 678 901" />
        </div>

        <div className="field">
          <label htmlFor="acc-billing">Accounts payable email (optional)</label>
          <input
            id="acc-billing"
            type="email"
            value={billingEmail}
            onChange={e => setBillingEmail(e.target.value)}
            placeholder="accounts@company.com.au"
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  )
}
