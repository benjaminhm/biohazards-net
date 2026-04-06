/*
 * app/platform/orgs/[id]/page.tsx
 *
 * Company profile page — accessible at platform.biohazards.net/platform/orgs/[id]
 * Platform admin only (middleware + API double-check).
 *
 * Shows:
 *   - Org details: name, slug, plan, seats, status, created date
 *   - Recommended onboarding: create administrator profile (people row) + app invite
 *     — same /invite/[token] flow as team members (not Clerk email for core path)
 *   - People & invites: copy URL, email/SMS, regenerate
 *   - App users: clerk-linked accounts in this org
 *   - Website Dashboard: platform flag (orgs.features.website_card) for home-screen tile / future add-on
 *   - Training & education: platform flag (orgs.features.training_education) for in-app portal / future add-on
 *   - Danger zone: deactivate org (requires typing the exact org name)
 */
'use client'

import { useEffect, useState, type FormEvent, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'

// We don't have types imported here — define inline interfaces
interface OrgRow {
  id: string
  name: string
  slug: string
  plan: string
  seat_limit: number
  is_active: boolean
  created_at: string
  /** Merged platform flags; `website_card`, `training_education`, etc. */
  features?: Record<string, unknown> | null
}
interface PersonRow {
  id: string
  name: string
  email: string | null
  phone: string | null
}
interface OrgUserRow {
  id: string
  clerk_user_id: string
  role: string
  person_id: string | null
}
interface InviteRow {
  id: string
  token: string
  role: string
  person_id: string | null
  claimed_by: string | null
  expires_at: string
  created_at: string
}
interface OrgProfile {
  org: OrgRow
  people: PersonRow[]
  org_users: OrgUserRow[]
  invites: InviteRow[]
}

interface SendLogRow {
  id: string
  person_id: string | null
  channel: string
  recipient: string
  org_name: string
  admin_name: string
  invite_url: string
  provider_id: string | null
  created_at: string
}

function orgTrainingEducationEnabled(org: OrgRow): boolean {
  const f = org.features
  if (!f || typeof f !== 'object') return false
  return f.training_education === true
}

function orgWebsiteCardEnabled(org: OrgRow): boolean {
  const f = org.features
  if (!f || typeof f !== 'object') return false
  return f.website_card === true
}

const PLAN_COLORS: Record<string, { bg: string; fg: string }> = {
  solo:     { bg: 'rgba(100,100,100,0.12)', fg: '#888' },
  team:     { bg: 'rgba(59,130,246,0.1)',   fg: '#60A5FA' },
  business: { bg: 'rgba(255,107,53,0.1)',   fg: 'var(--accent)' },
}

export default function OrgProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [data, setData]       = useState<OrgProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [sendLog, setSendLog] = useState<SendLogRow[]>([])
  const [sending, setSending] = useState<string | null>(null)

  const [adminForm, setAdminForm] = useState({ name: '', email: '', phone: '' })
  const [creatingAdmin, setCreatingAdmin] = useState(false)

  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [trainingToggleBusy, setTrainingToggleBusy] = useState(false)
  const [websiteToggleBusy, setWebsiteToggleBusy] = useState(false)

  async function loadSendLog() {
    try {
      const res = await fetch(`/api/admin/provision/send-log?org_id=${encodeURIComponent(id)}`)
      const j = await res.json()
      if (res.ok && Array.isArray(j.sends)) setSendLog(j.sends)
      else setSendLog([])
    } catch {
      setSendLog([])
    }
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orgs/${id}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed'); return }
      setData(json)
      await loadSendLog()
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  async function handleCreateAdministrator(e: FormEvent) {
    e.preventDefault()
    if (!adminForm.name.trim() || !adminForm.email.trim()) {
      alert('Name and email are required')
      return
    }
    setCreatingAdmin(true)
    try {
      const res = await fetch(`/api/admin/orgs/${id}/administrator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: adminForm.name.trim(),
          email: adminForm.email.trim(),
          phone: adminForm.phone.trim() || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof j.error === 'string' ? j.error : 'Failed to create administrator')
        return
      }
      setAdminForm({ name: '', email: '', phone: '' })
      await load()
    } finally {
      setCreatingAdmin(false)
    }
  }

  async function handleRegenerateInvite(personId: string) {
    setRegenerating(true)
    try {
      // Create a fresh invite for this person in this org
      const res = await fetch('/api/admin/provision/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: id, person_id: personId }),
      })
      if (!res.ok) { const j = await res.json(); alert(j.error ?? 'Failed'); return }
      await load()
    } finally {
      setRegenerating(false)
    }
  }

  async function handleToggleActive() {
    if (!data) return
    await fetch(`/api/admin/orgs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !data.org.is_active }),
    })
    await load()
  }

  async function handleToggleTrainingEducation() {
    if (!data) return
    const next = !orgTrainingEducationEnabled(data.org)
    setTrainingToggleBusy(true)
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: { training_education: next } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof j.error === 'string' ? j.error : 'Could not update training flag')
        return
      }
      await load()
    } finally {
      setTrainingToggleBusy(false)
    }
  }

  async function handleToggleWebsiteCard() {
    if (!data) return
    const next = !orgWebsiteCardEnabled(data.org)
    setWebsiteToggleBusy(true)
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: { website_card: next } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof j.error === 'string' ? j.error : 'Could not update website card flag')
        return
      }
      await load()
    } finally {
      setWebsiteToggleBusy(false)
    }
  }

  async function handleDeleteOrganisation() {
    if (!data || deleteConfirmName !== data.org.name) return
    if (!confirm('Deactivate this organisation? App users will lose access until it is re-enabled from the platform list.')) return
    setDeleteSubmitting(true)
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: deleteConfirmName }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof j.error === 'string' ? j.error : 'Could not deactivate organisation')
        return
      }
      router.push('/platform')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  function copyInvite(url: string) {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function sendInvite(
    channel: 'email' | 'sms',
    opts: { inviteUrl: string; person: PersonRow }
  ) {
    if (!data) return
    const key = `${channel}-${opts.person.id}`
    setSending(key)
    try {
      const body: Record<string, string> = {
        channel,
        invite_url: opts.inviteUrl,
        org_name: data.org.name,
        admin_name: opts.person.name,
        org_id: data.org.id,
        person_id: opts.person.id,
      }
      if (channel === 'email') {
        if (!opts.person.email?.trim()) {
          alert('Add an email on this profile first (or copy the link).')
          return
        }
        body.admin_email = opts.person.email.trim()
      } else {
        if (!opts.person.phone?.trim()) {
          alert('Add a phone number on this profile first (or copy the link).')
          return
        }
        body.admin_phone = opts.person.phone.trim()
      }
      const res = await fetch('/api/admin/provision/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof j.error === 'string' ? j.error : 'Send failed')
        return
      }
      await loadSendLog()
    } finally {
      setSending(null)
    }
  }

  async function resendInvite(row: SendLogRow) {
    if (!data) return
    setSending(`resend-${row.id}`)
    try {
      const now = new Date()
      const activeInv = data.invites.filter(inv => !inv.claimed_by && new Date(inv.expires_at) > now)
      let inviteUrl = row.invite_url
      if (row.person_id) {
        const inv = activeInv.find(i => i.person_id === row.person_id)
        if (inv) inviteUrl = `https://app.biohazards.net/invite/${inv.token}`
      }
      const body: Record<string, string> = {
        channel: row.channel === 'sms' ? 'sms' : 'email',
        invite_url: inviteUrl,
        org_name: data.org.name,
        admin_name: row.admin_name,
        org_id: data.org.id,
      }
      if (row.person_id) body.person_id = row.person_id
      if (row.channel === 'sms') body.admin_phone = row.recipient
      else body.admin_email = row.recipient

      const res = await fetch('/api/admin/provision/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof j.error === 'string' ? j.error : 'Resend failed')
        return
      }
      await loadSendLog()
    } finally {
      setSending(null)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span className="spinner" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{error || 'Not found'}</div>
          <button onClick={() => router.push('/platform')} style={backBtnStyle}>← Back to Platform</button>
        </div>
      </div>
    )
  }

  const { org, people, org_users, invites } = data

  // Active (unclaimed, non-expired) invites for admin role
  const now = new Date()
  const activeInvites = invites.filter(inv => !inv.claimed_by && new Date(inv.expires_at) > now)
  const claimedInvites = invites.filter(inv => inv.claimed_by)

  const planStyle = PLAN_COLORS[org.plan] ?? PLAN_COLORS.solo

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '18px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <button
          onClick={() => router.push('/platform')}
          style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 8, padding: '7px 12px',
            color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ← Platform
        </button>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 3 }}>Organisation</div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
            {org.name}
            <span style={{
              padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: org.is_active ? 'rgba(34,197,94,0.1)' : 'rgba(100,100,100,0.12)',
              color: org.is_active ? '#4ADE80' : '#666',
            }}>
              {org.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        <button
          onClick={handleToggleActive}
          style={{
            background: 'var(--surface-2)', border: '1px solid var(--border-2)',
            borderRadius: 8, padding: '8px 14px',
            color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {org.is_active ? 'Disable' : 'Enable'}
        </button>
      </header>

      <main style={{ padding: '28px', maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Org details */}
        <Card title="Details">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            <Stat label="Slug" value={<span className="mono" style={{ fontSize: 14 }}>{org.slug}</span>} />
            <Stat label="Plan" value={
              <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: planStyle.bg, color: planStyle.fg, textTransform: 'capitalize' }}>
                {org.plan}
              </span>
            } />
            <Stat label="Seat limit" value={org.seat_limit} />
            <Stat label="App users" value={org_users.length} />
            <Stat label="Created" value={new Date(org.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })} />
          </div>
        </Card>

        {/* Step 1 — create profile + invite (same pattern as team members in the app) */}
        {people.length === 0 && (
          <Card title="Add organisation administrator">
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 18px' }}>
              Create their <strong style={{ color: 'var(--text)' }}>staff profile</strong> first, then we generate an{' '}
              <strong style={{ color: 'var(--text)' }}>app invite link</strong> (<span className="mono" style={{ fontSize: 12 }}>/invite/…</span>).
              They sign up with Clerk and land in this company — same flow as inviting a team member from the app.
            </p>
            <form onSubmit={e => void handleCreateAdministrator(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Full name</span>
                <input
                  required
                  value={adminForm.name}
                  onChange={e => setAdminForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Smith"
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Email</span>
                <input
                  type="email"
                  required
                  value={adminForm.email}
                  onChange={e => setAdminForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="admin@company.com.au"
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Phone (optional)</span>
                <input
                  value={adminForm.phone}
                  onChange={e => setAdminForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+61…"
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }}
                />
              </label>
              <button
                type="submit"
                disabled={creatingAdmin}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 4,
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: creatingAdmin ? 'wait' : 'pointer',
                  opacity: creatingAdmin ? 0.7 : 1,
                }}
              >
                {creatingAdmin ? 'Creating…' : 'Create profile & generate invite'}
              </button>
            </form>
          </Card>
        )}

        {/* People profiles + invite links */}
        <Card title="People & app invites">
          {people.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              No profiles yet — use <strong style={{ color: 'var(--text)' }}>Add organisation administrator</strong> above.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {people.map(person => {
                const linked = org_users.find(u => u.person_id === person.id)
                // Find active invite for this person
                const personInvite = activeInvites.find(inv => inv.person_id === person.id)
                const inviteUrl = personInvite ? `https://app.biohazards.net/invite/${personInvite.token}` : null
                const hasClaimed = claimedInvites.some(inv => inv.person_id === person.id)

                return (
                  <div key={person.id} style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '16px 18px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{person.name}</div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          {person.email && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>✉ {person.email}</span>}
                          {person.phone && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>📞 {person.phone}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {linked ? (
                          <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'rgba(34,197,94,0.1)', color: '#4ADE80' }}>
                            ✓ Signed in
                          </span>
                        ) : hasClaimed ? (
                          <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: '#60A5FA' }}>
                            Invite claimed
                          </span>
                        ) : (
                          <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'rgba(100,100,100,0.12)', color: '#666' }}>
                            Not signed in
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Invite link section */}
                    {!linked && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                        {inviteUrl ? (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>
                              Invite Link · Expires {new Date(personInvite!.expires_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{
                                fontFamily: 'monospace', fontSize: 12,
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 6, padding: '6px 10px',
                                color: 'var(--text-muted)',
                                flex: 1, minWidth: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {inviteUrl}
                              </span>
                              <TinyBtn label={copied ? '✓ Copied' : 'Copy'} onClick={() => copyInvite(inviteUrl)} primary />
                              <TinyBtn
                                label={sending === `email-${person.id}` ? '…' : 'Email'}
                                onClick={() => sendInvite('email', { inviteUrl, person })}
                                disabled={!!sending || !person.email?.trim()}
                              />
                              <TinyBtn
                                label={sending === `sms-${person.id}` ? '…' : 'SMS'}
                                onClick={() => sendInvite('sms', { inviteUrl, person })}
                                disabled={!!sending || !person.phone?.trim()}
                              />
                              <TinyBtn label={regenerating ? '…' : 'Refresh'} onClick={() => handleRegenerateInvite(person.id)} />
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                              {hasClaimed ? 'Invite was claimed — generate a new one if needed.' : 'No active invite.'}
                            </span>
                            <TinyBtn label={regenerating ? '…' : 'Generate Invite'} onClick={() => handleRegenerateInvite(person.id)} primary />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card title="Recent invite sends">
          {sendLog.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              No emailed or SMS invites recorded yet. Use Email or SMS next to an invite link above — sends are logged here for audit and one-click resend.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sendLog.map(row => (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{row.channel === 'sms' ? 'SMS' : 'Email'}</span>
                    {' · '}
                    <span style={{ color: 'var(--text-muted)' }}>{row.admin_name}</span>
                    {' → '}
                    <span className="mono" style={{ fontSize: 12 }}>{row.recipient}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                      {new Date(row.created_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                  <TinyBtn
                    label={sending === `resend-${row.id}` ? '…' : 'Resend'}
                    onClick={() => resendInvite(row)}
                    disabled={!!sending}
                    primary
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* App users (linked Clerk accounts) */}
        {org_users.length > 0 && (
          <Card title="App Users">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {org_users.map(u => (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 13,
                }}>
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{u.clerk_user_id}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                    background: 'rgba(59,130,246,0.1)', color: '#60A5FA', textTransform: 'capitalize',
                  }}>
                    {u.role}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="Website Dashboard">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
              Turns on the <strong style={{ color: 'var(--text)' }}>Website Dashboard</strong> entry on this organisation&apos;s app home (next to a reserved slot for future shortcuts).
              Default is off; use as a master switch if the site card is bundled or sold as an add-on later.
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 16, flexWrap: 'wrap',
              padding: '12px 14px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Home tile</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {orgWebsiteCardEnabled(org)
                    ? 'Enabled — members see the Website Dashboard tile and reserved slot on the home screen.'
                    : 'Disabled — no Website Dashboard tile on the app home.'}
                </div>
              </div>
              <button
                type="button"
                disabled={websiteToggleBusy}
                onClick={() => void handleToggleWebsiteCard()}
                title={orgWebsiteCardEnabled(org) ? 'Turn off Website Dashboard tile' : 'Turn on Website Dashboard tile'}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: `1px solid ${orgWebsiteCardEnabled(org) ? 'rgba(34,197,94,0.45)' : 'var(--border)'}`,
                  background: orgWebsiteCardEnabled(org) ? 'rgba(34,197,94,0.12)' : 'var(--surface-3)',
                  color: orgWebsiteCardEnabled(org) ? '#4ADE80' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: websiteToggleBusy ? 'wait' : 'pointer',
                  opacity: websiteToggleBusy ? 0.65 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {websiteToggleBusy ? 'Saving…' : orgWebsiteCardEnabled(org) ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </Card>

        <Card title="Training & education">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
              Turns on the in-app <strong style={{ color: 'var(--text)' }}>training &amp; education</strong> entry for this organisation (home-screen portal for owners and team).
              Use this as the master switch if the program is bundled or sold as an add-on later.
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 16, flexWrap: 'wrap',
              padding: '12px 14px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Portal</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {orgTrainingEducationEnabled(org)
                    ? 'Enabled — eligible members will see the training area when the app surface ships.'
                    : 'Disabled — no training portal for this org.'}
                </div>
              </div>
              <button
                type="button"
                disabled={trainingToggleBusy}
                onClick={() => void handleToggleTrainingEducation()}
                title={orgTrainingEducationEnabled(org) ? 'Turn off training portal' : 'Turn on training portal'}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: `1px solid ${orgTrainingEducationEnabled(org) ? 'rgba(34,197,94,0.45)' : 'var(--border)'}`,
                  background: orgTrainingEducationEnabled(org) ? 'rgba(34,197,94,0.12)' : 'var(--surface-3)',
                  color: orgTrainingEducationEnabled(org) ? '#4ADE80' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: trainingToggleBusy ? 'wait' : 'pointer',
                  opacity: trainingToggleBusy ? 0.65 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {trainingToggleBusy ? 'Saving…' : orgTrainingEducationEnabled(org) ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </Card>

        {/* Danger zone — deactivate org (API: soft delete, name must match exactly) */}
        <div style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.28)',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid rgba(239,68,68,0.2)',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#F87171',
          }}>
            Danger zone
          </div>
          <div style={{ padding: '18px 20px' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 14px' }}>
              Deactivate this organisation: it disappears from normal lists, app users cannot sign in, and jobs stay in the database for recovery.
              This does not erase data.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 10px' }}>
              Type the organisation name <strong style={{ color: 'var(--text)' }}>exactly</strong> as shown (case-sensitive), then confirm.
            </p>
            <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', marginBottom: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              {org.name}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                Confirm organisation name
              </span>
              <input
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                placeholder={org.name}
                autoComplete="off"
                spellCheck={false}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              />
            </label>
            <button
              type="button"
              disabled={deleteConfirmName !== org.name || deleteSubmitting}
              onClick={() => void handleDeleteOrganisation()}
              style={{
                marginTop: 14,
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid rgba(239,68,68,0.45)',
                background: deleteConfirmName === org.name && !deleteSubmitting ? 'rgba(239,68,68,0.18)' : 'transparent',
                color: '#F87171',
                fontWeight: 700,
                fontSize: 13,
                cursor: deleteConfirmName === org.name && !deleteSubmitting ? 'pointer' : 'not-allowed',
                opacity: deleteSubmitting ? 0.65 : 1,
              }}
            >
              {deleteSubmitting ? 'Deactivating…' : 'Deactivate organisation'}
            </button>
          </div>
        </div>

      </main>
    </div>
  )
}

/* ── Sub-components ── */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
      }}>
        {title}
      </div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function TinyBtn({ label, onClick, primary, disabled }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
        background: primary ? 'var(--surface-3)' : 'transparent',
        border: `1px solid ${primary ? 'var(--border-2)' : 'var(--border)'}`,
        color: primary ? 'var(--text)' : 'var(--text-muted)',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  )
}

const backBtnStyle: CSSProperties = {
  padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-2)',
  background: 'var(--surface)', color: 'var(--text-muted)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 12,
}
