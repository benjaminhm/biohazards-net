'use client'

import { useEffect, useState } from 'react'
import type { Org } from '@/lib/types'

const PLATFORM_OWNER_ID = 'user_3BkVAf7042IsBwqabQ9MoZdEbvE'

interface OrgWithCount extends Org { user_count: number }
interface NewOrgForm { name: string; slug: string; plan: string; seat_limit: string }
interface AdminUser {
  id: string
  clerk_user_id: string
  org_id: string
  role: string
  email: string
  name: string
  image_url: string
  created_at: string
  orgs: { name: string; slug: string }
}
interface PendingUser {
  clerk_user_id: string
  email: string
  name: string
  image_url: string
  created_at: string
}

const PLAN_OPTIONS = ['solo', 'team', 'business']
type Tab = 'orgs' | 'admins' | 'pending'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('orgs')

  // — Orgs —
  const [orgs, setOrgs] = useState<OrgWithCount[]>([])
  const [loadingOrgs, setLoadingOrgs] = useState(true)
  const [orgsError, setOrgsError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewOrgForm>({ name: '', slug: '', plan: 'solo', seat_limit: '1' })
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Org>>({})

  // — Admins —
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteOrg, setInviteOrg] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteOk, setInviteOk] = useState(false)

  // — Pending —
  const [pending, setPending] = useState<PendingUser[]>([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [assignOrg, setAssignOrg] = useState('')
  const [assignRole, setAssignRole] = useState('owner')
  const [assigning, setAssigning] = useState(false)

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

  async function fetchAdmins() {
    setLoadingAdmins(true)
    try {
      const res = await fetch('/api/admin/users')
      const json = await res.json()
      // Pin platform owner first
      const sorted = (json.users ?? []).sort((a: AdminUser, b: AdminUser) => {
        if (a.clerk_user_id === PLATFORM_OWNER_ID) return -1
        if (b.clerk_user_id === PLATFORM_OWNER_ID) return 1
        return 0
      })
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

  useEffect(() => { fetchOrgs() }, [])
  useEffect(() => { if (tab === 'admins') fetchAdmins() }, [tab])
  useEffect(() => { if (tab === 'pending') fetchPending() }, [tab])

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
    try {
      await fetch(`/api/admin/orgs/${org.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !org.is_active }) })
      await fetchOrgs()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setInviting(true)
    try {
      const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, org_slug: inviteOrg }) })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed') }
      setInviteOk(true); setTimeout(() => { setInviteOk(false); setShowInviteModal(false); setInviteEmail(''); setInviteOrg('') }, 2000)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setInviting(false) }
  }

  async function handleAssign(clerkUserId: string) {
    if (!assignOrg) return alert('Select an organisation')
    setAssigning(true)
    try {
      const org = orgs.find(o => o.slug === assignOrg)
      if (!org) throw new Error('Org not found')
      const res = await fetch('/api/admin/users/pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clerk_user_id: clerkUserId, org_id: org.id, role: assignRole }) })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed') }
      setAssigningId(null); await fetchPending(); await fetchAdmins()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setAssigning(false) }
  }

  const totalOrgs = orgs.length
  const activeOrgs = orgs.filter(o => o.is_active).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>⚡ biohazards.net Platform</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>Platform administration</div>
        </div>
        {tab === 'orgs' && (
          <button onClick={() => setShowModal(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            + New Organisation
          </button>
        )}
        {tab === 'admins' && (
          <button onClick={() => setShowInviteModal(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            ✉️ Invite Administrator
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', display: 'flex', gap: 0 }}>
        {(['orgs', 'admins', 'pending'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '14px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: tab === t ? 'var(--accent)' : 'var(--text-muted)', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', textTransform: 'capitalize', position: 'relative' }}>
            {t === 'orgs' ? 'Organisations' : t === 'admins' ? 'Administrators' : 'Pending'}
            {t === 'pending' && pending.length > 0 && (
              <span style={{ marginLeft: 6, background: '#F87171', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '1px 6px' }}>{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: '32px 24px' }}>

        {/* ── Orgs tab ── */}
        {tab === 'orgs' && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
              <StatCard label="Total Orgs" value={totalOrgs} />
              <StatCard label="Active Orgs" value={activeOrgs} />
            </div>
            {orgsError && <div style={{ background: '#3a1a1a', border: '1px solid #7a2a2a', borderRadius: 8, padding: '12px 16px', marginBottom: 24, color: '#ff8888', fontSize: 14 }}>{orgsError}</div>}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {loadingOrgs ? <CentreMsg>Loading…</CentreMsg> : orgs.length === 0 ? <CentreMsg>No organisations yet.</CentreMsg> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Name', 'Slug', 'Plan', 'Seats', 'Users', 'Status', 'Created', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map(org => (
                      <tr key={org.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{org.name}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{org.slug}</td>
                        {editingId === org.id ? (
                          <>
                            <td style={{ padding: '8px 16px' }}>
                              <select value={editForm.plan ?? org.plan} onChange={e => setEditForm(f => ({ ...f, plan: e.target.value as Org['plan'] }))} style={{ padding: '4px 8px', fontSize: 13 }}>
                                {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '8px 16px' }}>
                              <input type="number" min={1} value={editForm.seat_limit ?? org.seat_limit} onChange={e => setEditForm(f => ({ ...f, seat_limit: parseInt(e.target.value, 10) || 1 }))} style={{ width: 70, padding: '4px 8px', fontSize: 13 }} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '12px 16px' }}><PlanBadge plan={org.plan} /></td>
                            <td style={{ padding: '12px 16px' }}>{org.seat_limit}</td>
                          </>
                        )}
                        <td style={{ padding: '12px 16px' }}>{org.user_count}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <StatusBadge active={org.is_active} />
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                          {new Date(org.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {editingId === org.id ? (
                              <>
                                <ActionButton label="Save" onClick={() => handleSaveEdit(org.id)} accent />
                                <ActionButton label="Cancel" onClick={() => setEditingId(null)} />
                              </>
                            ) : (
                              <>
                                <ActionButton label="Edit" onClick={() => { setEditingId(org.id); setEditForm({ plan: org.plan, seat_limit: org.seat_limit, is_active: org.is_active }) }} />
                                <ActionButton label={org.is_active ? 'Deactivate' : 'Activate'} onClick={() => handleToggleActive(org)} />
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
            {loadingAdmins ? <CentreMsg>Loading…</CentreMsg> : admins.length === 0 ? <CentreMsg>No administrators yet.</CentreMsg> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['#', 'User', 'Email', 'Organisation', 'Role', 'Since'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {admins.map((u, i) => {
                    const isPlatformOwner = u.clerk_user_id === PLATFORM_OWNER_ID
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', background: isPlatformOwner ? 'rgba(255,107,53,0.04)' : 'transparent' }}>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                          {isPlatformOwner ? '👑' : i + 1}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <UserAvatar name={u.name} imageUrl={u.image_url} />
                            <div>
                              <div style={{ fontWeight: 600 }}>{u.name}</div>
                              {isPlatformOwner && <div style={{ fontSize: 11, color: 'var(--accent)' }}>Platform Owner</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{u.email}</td>
                        <td style={{ padding: '12px 16px' }}>{u.orgs?.name ?? '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'rgba(53,130,220,0.15)', color: '#6ab0ff' }}>{u.role}</span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                          {new Date(u.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Pending tab ── */}
        {tab === 'pending' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {loadingPending ? <CentreMsg>Loading…</CentreMsg> : pending.length === 0 ? (
              <CentreMsg>No pending users. Send an invite from the Administrators tab.</CentreMsg>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['User', 'Email', 'Signed up', 'Assign to'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pending.map(u => (
                    <tr key={u.clerk_user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <UserAvatar name={u.name} imageUrl={u.image_url} />
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{u.email}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                        {new Date(u.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {assigningId === u.clerk_user_id ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={assignOrg} onChange={e => setAssignOrg(e.target.value)} style={{ padding: '4px 8px', fontSize: 13 }}>
                              <option value="">Select org…</option>
                              {orgs.filter(o => o.is_active).map(o => <option key={o.id} value={o.slug}>{o.name}</option>)}
                            </select>
                            <select value={assignRole} onChange={e => setAssignRole(e.target.value)} style={{ padding: '4px 8px', fontSize: 13 }}>
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="operator">Operator</option>
                            </select>
                            <ActionButton label={assigning ? '…' : 'Confirm'} onClick={() => handleAssign(u.clerk_user_id)} accent />
                            <ActionButton label="Cancel" onClick={() => setAssigningId(null)} />
                          </div>
                        ) : (
                          <ActionButton label="Assign" onClick={() => { setAssigningId(u.clerk_user_id); setAssignOrg(''); setAssignRole('owner') }} accent />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* New Org Modal */}
      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>New Organisation</h2>
          <form onSubmit={handleCreate}>
            <Field label="Name"><input type="text" required placeholder="Brisbane Biohazard Cleaning" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Slug"><input type="text" required placeholder="brisbanebiohazardcleaning" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} /></Field>
            <Field label="Plan">
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Seat Limit"><input type="number" min={1} value={form.seat_limit} onChange={e => setForm(f => ({ ...f, seat_limit: e.target.value }))} /></Field>
            <ModalActions onCancel={() => setShowModal(false)} submitLabel={submitting ? 'Creating…' : 'Create'} disabled={submitting} />
          </form>
        </Modal>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <Modal onClose={() => setShowInviteModal(false)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Invite Administrator</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>They'll receive an invite email and sign up into the Pending queue until you assign them.</p>
          <form onSubmit={handleInvite}>
            <Field label="Email address"><input type="email" required placeholder="admin@company.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></Field>
            <Field label="Organisation (optional)">
              <select value={inviteOrg} onChange={e => setInviteOrg(e.target.value)}>
                <option value="">None — pending assignment</option>
                {orgs.filter(o => o.is_active).map(o => <option key={o.id} value={o.slug}>{o.name}</option>)}
              </select>
            </Field>
            {inviteOk
              ? <div style={{ textAlign: 'center', padding: 16, color: '#4ADE80', fontWeight: 600 }}>✓ Invite sent!</div>
              : <ModalActions onCancel={() => setShowInviteModal(false)} submitLabel={inviting ? 'Sending…' : 'Send Invite'} disabled={inviting} />
            }
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 24px', minWidth: 140 }}>
      <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    solo: { bg: 'rgba(100,100,100,0.2)', fg: '#aaa' },
    team: { bg: 'rgba(53,130,220,0.15)', fg: '#6ab0ff' },
    business: { bg: 'rgba(255,107,53,0.15)', fg: 'var(--accent)' },
  }
  const c = colors[plan] ?? colors.solo
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg }}>{plan}</span>
}

function StatusBadge({ active }: { active: boolean }) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: active ? 'rgba(60,180,80,0.15)' : 'rgba(180,60,60,0.15)', color: active ? '#4ecb6a' : '#e06060' }}>{active ? 'Active' : 'Inactive'}</span>
}

function ActionButton({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button onClick={onClick} style={{ padding: '5px 12px', borderRadius: 6, border: accent ? 'none' : '1px solid var(--border)', background: accent ? 'var(--accent)' : 'transparent', color: accent ? '#fff' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
      {label}
    </button>
  )
}

function UserAvatar({ name, imageUrl }: { name: string; imageUrl: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (imageUrl) return <img src={imageUrl} alt={name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{initials}</div>
}

function CentreMsg({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{children}</div>
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 440, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

function ModalActions({ onCancel, submitLabel, disabled }: { onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
      <button type="button" onClick={onCancel} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
      <button type="submit" disabled={disabled} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: disabled ? 0.7 : 1 }}>{submitLabel}</button>
    </div>
  )
}
