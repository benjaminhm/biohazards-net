/*
 * app/admin/page.tsx
 *
 * Platform super-admin dashboard — only accessible to PLATFORM_ADMIN_CLERK_IDS.
 * The middleware enforces this at the edge; the API routes double-check server-side.
 *
 * Tabs:
 *   - Orgs: lists all orgs. "+ New Organisation" = POST /api/admin/orgs (empty company row).
 *     Open an org on Platform → add administrator profile + app invite (same flow as team members).
 *   - Admins: lists all org_users across all orgs, enriched with Clerk names.
 *   - Pending: Clerk users who exist but have no org_users row yet. Assign via
 *     POST /api/admin/users/pending. If the user already belongs to another org,
 *     the API returns 409 until confirm_move — the UI opens a move confirmation modal.
 *   - App users (tab id `admins`): lists every org_users row (all roles: owner, admin, member).
 *     Misleading old label was "Administrators". Non–platform-owner rows can use "Move org…"
 *     to reassign (one org per user; moving removes the old membership).
 *   - Invites: Clerk sign-up invitations — status, copy link, resend, revoke.
 *   - Reviews: submitted feedback — panels default hidden; toggles persist in localStorage.
 *     Optional table lists all orgs (same data as Organisations tab) with Open link.
 *   - Orgs tab — "Training & debugging": start audited tenant impersonation
 *     (POST /api/admin/impersonate) then open the main app with that org context.
 *
 * PLATFORM_OWNER_ID is hard-coded as a last-resort admin ID separate from the
 * env var so the platform owner can always access the dashboard even if the env
 * var is misconfigured. This is intentional and scoped only to this page's UI.
 *
 * All mutations call the /api/admin/* routes which re-validate the caller's identity
 * server-side, so this page's client-side guard is UX only, not a security boundary.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Org } from '@/lib/types'

const PLATFORM_OWNER_ID = 'user_3BkVAf7042IsBwqabQ9MoZdEbvE'

interface OrgWithCount extends Org { user_count: number }
interface NewOrgForm { name: string; slug: string; plan: string; seat_limit: string }
interface AdminUser {
  id: string; clerk_user_id: string; org_id: string; role: string
  email: string; name: string; image_url: string; created_at: string
  orgs: { name: string; slug: string }
}
interface PendingUser {
  clerk_user_id: string; email: string; name: string
  image_url: string; created_at: string
}

const PLAN_OPTIONS = ['solo', 'team', 'business']
type Tab = 'orgs' | 'admins' | 'invites' | 'pending' | 'reviews'

interface ClerkInvitationRow {
  id: string
  emailAddress: string
  status: string
  createdAt: number
  updatedAt: number
  url: string | null
  revoked: boolean
  publicMetadata: Record<string, unknown> | null
}

interface PlatformReview {
  id: string; org_id: string; rating: number; body: string | null
  reviewer_name: string | null; is_published: boolean; created_at: string
  orgs: { name: string; slug: string } | null
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('orgs')

  const [orgs, setOrgs]             = useState<OrgWithCount[]>([])
  const [loadingOrgs, setLoadingOrgs]       = useState(true)
  const [orgsError, setOrgsError]           = useState<string | null>(null)
  const [showModal, setShowModal]           = useState(false)
  const [form, setForm]                     = useState<NewOrgForm>({ name: '', slug: '', plan: 'solo', seat_limit: '1' })
  const [submitting, setSubmitting]         = useState(false)
  const [editingId, setEditingId]           = useState<string | null>(null)
  const [editForm, setEditForm]             = useState<Partial<Org>>({})

  const [admins, setAdmins]                 = useState<AdminUser[]>([])
  const [loadingAdmins, setLoadingAdmins]   = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail]       = useState('')
  const [inviteOrg, setInviteOrg]           = useState('')
  const [inviting, setInviting]             = useState(false)
  const [inviteOk, setInviteOk]             = useState(false)

  const [clerkInvites, setClerkInvites]     = useState<ClerkInvitationRow[]>([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [inviteRowBusy, setInviteRowBusy]   = useState<string | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)

  const [pending, setPending]               = useState<PendingUser[]>([])
  const [loadingPending, setLoadingPending] = useState(false)

  const [reviews, setReviews]               = useState<PlatformReview[]>([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [showReviewsPanel, setShowReviewsPanel] = useState(false)
  const [showReviewsOrgList, setShowReviewsOrgList] = useState(false)
  const [assigningId, setAssigningId]       = useState<string | null>(null)
  const [assignOrg, setAssignOrg]           = useState('')
  const [assignRole, setAssignRole]         = useState('owner')
  const [assigning, setAssigning]           = useState(false)
  const [adminMoveId, setAdminMoveId]       = useState<string | null>(null)
  const [moveConfirm, setMoveConfirm]       = useState<null | {
    clerkUserId: string
    orgId: string
    orgName: string
    role: string
    existingOrgName: string
  }>(null)

  const [impSession, setImpSession] = useState<{
    active: boolean
    org_id?: string
    org_name?: string
    read_only?: boolean
  } | null>(null)
  const [impOrgId, setImpOrgId]     = useState('')
  const [impReason, setImpReason]   = useState('')
  const [impAllowWrites, setImpAllowWrites] = useState(false)
  const [impBusy, setImpBusy]       = useState(false)

  async function fetchOrgs() {
    setLoadingOrgs(true); setOrgsError(null)
    try {
      const res = await fetch('/api/admin/orgs')
      if (!res.ok) throw new Error('Failed to fetch orgs')
      const json = await res.json()
      setOrgs(json.orgs ?? [])
    } catch (e: unknown) {
      setOrgsError(e instanceof Error ? e.message : 'Unknown error')
    } finally { setLoadingOrgs(false) }
  }

  async function fetchInvites() {
    setLoadingInvites(true)
    try {
      const res = await fetch('/api/admin/invitations')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load invitations')
      setClerkInvites(json.invitations ?? [])
    } catch (e: unknown) {
      console.error(e)
      setClerkInvites([])
    } finally {
      setLoadingInvites(false)
    }
  }

  async function fetchAdmins() {
    setLoadingAdmins(true)
    try {
      const res = await fetch('/api/admin/users')
      const json = await res.json()
      const sorted = (json.users ?? []).sort((a: AdminUser, b: AdminUser) =>
        a.clerk_user_id === PLATFORM_OWNER_ID ? -1 : b.clerk_user_id === PLATFORM_OWNER_ID ? 1 : 0
      )
      setAdmins(sorted)
    } finally { setLoadingAdmins(false) }
  }

  async function fetchPending() {
    setLoadingPending(true)
    try {
      const res = await fetch('/api/admin/users/pending')
      const json = await res.json()
      setPending(json.users ?? [])
    } finally { setLoadingPending(false) }
  }

  async function fetchReviews() {
    setLoadingReviews(true)
    try {
      const res = await fetch('/api/admin/reviews')
      const json = await res.json()
      setReviews(json.reviews ?? [])
    } finally { setLoadingReviews(false) }
  }

  async function handleTogglePublish(review: PlatformReview) {
    await fetch(`/api/admin/reviews/${review.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_published: !review.is_published }),
    })
    await fetchReviews()
  }

  useEffect(() => { fetchOrgs() }, [])
  useEffect(() => {
    if (tab !== 'orgs') return
    fetch('/api/admin/impersonate')
      .then(r => r.json())
      .then(d => setImpSession(d))
      .catch(() => setImpSession({ active: false }))
  }, [tab])
  useEffect(() => { if (tab === 'admins') fetchAdmins() }, [tab])
  useEffect(() => { if (tab === 'invites') void fetchInvites() }, [tab])
  useEffect(() => { if (tab === 'pending') fetchPending() }, [tab])
  useEffect(() => { if (tab === 'reviews') fetchReviews() }, [tab])

  useEffect(() => {
    try {
      setShowReviewsPanel(localStorage.getItem('bh_platform_reviews_panel') === '1')
      setShowReviewsOrgList(localStorage.getItem('bh_platform_reviews_orglist') === '1')
    } catch {
      /* ignore */
    }
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true)
    try {
      const res = await fetch('/api/admin/orgs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, slug: form.slug, plan: form.plan, seat_limit: parseInt(form.seat_limit, 10) || 1 }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed') }
      setShowModal(false); setForm({ name: '', slug: '', plan: 'solo', seat_limit: '1' }); await fetchOrgs()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setSubmitting(false) }
  }

  async function handleSaveEdit(id: string) {
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) })
      if (!res.ok) throw new Error('Failed to update org')
      setEditingId(null); await fetchOrgs()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
  }

  async function handleToggleActive(org: OrgWithCount) {
    await fetch(`/api/admin/orgs/${org.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !org.is_active }) })
    await fetchOrgs()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setInviting(true)
    try {
      const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, org_slug: inviteOrg }) })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed') }
      setInviteOk(true)
      void fetchInvites()
      setTimeout(() => { setInviteOk(false); setShowInviteModal(false); setInviteEmail(''); setInviteOrg('') }, 2000)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setInviting(false) }
  }

  async function revokeClerkInvite(id: string) {
    if (!window.confirm('Revoke this invitation? They will not be able to use the old link.')) return
    setInviteRowBusy(id)
    try {
      const res = await fetch(`/api/admin/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(typeof j.error === 'string' ? j.error : 'Revoke failed')
      }
      await fetchInvites()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setInviteRowBusy(null)
    }
  }

  async function resendClerkInvite(id: string) {
    if (!window.confirm('Resend? This revokes the current invite and sends a new Clerk email with a fresh link.')) return
    setInviteRowBusy(id)
    try {
      const res = await fetch(`/api/admin/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Resend failed')
      await fetchInvites()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setInviteRowBusy(null)
    }
  }

  function copyInviteLink(row: ClerkInvitationRow) {
    if (!row.url) {
      alert('No link available for this row (e.g. already accepted or revoked). Send a new invite from the modal.')
      return
    }
    void navigator.clipboard.writeText(row.url).then(() => {
      setCopiedInviteId(row.id)
      setTimeout(() => setCopiedInviteId(null), 2000)
    })
  }

  async function assignUserToOrg(
    clerkUserId: string,
    orgId: string,
    role: string,
    confirmMove: boolean
  ): Promise<'ok' | 'needs_confirm'> {
    const res = await fetch('/api/admin/users/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
        org_id: orgId,
        role,
        confirm_move: confirmMove,
      }),
    })
    const j = (await res.json().catch(() => ({}))) as {
      error?: string
      code?: string
      existing_org?: { name?: string }
    }
    if (res.status === 409 && j.code === 'NEEDS_MOVE_CONFIRMATION') {
      const org = orgs.find(o => o.id === orgId)
      setMoveConfirm({
        clerkUserId,
        orgId,
        orgName: org?.name ?? 'selected organisation',
        role,
        existingOrgName: j.existing_org?.name ?? 'another organisation',
      })
      return 'needs_confirm'
    }
    if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed to assign')
    await fetchPending()
    await fetchAdmins()
    setAssigningId(null)
    setAdminMoveId(null)
    setMoveConfirm(null)
    return 'ok'
  }

  async function handleAssign(clerkUserId: string) {
    if (!assignOrg) return alert('Select an organisation')
    const org = orgs.find(o => o.slug === assignOrg)
    if (!org) return alert('Organisation not found')
    setAssigning(true)
    try {
      const r = await assignUserToOrg(clerkUserId, org.id, assignRole, false)
      if (r === 'needs_confirm') return
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setAssigning(false)
    }
  }

  async function handleAdminMoveSubmit() {
    if (!adminMoveId || !assignOrg) return alert('Select an organisation')
    const org = orgs.find(o => o.slug === assignOrg)
    if (!org) return alert('Organisation not found')
    setAssigning(true)
    try {
      const r = await assignUserToOrg(adminMoveId, org.id, assignRole, false)
      if (r === 'needs_confirm') return
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setAssigning(false)
    }
  }

  async function handleMoveConfirmAuthorize() {
    if (!moveConfirm) return
    setAssigning(true)
    try {
      await assignUserToOrg(moveConfirm.clerkUserId, moveConfirm.orgId, moveConfirm.role, true)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setAssigning(false)
    }
  }

  async function handleImpersonationStart() {
    if (!impOrgId) return alert('Select an organisation')
    setImpBusy(true)
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: impOrgId,
          reason: impReason.trim() || undefined,
          read_only: !impAllowWrites,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed to start session')
      window.location.href = '/'
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setImpBusy(false)
    }
  }

  async function handleImpersonationEnd() {
    setImpBusy(true)
    try {
      await fetch('/api/admin/impersonate', { method: 'DELETE' })
      setImpSession({ active: false })
      setImpOrgId('')
      setImpReason('')
      setImpAllowWrites(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setImpBusy(false)
    }
  }

  const activeOrgs = orgs.filter(o => o.is_active).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>

      {/* ── Header ── */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '20px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 5 }}>Platform</div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
            biohazards.net
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'orgs' && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              style={{
                background: 'var(--accent)', border: 'none',
                borderRadius: 8, padding: '9px 16px',
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              + New Organisation
            </button>
          )}
          {(tab === 'admins' || tab === 'invites') && (
            <button
              onClick={() => setShowInviteModal(true)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                borderRadius: 8, padding: '9px 16px',
                color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Invite user (Clerk)
            </button>
          )}
        </div>
      </header>

      {/* ── Nav tabs ── */}
      <nav style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 28px',
        display: 'flex', gap: 0,
      }}>
        {(['orgs', 'admins', 'invites', 'pending', 'reviews'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '13px 18px',
              border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--text)' : '2px solid transparent',
              transition: 'color 0.12s, border-color 0.12s',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {t === 'orgs' ? 'Organisations' : t === 'admins' ? 'App users' : t === 'invites' ? 'Invites' : t === 'pending' ? 'Pending' : 'Reviews'}
            {t === 'pending' && pending.length > 0 && (
              <span style={{
                background: '#EF4444', color: '#fff',
                borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '2px 6px',
                lineHeight: 1,
              }}>
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main style={{ padding: '32px 28px' }}>

        {/* ── Orgs tab ── */}
        {tab === 'orgs' && (
          <>
            {/* Stats row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
              {[
                { label: 'Total organisations', value: orgs.length },
                { label: 'Active', value: activeOrgs },
                { label: 'Inactive', value: orgs.length - activeOrgs },
              ].map(s => (
                <div key={s.label} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 22px',
                }}>
                  <div className="num" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 3 }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{
              marginBottom: 24,
              padding: '18px 20px',
              borderRadius: 12,
              border: '1px solid rgba(194, 65, 12, 0.35)',
              background: 'rgba(194, 65, 12, 0.06)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#EA580C', marginBottom: 8 }}>
                Training &amp; debugging
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.55 }}>
                Open the main app in the context of a tenant organisation. Sessions are audited. Prefer read-only on live customer data; enable writes only when you need to reproduce issues.
              </p>
              {impSession?.active ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>
                    Active: <strong>{impSession.org_name}</strong>
                    {impSession.read_only ? ' (read-only)' : ' (writes allowed)'}
                  </span>
                  <TinyButton label={impBusy ? '…' : 'End session'} onClick={() => void handleImpersonationEnd()} primary />
                  <TinyButton label="Open app" onClick={() => { window.location.href = '/' }} />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
                  <select
                    value={impOrgId}
                    onChange={e => setImpOrgId(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)' }}
                  >
                    <option value="">Select organisation…</option>
                    {orgs.filter(o => o.is_active).map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Reason (optional, e.g. ticket id)"
                    value={impReason}
                    onChange={e => setImpReason(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)' }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={impAllowWrites}
                      onChange={e => setImpAllowWrites(e.target.checked)}
                    />
                    Allow writes (debugging — API mutations are blocked when unchecked)
                  </label>
                  <div>
                    <TinyButton
                      label={impBusy ? 'Starting…' : 'Start session & open app'}
                      onClick={() => void handleImpersonationStart()}
                      primary
                      disabled={!impOrgId || impBusy}
                    />
                  </div>
                </div>
              )}
            </div>

            {orgsError && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#F87171', fontSize: 13,
              }}>
                {orgsError}
              </div>
            )}

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18, maxWidth: 720 }}>
              After creating an empty organisation, open it from <strong style={{ color: 'var(--text)' }}>Open</strong> to add the <strong style={{ color: 'var(--text)' }}>administrator profile</strong> and <strong style={{ color: 'var(--text)' }}>app invite link</strong> (same pattern as team members — not the Clerk &quot;Invite user&quot; tab unless you need it).
            </p>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {loadingOrgs ? <EmptyState>Loading…</EmptyState>
              : orgs.length === 0 ? <EmptyState>No organisations yet.</EmptyState>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Name', 'Slug', 'Plan', 'Seats', 'Users', 'Status', 'Created', ''].map(h => (
                        <th key={h} style={{
                          padding: '11px 16px', textAlign: 'left',
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                          textTransform: 'uppercase', color: 'var(--text-dim)',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map(org => (
                      <tr key={org.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>
                          {org.name}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className="mono">{org.slug}</span>
                        </td>
                        {editingId === org.id ? (
                          <>
                            <td style={{ padding: '8px 16px' }}>
                              <select value={editForm.plan ?? org.plan} onChange={e => setEditForm(f => ({ ...f, plan: e.target.value as Org['plan'] }))} style={{ padding: '5px 8px', fontSize: 12, width: 'auto' }}>
                                {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '8px 16px' }}>
                              <input type="number" min={1} value={editForm.seat_limit ?? org.seat_limit} onChange={e => setEditForm(f => ({ ...f, seat_limit: parseInt(e.target.value, 10) || 1 }))} style={{ width: 60, padding: '5px 8px', fontSize: 12 }} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '12px 16px' }}><PlanPill plan={org.plan} /></td>
                            <td style={{ padding: '12px 16px' }}>
                              <span className="num" style={{ fontSize: 14, color: 'var(--text-muted)' }}>{org.seat_limit}</span>
                            </td>
                          </>
                        )}
                        <td style={{ padding: '12px 16px' }}>
                          <span className="num" style={{ fontSize: 14 }}>{org.user_count}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 9px', borderRadius: 99,
                            fontSize: 11, fontWeight: 700,
                            background: org.is_active ? 'rgba(34,197,94,0.1)' : 'rgba(100,100,100,0.12)',
                            color: org.is_active ? '#4ADE80' : '#666',
                          }}>
                            {org.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }} className="mono">
                          {new Date(org.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {editingId === org.id ? (
                              <>
                                <TinyButton label="Save"   onClick={() => handleSaveEdit(org.id)} primary />
                                <TinyButton label="Cancel" onClick={() => setEditingId(null)} />
                              </>
                            ) : (
                              <>
                                <a
                                  href={`/platform/orgs/${org.id}`}
                                  target="_blank"
                                  style={{
                                    padding: '5px 11px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                    background: 'var(--surface-3)', border: '1px solid var(--border-2)',
                                    color: 'var(--text)', textDecoration: 'none', display: 'inline-block',
                                  }}
                                >
                                  View ↗
                                </a>
                                <TinyButton label="Edit" onClick={() => { setEditingId(org.id); setEditForm({ plan: org.plan, seat_limit: org.seat_limit, is_active: org.is_active }) }} />
                                <TinyButton label={org.is_active ? 'Disable' : 'Enable'} onClick={() => handleToggleActive(org)} />
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ── Admins tab ── */}
        {tab === 'admins' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {loadingAdmins ? <EmptyState>Loading…</EmptyState>
            : admins.length === 0 ? <EmptyState>No linked app users yet.</EmptyState>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['', 'User', 'Email', 'Organisation', 'Role', 'Since', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {admins.map((u, i) => {
                    const isOwner = u.clerk_user_id === PLATFORM_OWNER_ID
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', background: isOwner ? 'rgba(255,107,53,0.03)' : 'transparent' }}>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13, width: 36 }}>
                          {isOwner ? <span title="Platform Owner" style={{ fontSize: 14 }}>★</span> : <span className="num" style={{ fontSize: 12 }}>{i + 1}</span>}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <UserAvatar name={u.name} imageUrl={u.image_url} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
                              {isOwner && <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>Platform Owner</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{u.email}</td>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>{u.orgs?.name ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: '#60A5FA', textTransform: 'capitalize' }}>
                            {u.role}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }} className="mono">
                          {new Date(u.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '12px 16px', minWidth: 220 }}>
                          {isOwner ? (
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>
                          ) : adminMoveId === u.clerk_user_id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <select value={assignOrg} onChange={e => setAssignOrg(e.target.value)} style={{ padding: '5px 8px', fontSize: 12, width: 'auto', maxWidth: 160 }}>
                                <option value="">Move to…</option>
                                {orgs.filter(o => o.is_active && o.id !== u.org_id).map(o => (
                                  <option key={o.id} value={o.slug}>{o.name}</option>
                                ))}
                              </select>
                              <select value={assignRole} onChange={e => setAssignRole(e.target.value)} style={{ padding: '5px 8px', fontSize: 12, width: 'auto' }}>
                                <option value="owner">Owner</option>
                                <option value="admin">Admin</option>
                                <option value="operator">Operator</option>
                                <option value="member">Member</option>
                              </select>
                              <TinyButton label={assigning ? '…' : 'Confirm'} onClick={() => void handleAdminMoveSubmit()} primary />
                              <TinyButton label="Cancel" onClick={() => { setAdminMoveId(null); setAssignOrg('') }} />
                            </div>
                          ) : (
                            <TinyButton
                              label="Move org…"
                              onClick={() => {
                                setAdminMoveId(u.clerk_user_id)
                                setAssignOrg('')
                                setAssignRole(u.role || 'owner')
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Clerk invites tab ── */}
        {tab === 'invites' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.55, maxWidth: 720 }}>
              Sign-up invitations sent through Clerk (same flow as <strong style={{ color: 'var(--text)' }}>Invite user</strong>). Copy the link to share by SMS or another channel; resend replaces the invite with a new email; revoke cancels the pending link.
            </p>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {loadingInvites ? <EmptyState>Loading…</EmptyState>
              : clerkInvites.length === 0 ? (
                <EmptyState>No Clerk invitations yet. Send one with &quot;Invite user (Clerk)&quot;.</EmptyState>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Email', 'Status', 'Landing org', 'Sent', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clerkInvites.map(row => {
                      const slug = typeof row.publicMetadata?.invited_to_org === 'string' ? row.publicMetadata.invited_to_org : ''
                      const busy = inviteRowBusy === row.id
                      const canAct = row.status === 'pending' && !row.revoked
                      return (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600 }}>{row.emailAddress}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                              background: row.status === 'pending' ? 'rgba(59,130,246,0.12)' : 'var(--surface-3)',
                              color: row.status === 'pending' ? '#60A5FA' : 'var(--text-muted)',
                            }}>
                              {row.status}{row.revoked ? ' (revoked)' : ''}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                            {slug ? `${slug}.biohazards.net` : <span style={{ color: 'var(--text-dim)' }}>App only (assign in Pending)</span>}
                          </td>
                          <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }} className="mono">
                            {new Date(row.createdAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              <TinyButton
                                label={copiedInviteId === row.id ? '✓ Copied' : 'Copy link'}
                                disabled={!row.url || busy}
                                onClick={() => copyInviteLink(row)}
                              />
                              <TinyButton
                                label={busy ? '…' : 'Resend'}
                                disabled={!canAct || busy}
                                onClick={() => void resendClerkInvite(row.id)}
                                primary
                              />
                              <TinyButton
                                label={busy ? '…' : 'Revoke'}
                                disabled={!canAct || busy}
                                onClick={() => void revokeClerkInvite(row.id)}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Pending tab ── */}
        {tab === 'pending' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {loadingPending ? <EmptyState>Loading…</EmptyState>
            : pending.length === 0 ? (
              <EmptyState>
                No pending users. This list is only for people who have signed up with Clerk but are not yet linked to any organisation. Staff who already joined an org appear under <strong style={{ color: 'var(--text)' }}>App users</strong>.
              </EmptyState>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['User', 'Email', 'Signed up', 'Assign to'].map(h => (
                      <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pending.map(u => (
                    <tr key={u.clerk_user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <UserAvatar name={u.name} imageUrl={u.image_url} />
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{u.email}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }} className="mono">
                        {new Date(u.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {assigningId === u.clerk_user_id ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={assignOrg} onChange={e => setAssignOrg(e.target.value)} style={{ padding: '5px 8px', fontSize: 12, width: 'auto' }}>
                              <option value="">Select org…</option>
                              {orgs.filter(o => o.is_active).map(o => <option key={o.id} value={o.slug}>{o.name}</option>)}
                            </select>
                            <select value={assignRole} onChange={e => setAssignRole(e.target.value)} style={{ padding: '5px 8px', fontSize: 12, width: 'auto' }}>
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="operator">Operator</option>
                              <option value="member">Member</option>
                            </select>
                            <TinyButton label={assigning ? '…' : 'Confirm'} onClick={() => handleAssign(u.clerk_user_id)} primary />
                            <TinyButton label="Cancel" onClick={() => setAssigningId(null)} />
                          </div>
                        ) : (
                          <TinyButton label="Assign →" onClick={() => { setAssigningId(u.clerk_user_id); setAssignOrg(''); setAssignRole('owner') }} primary />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Reviews tab — minimal by default; show/hide panels ── */}
        {tab === 'reviews' && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setShowReviewsPanel((v) => {
                    const n = !v
                    try {
                      localStorage.setItem('bh_platform_reviews_panel', n ? '1' : '0')
                    } catch {
                      /* ignore */
                    }
                    return n
                  })
                }}
                style={{
                  padding: '9px 14px', borderRadius: 8,
                  border: '1px solid var(--border-2)', background: showReviewsPanel ? 'var(--surface-2)' : 'transparent',
                  color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {showReviewsPanel ? '▼' : '▶'} Submitted reviews
                {reviews.length > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 500 }}>({reviews.length})</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReviewsOrgList((v) => {
                    const n = !v
                    try {
                      localStorage.setItem('bh_platform_reviews_orglist', n ? '1' : '0')
                    } catch {
                      /* ignore */
                    }
                    return n
                  })
                }}
                style={{
                  padding: '9px 14px', borderRadius: 8,
                  border: '1px solid var(--border-2)', background: showReviewsOrgList ? 'var(--surface-2)' : 'transparent',
                  color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {showReviewsOrgList ? '▼' : '▶'} All organisations
                <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 500 }}>({orgs.length})</span>
              </button>
            </div>

            {!showReviewsPanel && !showReviewsOrgList && (
              <EmptyState>Use the buttons above to show submitted feedback or the full organisation list.</EmptyState>
            )}

            {showReviewsPanel && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: showReviewsOrgList ? 20 : 0 }}>
                {loadingReviews ? <EmptyState>Loading…</EmptyState>
                : reviews.length === 0 ? <EmptyState>No reviews submitted yet.</EmptyState>
                : (
                  <div>
                    {reviews.map((r, i) => {
                      const orgName = Array.isArray(r.orgs) ? (r.orgs as unknown as { name: string }[])[0]?.name : r.orgs?.name
                      return (
                        <div key={r.id} style={{
                          padding: '18px 20px',
                          borderBottom: i < reviews.length - 1 ? '1px solid var(--border)' : 'none',
                          display: 'flex', gap: 16, alignItems: 'flex-start',
                        }}>
                          <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, paddingTop: 2 }}>
                            {'⭐'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: 14 }}>
                                {r.reviewer_name || orgName || 'Anonymous'}
                              </span>
                              {orgName && r.reviewer_name && (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{orgName}</span>
                              )}
                              <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                                {new Date(r.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                            {r.body && (
                              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.6 }}>
                                &ldquo;{r.body}&rdquo;
                              </p>
                            )}
                            <button
                              onClick={() => handleTogglePublish(r)}
                              style={{
                                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                border: 'none',
                                background: r.is_published ? 'rgba(34,197,94,0.15)' : 'var(--surface-2)',
                                color: r.is_published ? '#4ADE80' : 'var(--text-muted)',
                              }}
                            >
                              {r.is_published ? '✓ Published' : 'Publish'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {showReviewsOrgList && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {loadingOrgs ? <EmptyState>Loading…</EmptyState>
                : orgsError ? <EmptyState>{orgsError}</EmptyState>
                : orgs.length === 0 ? <EmptyState>No organisations.</EmptyState>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Slug</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
                        <th style={{ padding: '12px 16px', width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {orgs.map((o) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600 }}>{o.name}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }} className="mono">{o.slug}</td>
                          <td style={{ padding: '12px 16px', color: o.is_active ? '#4ADE80' : '#888' }}>
                            {o.is_active ? 'Active' : 'Inactive'}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <Link
                              href={`/platform/orgs/${o.id}`}
                              style={{
                                fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none',
                              }}
                            >
                              Open →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {moveConfirm && (
        <AdminModal
          onClose={() => { if (!assigning) setMoveConfirm(null) }}
          title="Move user to another organisation?"
        >
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 }}>
            This user is already in <strong style={{ color: 'var(--text)' }}>{moveConfirm.existingOrgName}</strong>.
            They cannot belong to two organisations at once.
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            Do you want to <strong style={{ color: 'var(--text)' }}>move</strong> them to{' '}
            <strong style={{ color: 'var(--text)' }}>{moveConfirm.orgName}</strong> as{' '}
            <strong style={{ color: 'var(--text)' }}>{moveConfirm.role}</strong>? Their previous membership will be removed.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              disabled={!!assigning}
              onClick={() => setMoveConfirm(null)}
              style={{
                padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-2)',
                background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: assigning ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!!assigning}
              onClick={() => void handleMoveConfirmAuthorize()}
              style={{
                padding: '10px 18px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: assigning ? 'default' : 'pointer',
              }}
            >
              {assigning ? 'Moving…' : 'Move user'}
            </button>
          </div>
        </AdminModal>
      )}

      {/* ── New Org Modal ── */}
      {showModal && (
        <AdminModal onClose={() => setShowModal(false)} title="New Organisation">
          <form onSubmit={handleCreate}>
            <FormField label="Company name">
              <input type="text" required placeholder="Brisbane Biohazard Cleaning" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </FormField>
            <FormField label="URL slug">
              <input type="text" required placeholder="brisbanebiohazardcleaning" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
            </FormField>
            <FormField label="Plan">
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </FormField>
            <FormField label="Seat limit">
              <input type="number" min={1} value={form.seat_limit} onChange={e => setForm(f => ({ ...f, seat_limit: e.target.value }))} />
            </FormField>
            <ModalFooter onCancel={() => setShowModal(false)} submitLabel={submitting ? 'Creating…' : 'Create Organisation'} disabled={submitting} />
          </form>
        </AdminModal>
      )}

      {/* ── Invite Modal ── */}
      {showInviteModal && (
        <AdminModal onClose={() => setShowInviteModal(false)} title="Invite user (Clerk)">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>
            Sends a Clerk sign-up invite. Choose an <strong style={{ color: 'var(--text)' }}>existing</strong> organisation so they land in the right company after signup — or leave unassigned and use the <strong style={{ color: 'var(--text)' }}>Pending</strong> tab to place them later.
          </p>
          <form onSubmit={handleInvite}>
            <FormField label="Email address">
              <input type="email" required placeholder="admin@company.com.au" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            </FormField>
            <FormField label="Connect to organisation">
              <select value={inviteOrg} onChange={e => setInviteOrg(e.target.value)}>
                <option value="">Not yet — assign from Pending after they sign up</option>
                {orgs.filter(o => o.is_active).map(o => <option key={o.id} value={o.slug}>{o.name}</option>)}
              </select>
            </FormField>
            {inviteOk
              ? <div style={{ textAlign: 'center', padding: '16px 0', color: '#4ADE80', fontWeight: 700 }}>✓ Invite sent</div>
              : <ModalFooter onCancel={() => setShowInviteModal(false)} submitLabel={inviting ? 'Sending…' : 'Send Invite'} disabled={inviting} />
            }
          </form>
        </AdminModal>
      )}
    </div>
  )
}

/* ── Sub-components ──────────────────────────── */

function PlanPill({ plan }: { plan: string }) {
  const c: Record<string, { bg: string; fg: string }> = {
    solo:     { bg: 'rgba(100,100,100,0.12)', fg: '#666' },
    team:     { bg: 'rgba(59,130,246,0.1)',  fg: '#60A5FA' },
    business: { bg: 'rgba(255,107,53,0.1)',  fg: 'var(--accent)' },
  }
  const s = c[plan] ?? c.solo
  return (
    <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg, textTransform: 'capitalize', letterSpacing: '0.04em' }}>
      {plan}
    </span>
  )
}

function TinyButton({
  label,
  onClick,
  primary,
  disabled,
}: {
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={!!disabled}
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        background: primary ? 'var(--surface-3)' : 'transparent',
        border: `1px solid ${primary ? 'var(--border-2)' : 'var(--border)'}`,
        color: primary ? 'var(--text)' : 'var(--text-muted)',
        transition: 'all 0.12s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}

function UserAvatar({ name, imageUrl }: { name: string; imageUrl: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (imageUrl) return <img src={imageUrl} alt={name} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return (
    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-3)', border: '1px solid var(--border-2)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '48px 28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{children}</div>
}

function AdminModal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 14, padding: 32, width: 440, maxWidth: '100%' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 24, letterSpacing: '-0.02em' }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

function ModalFooter({ onCancel, submitLabel, disabled }: { onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
      <button type="button" onClick={onCancel} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Cancel
      </button>
      <button type="submit" disabled={disabled} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--surface-3)', color: 'var(--text)', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: disabled ? 0.6 : 1 }}>
        {submitLabel}
      </button>
    </div>
  )
}
