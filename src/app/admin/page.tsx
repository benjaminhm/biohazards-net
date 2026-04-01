'use client'

import { useEffect, useState } from 'react'
import type { Org } from '@/lib/types'

interface OrgWithCount extends Org {
  user_count: number
}

interface NewOrgForm {
  name: string
  slug: string
  plan: string
  seat_limit: string
}

const PLAN_OPTIONS = ['solo', 'team', 'business']

export default function AdminPage() {
  const [orgs, setOrgs] = useState<OrgWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewOrgForm>({ name: '', slug: '', plan: 'solo', seat_limit: '1' })
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Org>>({})

  async function fetchOrgs() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/orgs')
      if (!res.ok) throw new Error('Failed to fetch orgs')
      const json = await res.json()
      setOrgs(json.orgs ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrgs() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          plan: form.plan,
          seat_limit: parseInt(form.seat_limit, 10) || 1,
        }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Failed to create org')
      }
      setShowModal(false)
      setForm({ name: '', slug: '', plan: 'solo', seat_limit: '1' })
      await fetchOrgs()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit(org: OrgWithCount) {
    setEditingId(org.id)
    setEditForm({ plan: org.plan, seat_limit: org.seat_limit, is_active: org.is_active })
  }

  async function handleSaveEdit(id: string) {
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error('Failed to update org')
      setEditingId(null)
      await fetchOrgs()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    }
  }

  async function handleToggleActive(org: OrgWithCount) {
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !org.is_active }),
      })
      if (!res.ok) throw new Error('Failed to update org')
      await fetchOrgs()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error')
    }
  }

  const totalOrgs = orgs.length
  const activeOrgs = orgs.filter((o) => o.is_active).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: '32px 24px', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            &#9889; biohazards.net Platform
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Platform administration — manage organisations</p>
        </div>
        <button
          data-devid="P6-E2"
          onClick={() => setShowModal(true)}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          &#xFF0B; New Organisation
        </button>
      </div>

      {/* Stats */}
      <div data-devid="P6-E1" style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        <StatCard label="Total Orgs" value={totalOrgs} />
        <StatCard label="Active Orgs" value={activeOrgs} />
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#3a1a1a', border: '1px solid #7a2a2a', borderRadius: 8, padding: '12px 16px', marginBottom: 24, color: '#ff8888', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div data-devid="P6-E3" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading&hellip;</div>
        ) : orgs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No organisations yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Slug', 'Plan', 'Seats', 'Users', 'Status', 'Created', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{org.name}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{org.slug}</td>

                  {editingId === org.id ? (
                    <>
                      <td style={{ padding: '8px 16px' }}>
                        <select
                          value={editForm.plan ?? org.plan}
                          onChange={(e) => setEditForm((f) => ({ ...f, plan: e.target.value as Org['plan'] }))}
                          style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
                        >
                          {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px 16px' }}>
                        <input
                          type="number"
                          min={1}
                          value={editForm.seat_limit ?? org.seat_limit}
                          onChange={(e) => setEditForm((f) => ({ ...f, seat_limit: parseInt(e.target.value, 10) || 1 }))}
                          style={{ width: 70, padding: '4px 8px', fontSize: 13 }}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '12px 16px' }}>
                        <PlanBadge plan={org.plan} />
                      </td>
                      <td style={{ padding: '12px 16px' }}>{org.seat_limit}</td>
                    </>
                  )}

                  <td style={{ padding: '12px 16px' }}>{org.user_count}</td>

                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 600,
                      background: org.is_active ? 'rgba(60,180,80,0.15)' : 'rgba(180,60,60,0.15)',
                      color: org.is_active ? '#4ecb6a' : '#e06060',
                    }}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </span>
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
                          <ActionButton label="Edit" onClick={() => handleEdit(org)} />
                          <ActionButton
                            label={org.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() => handleToggleActive(org)}
                          />
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

      {/* New Org Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 440, maxWidth: '90vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>New Organisation</h2>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--text-muted)' }}>Name</label>
                <input
                  type="text"
                  required
                  placeholder="Brisbane Biohazard Cleaning"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--text-muted)' }}>Slug</label>
                <input
                  type="text"
                  required
                  placeholder="brisbanebiohazardcleaning"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--text-muted)' }}>Plan</label>
                <select value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}>
                  {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--text-muted)' }}>Seat Limit</label>
                <input
                  type="number"
                  min={1}
                  value={form.seat_limit}
                  onChange={(e) => setForm((f) => ({ ...f, seat_limit: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

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
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg }}>
      {plan}
    </span>
  )
}

function ActionButton({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 6,
        border: accent ? 'none' : '1px solid var(--border)',
        background: accent ? 'var(--accent)' : 'transparent',
        color: accent ? '#fff' : 'var(--text)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
