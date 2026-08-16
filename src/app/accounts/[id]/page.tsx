/*
 * app/accounts/[id]/page.tsx
 *
 * Trade account detail — company details, login contacts, linked jobs, and the
 * audit trail of quotes accepted through the portal.
 *
 * Terms & Conditions acceptance is read-only here on purpose: it is evidence of
 * what the client agreed to and when, so staff must not be able to edit it.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { TRADING_NAME_OPTIONS } from '@/lib/tradingNames'
import {
  APPLICATION_SECTIONS,
  missingApplicationFields,
  type ApplicationField,
} from '@/lib/portal/application'
import type { ClientAccount, ClientAccountContact, QuoteAcceptance } from '@/lib/types'
import AddressAutocomplete from '@/components/AddressAutocomplete'

interface LinkedJob {
  id: string
  status: string
  job_type: string
  site_address: string
  client_name: string
  created_at: string
  scheduled_at: string | null
}

interface AccountDetail {
  account: ClientAccount
  contacts: ClientAccountContact[]
  jobs: LinkedJob[]
  acceptances: QuoteAcceptance[]
  terms_current: boolean
  terms_version_required: string
}

const BRAND_LABELS: Record<string, string> = Object.fromEntries(
  TRADING_NAME_OPTIONS.map(o => [o.id, o.label])
)

const fmtDate = (iso: string | null | undefined) =>
  !iso
    ? '—'
    : new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

const fmtDateTime = (iso: string | null | undefined) =>
  !iso ? '—' : new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<AccountDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not load account')
      setData(body)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load account')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <Link href="/accounts" className="eyebrow" style={{ color: 'var(--accent)' }}>
          ← Trade Accounts
        </Link>
        <div className="card" style={{ marginTop: 16, color: '#F87171' }}>{error || 'Not found'}</div>
      </div>
    )
  }

  const { account } = data

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="container" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <Link href="/accounts" className="eyebrow" style={{ color: 'var(--accent)' }}>
          ← Trade Accounts
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 8 }}>
          {account.trading_as || account.legal_name}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
          {BRAND_LABELS[account.trading_name] ?? account.trading_name}
          {account.status !== 'active' ? ` · ${account.status}` : ''}
        </div>

        <TermsCard detail={data} />
        <ApplicationCard account={account} onChanged={load} />
        <AccountDetailsCard account={account} onSaved={load} />
        <ContactsCard accountId={account.id} contacts={data.contacts} onChanged={load} />
        <LinkedJobsCard jobs={data.jobs} />
        <AcceptancesCard acceptances={data.acceptances} />
      </div>
    </div>
  )
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
      {hint && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{hint}</p>}
    </div>
  )
}

function TermsCard({ detail }: { detail: AccountDetail }) {
  const { account, terms_current, terms_version_required } = detail
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <SectionHeading title="Terms & Conditions" hint="Accepted once by the client, then every quote needs only a click." />
      {terms_current ? (
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          <span className="badge" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ADE80', marginRight: 8 }}>
            Signed
          </span>
          Version <span className="mono">{account.terms_version}</span> accepted{' '}
          {fmtDateTime(account.terms_accepted_at)}
          {account.terms_accepted_ip ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
              Recorded from IP <span className="mono">{account.terms_accepted_ip}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          <span className="badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B', marginRight: 8 }}>
            Pending
          </span>
          {account.terms_version
            ? `Accepted an older version (${account.terms_version}). They will be asked to accept ${terms_version_required} on next sign-in.`
            : `Not yet accepted. The client is prompted to accept ${terms_version_required} when they first sign in, and cannot accept quotes until they do.`}
        </div>
      )}
    </div>
  )
}

/**
 * The application as the client filled it in. Read back in their order rather
 * than as an editable form: this card exists to be checked against a credit
 * report, and the Company details card below is where corrections are made.
 */
