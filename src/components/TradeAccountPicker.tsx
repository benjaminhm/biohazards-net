/*
 * components/TradeAccountPicker.tsx
 *
 * Links a job to a commercial trade account (jobs.client_account_id).
 *
 * This link is what the accounts portal reads: a trade contact only ever sees
 * jobs whose client_account_id matches their own account. It is set explicitly by
 * staff rather than inferred at read time, so a job is never exposed to a client
 * by accident. The suggestion below is a shortcut for the common case, not an
 * automatic link.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Job } from '@/lib/types'

interface BriefAccount {
  id: string
  legal_name: string
  trading_as: string
  trading_name: string
  /** Organisation domains we know for this account, used for the suggestion. */
  email_domains: string[]
}

interface Props {
  job: Job
  onPatch: (patch: Record<string, unknown>) => Promise<void> | void
  readOnly?: boolean
}

function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? '').trim().toLowerCase().lastIndexOf('@')
  if (at < 0) return null
  return (email ?? '').trim().toLowerCase().slice(at + 1) || null
}

function normalise(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export default function TradeAccountPicker({ job, onPatch, readOnly = false }: Props) {
  const [accounts, setAccounts] = useState<BriefAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [choosing, setChoosing] = useState(false)

  useEffect(() => {
    fetch('/api/accounts?brief=1', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { accounts: [] }))
      .then(d => setAccounts(d.accounts ?? []))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false))
  }, [])

  const linked = accounts.find(a => a.id === job.client_account_id) ?? null

  /*
   * Suggest by the caller's email domain first — an exact organisation domain is
   * strong evidence. Fall back to the organisation name, which is free text and
   * so only matched after normalising away suffixes like "Pty Ltd".
   */
  const suggestion = useMemo(() => {
    if (job.client_account_id) return null

    const jobDomain = domainOf(job.client_email)
    if (jobDomain) {
      const byDomain = accounts.find(a => a.email_domains.includes(jobDomain))
      if (byDomain) return { account: byDomain, reason: `email domain ${jobDomain}` }
    }

    const orgName = normalise(job.client_organization_name)
    if (orgName.length > 2) {
      const byName = accounts.find(
        a => normalise(a.legal_name) === orgName || normalise(a.trading_as) === orgName
      )
      if (byName) return { account: byName, reason: 'organisation name' }
    }

    return null
  }, [accounts, job.client_account_id, job.client_email, job.client_organization_name])

  async function link(accountId: string | null) {
    setSaving(true)
    try {
      await onPatch({ client_account_id: accountId })
      setChoosing(false)
    } finally {
      setSaving(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 4,
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={labelStyle}>Trade account</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>Loading…</div>
          ) : linked ? (
            <div style={{ fontSize: 15 }}>{linked.trading_as || linked.legal_name}</div>
          ) : (
            <div style={{ fontSize: 15, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Not linked
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {linked
              ? 'This job and its released documents are visible in the client’s accounts portal.'
              : 'Link a job to a trade account to make it visible in the client’s accounts portal.'}
          </div>
        </div>

        {!readOnly && !loading && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {linked && (
              <Link
                href={`/accounts/${linked.id}`}
                className="btn btn-ghost"
                style={{ fontSize: 13 }}
              >
                View
              </Link>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: 13 }}
              disabled={saving}
              onClick={() => setChoosing(c => !c)}
            >
              {linked ? 'Change' : 'Link'}
            </button>
          </div>
        )}
      </div>

      {!readOnly && suggestion && !choosing && (
        <div
          style={{
            marginTop: 8,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--accent-dim)',
            border: '1px solid rgba(255,107,53,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 180, fontSize: 13 }}>
            Looks like{' '}
            <strong>{suggestion.account.trading_as || suggestion.account.legal_name}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>({suggestion.reason})</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '7px 12px', fontSize: 13 }}
            disabled={saving}
            onClick={() => link(suggestion.account.id)}
          >
            Link this account
          </button>
        </div>
      )}

      {choosing && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {accounts.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No active trade accounts yet.{' '}
              <Link href="/accounts" style={{ color: 'var(--accent)' }}>
                Create one
              </Link>
              .
            </div>
          ) : (
            <>
              <label htmlFor="job-trade-account">Choose account</label>
              <select
                id="job-trade-account"
                value={job.client_account_id ?? ''}
                disabled={saving}
                onChange={e => link(e.target.value || null)}
              >
                <option value="">— Not linked —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.trading_as || a.legal_name}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                Only active accounts are listed.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
