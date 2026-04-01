'use client'

import { useEffect, useState } from 'react'
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
type Tab = 'orgs' | 'admins' | 'pending'

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

  const [pending, setPending]               = useState<PendingUser[]>([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [assigningId, setAssigningId]       = useState<string | null>(null)
  const [assignOrg, setAssignOrg]           = useState('')
  const [assignRole, setAssignRole]         = useState('owner')
  const [assigning, setAssigning]           = useState(false)

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
    await fetch(`/api/admin/orgs/${org.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !org.is_active }) })
    await fetchOrgs()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setInviting(true)
    try {
      const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, org_slug: inviteOrg }) })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed') }
      setInviteOk(true)
      setTimeout(() => { setInviteOk(false); setShowInviteModal(false); setInviteEmail(''); setInviteOrg('') }, 2000)
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
              onClick={() => setShowModal(true)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                borderRadius: 8, padding: '9px 16px',
                color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              + New Org
            </button>
          )}
          {tab === 'admins' && (
            <button
              onClick={() => setShowInviteModal(true)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                borderRadius: 8, padding: '9px 16px',
                color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Invite Administrator
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
        {(['orgs', 'admins', 'pending'] as Tab[]).map(t => (
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
            {t === 'orgs' ? 'Organisations' : t === 'admins' ? 'Administrators' : 'Pending'}
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

            {orgsError && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#F87171', fontSize: 13,
              }}>
                {orgsError}
              </div>
            )}

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
            : admins.length === 0 ? <EmptyState>No administrators yet.</EmptyState>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['', 'User', 'Email', 'Organisation', 'Role', 'Since'].map(h => (
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
            {loadingPending ? <EmptyState>Loading…</EmptyState>
            : pending.length === 0 ? (
              <EmptyState>No pending users. Send an invite from the Administrators tab.</EmptyState>
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
      </main>

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
        <AdminModal onClose={() => setShowInviteModal(false)} title="Invite Administrator">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>
            They&apos;ll receive an invite email. Once they sign up, assign them an organisation from the Pending tab.
          </p>
          <form onSubmit={handleInvite}>
            <FormField label="Email address">
              <input type="email" required placeholder="admin@company.com.au" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            </FormField>
            <FormField label="Organisation (optional)">
              <select value={inviteOrg} onChange={e => setInviteOrg(e.target.value)}>
                <option value="">None — pending assignment</option>
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

function TinyButton({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        background: primary ? 'var(--surface-3)' : 'transparent',
        border: `1px solid ${primary ? 'var(--border-2)' : 'var(--border)'}`,
        color: primary ? 'var(--text)' : 'var(--text-muted)',
        transition: 'all 0.12s',
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