function ApplicationCard({ account, onChanged }: { account: ClientAccount; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitted = account.application_submitted_at
  const missing = missingApplicationFields(account)

  async function reopen() {
    if (busy) return
    if (!confirm('Reopen this application so the client can edit and resubmit it?')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/accounts/${account.id}/reopen`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not reopen the application')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen the application')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <SectionHeading
          title="Trade account application"
          hint="Completed by the client in their portal. Locked once submitted."
        />
        {submitted && (
          <button className="btn btn-secondary" onClick={reopen} disabled={busy} style={{ flexShrink: 0 }}>
            {busy ? 'Reopening…' : 'Reopen for editing'}
          </button>
        )}
      </div>

      {error && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ fontSize: 14, lineHeight: 1.7, marginBottom: submitted ? 18 : 0 }}>
        {submitted ? (
          <>
            <span className="badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B', marginRight: 8 }}>
              Awaiting review
            </span>
            Submitted {fmtDateTime(submitted)}
          </>
        ) : (
          <>
            <span className="badge" style={{ background: 'rgba(148,163,184,0.14)', color: 'var(--text-muted)', marginRight: 8 }}>
              Not submitted
            </span>
            {account.application_reopened_at
              ? `Reopened ${fmtDateTime(account.application_reopened_at)} — waiting on the client to resubmit.`
              : 'The client has not submitted their details yet.'}
            {missing.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
                Still blank: {missing.join(', ')}
              </div>
            )}
          </>
        )}
      </div>

      {submitted && (
        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {APPLICATION_SECTIONS.map(group => (
            <div key={group.title}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>{group.title}</div>
              {group.fields.map(([field, text]) => (
                <div key={field} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{text}</div>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
                    {applicationValue(account, field) || (
                      <span style={{ color: 'var(--text-dim)' }}>—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function applicationValue(account: ClientAccount, field: ApplicationField): string {
  if (field === 'purchase_order_required') return account.purchase_order_required ? 'Yes' : 'No'
  return account[field] ?? ''
}

function AccountDetailsCard({ account, onSaved }: { account: ClientAccount; onSaved: () => void }) {
  const [form, setForm] = useState({
    legal_name: account.legal_name,
    trading_as: account.trading_as,
    abn: account.abn,
    billing_email: account.billing_email,
    billing_address: account.billing_address,
    phone: account.phone,
    notes: account.notes,
    status: account.status,
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    setMessage('')
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not save')
      setMessage('Saved')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <SectionHeading title="Company details" hint="The client can also maintain these in their portal." />

      {error && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 14 }}>{error}</div>}

      <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 14 }}>
        <div className="field">
          <label htmlFor="d-legal">Legal name</label>
          <input id="d-legal" value={form.legal_name} onChange={e => set('legal_name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d-trading">Trading as</label>
          <input id="d-trading" value={form.trading_as} onChange={e => set('trading_as', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d-abn">ABN</label>
          <input id="d-abn" value={form.abn} onChange={e => set('abn', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d-phone">Phone</label>
          <input id="d-phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d-billing">Accounts payable email</label>
          <input id="d-billing" type="email" value={form.billing_email} onChange={e => set('billing_email', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d-status">Account status</label>
          <select id="d-status" value={form.status} onChange={e => set('status', e.target.value as ClientAccount['status'])}>
            <option value="active">Active</option>
            <option value="suspended">Suspended — portal access blocked</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="d-address">Billing address</label>
        <AddressAutocomplete
          value={form.billing_address}
          placeholder="Street, suburb, state, postcode"
          onChange={next => set('billing_address', next.address)}
        />
      </div>

      <div className="field">
        <label htmlFor="d-notes">Internal notes — never shown to the client</label>
        <textarea id="d-notes" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {message && <span style={{ fontSize: 13, color: 'var(--green)' }}>{message}</span>}
      </div>
    </div>
  )
}

function ContactsCard({
  accountId,
  contacts,
  onChanged,
}: {
  accountId: string
  contacts: ClientAccountContact[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function addContact(e: React.FormEvent) {
    e.preventDefault()
    setBusy('add')
    setError('')
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, title, is_primary: contacts.length === 0 }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not add contact')
      setName('')
      setEmail('')
      setTitle('')
      setAdding(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add contact')
    } finally {
      setBusy('')
    }
  }

  async function patchContact(contactId: string, patch: Record<string, unknown>) {
    setBusy(contactId)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not update contact')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update contact')
    } finally {
      setBusy('')
    }
  }

  async function invite(contactId: string) {
    setBusy(contactId)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts/${contactId}/invite`, {
        method: 'POST',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not send the link')
      setMessage(body.first_time ? 'Invite sent' : 'Sign-in link sent')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <SectionHeading title="Login contacts" hint="Each contact signs in with a single-use link sent to their email." />
        {!adding && (
          <button className="btn btn-secondary" onClick={() => setAdding(true)} style={{ flexShrink: 0 }}>
            + Add contact
          </button>
        )}
      </div>

      {error && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: 'var(--green)', fontSize: 13, marginBottom: 12 }}>{message}</div>}

      {adding && (
        <form onSubmit={addContact} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', columnGap: 14 }}>
            <div className="field">
              <label htmlFor="c-name">Name</label>
              <input id="c-name" required autoFocus value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-email">Email</label>
              <input id="c-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-title">Role / title</label>
              <input id="c-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Facilities Manager" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={busy === 'add'}>
              {busy === 'add' ? 'Adding…' : 'Add contact'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          No contacts yet. Add one and send them an invite to activate portal access.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {contacts.map(contact => (
            <div
              key={contact.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 14,
                opacity: contact.status === 'active' ? 1 : 0.55,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {contact.name}
                    {contact.is_primary && (
                      <span className="badge" style={{ marginLeft: 8, background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                        Primary
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                    {contact.email}
                    {contact.title ? ` · ${contact.title}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                    {contact.last_login_at
                      ? `Last signed in ${fmtDateTime(contact.last_login_at)}`
                      : contact.invited_at
                        ? `Invited ${fmtDate(contact.invited_at)} · not yet signed in`
                        : 'Never invited'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '8px 12px', fontSize: 13 }}
                    disabled={busy === contact.id || contact.status !== 'active'}
                    onClick={() => invite(contact.id)}
                  >
                    {contact.invited_at ? 'Send link' : 'Send invite'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 13 }}
                    disabled={busy === contact.id}
                    onClick={() =>
                      patchContact(contact.id, {
                        status: contact.status === 'active' ? 'disabled' : 'active',
                      })
                    }
                  >
                    {contact.status === 'active' ? 'Disable' : 'Re-enable'}
                  </button>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, textTransform: 'none', letterSpacing: 0, fontSize: 13, fontWeight: 400, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={contact.can_accept_quotes}
                  disabled={busy === contact.id}
                  onChange={e => patchContact(contact.id, { can_accept_quotes: e.target.checked })}
                />
                Can accept quotes on behalf of this company
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LinkedJobsCard({ jobs }: { jobs: LinkedJob[] }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <SectionHeading
        title={`Linked jobs (${jobs.length})`}
        hint="Only these jobs are visible in the client's portal. Link a job from its job file."
      />
      {jobs.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          No jobs linked yet. Open a job and set its trade account.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {jobs.map(job => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{job.site_address || 'No site address'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {job.client_name} · created {fmtDate(job.created_at)}
                </div>
              </div>
              <span className={`badge badge-${job.status}`} style={{ flexShrink: 0 }}>
                {job.status.replace(/_/g, ' ')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function AcceptancesCard({ acceptances }: { acceptances: QuoteAcceptance[] }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <SectionHeading
        title="Quote acceptances"
        hint="Recorded when a contact accepts a quote in the portal. This is the evidence trail — it cannot be edited."
      />
      {acceptances.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>No quotes accepted through the portal yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {acceptances.map(a => (
            <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    <span className="mono">{a.quote_reference || 'Quote'}</span>
                    {a.quote_total != null && (
                      <span style={{ marginLeft: 10, color: 'var(--accent)' }}>
                        ${Number(a.quote_total).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {a.contact_name} ({a.contact_email}) · {fmtDateTime(a.accepted_at)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                    Terms <span className="mono">{a.terms_version}</span>
                    {a.ip ? ` · IP ${a.ip}` : ''}
                  </div>
                </div>
                {a.job_id ? (
                  <Link href={`/jobs/${a.job_id}`} className="btn btn-ghost" style={{ fontSize: 13, flexShrink: 0 }}>
                    Open job →
                  </Link>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>Job deleted</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
