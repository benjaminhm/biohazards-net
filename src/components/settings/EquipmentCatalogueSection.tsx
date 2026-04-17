/*
 * components/settings/EquipmentCatalogueSection.tsx
 *
 * Org-level equipment catalogue editor mounted on /settings.
 *
 * Source of truth: company_profile.equipment_catalogue (see /api/company/equipment).
 * The catalogue feeds the Assessment → Equipment checklist on every job, so:
 *   - Names should match how the team talks about the gear (not model numbers).
 *   - Archiving (instead of hard-deleting) keeps historical job references resolving.
 *
 * Grouped by category for scannability; add form at the bottom.
 */
'use client'

import { useEffect, useState } from 'react'
import {
  EQUIPMENT_CATEGORY_LABELS,
  type EquipmentCatalogueItem,
  type EquipmentCategory,
} from '@/lib/types'

const CATEGORIES = Object.keys(EQUIPMENT_CATEGORY_LABELS) as EquipmentCategory[]

export default function EquipmentCatalogueSection() {
  const [items, setItems] = useState<EquipmentCatalogueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState<EquipmentCategory>('instruments')
  const [draftNotes, setDraftNotes] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/company/equipment')
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setItems(Array.isArray(d.items) ? d.items : [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function addItem() {
    const name = draftName.trim()
    if (!name || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/company/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category: draftCategory, notes: draftNotes.trim() || undefined }),
      })
      const data = (await res.json()) as { items?: EquipmentCatalogueItem[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save')
      setItems(data.items ?? [])
      setDraftName('')
      setDraftNotes('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function patchItem(id: string, patch: Partial<EquipmentCatalogueItem>) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/company/equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const data = (await res.json()) as { items?: EquipmentCatalogueItem[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save')
      setItems(data.items ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function archiveItem(id: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/company/equipment?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = (await res.json()) as { items?: EquipmentCatalogueItem[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Could not archive')
      setItems(data.items ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not archive')
    } finally {
      setSaving(false)
    }
  }

  const active = items.filter(i => !i.archived)
  const archived = items.filter(i => i.archived)
  const grouped = CATEGORIES.map(cat => ({
    cat,
    rows: active.filter(i => i.category === cat).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter(g => g.rows.length > 0)

  return (
    <section style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Equipment catalogue</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Feeds the Assessment → Equipment checklist on every job.
        </span>
      </div>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: '#fecaca',
            border: '1px solid #7f1d1d',
            background: 'rgba(127,29,29,0.15)',
            padding: '8px 10px',
            borderRadius: 8,
            margin: '10px 0',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          {grouped.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-muted)',
                padding: 12,
                border: '1px dashed var(--border)',
                borderRadius: 10,
                marginTop: 8,
              }}
            >
              No catalogue items yet. Add the equipment your team actually uses — techs will see
              them as a tickable checklist on every job, and the AI will match suggestions to
              these names.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16, marginTop: 10 }}>
              {grouped.map(group => (
                <div
                  key={group.cat}
                  style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      background: 'var(--surface-2)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {EQUIPMENT_CATEGORY_LABELS[group.cat]} · {group.rows.length}
                  </div>
                  <div>
                    {group.rows.map(item => (
                      <EquipmentRow
                        key={item.id}
                        item={item}
                        saving={saving}
                        onPatch={patchItem}
                        onArchive={archiveItem}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          <div
            style={{
              marginTop: 18,
              padding: 14,
              border: '1px dashed var(--border-2)',
              borderRadius: 10,
              background: 'var(--surface)',
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Add equipment</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 10 }}>
              <input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                placeholder="e.g. HEPA air scrubber, Protimeter MMS3"
                maxLength={80}
                style={inputStyle}
              />
              <select
                value={draftCategory}
                onChange={e => setDraftCategory(e.target.value as EquipmentCategory)}
                style={inputStyle}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {EQUIPMENT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              placeholder="Notes (optional) — e.g. Calibrated quarterly"
              maxLength={240}
              style={inputStyle}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={saving || !draftName.trim()}
                onClick={() => void addItem()}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  cursor: saving || !draftName.trim() ? 'not-allowed' : 'pointer',
                  opacity: saving || !draftName.trim() ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Add to catalogue'}
              </button>
            </div>
          </div>

          {archived.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setShowArchived(v => !v)}
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {showArchived ? `Hide archived (${archived.length})` : `Show archived (${archived.length})`}
              </button>
              {showArchived && (
                <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                  {archived.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        opacity: 0.75,
                      }}
                    >
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: 'var(--text)' }}>{item.name}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>
                          {EQUIPMENT_CATEGORY_LABELS[item.category]}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void patchItem(item.id, { archived: false })}
                        disabled={saving}
                        style={{
                          fontSize: 12,
                          color: 'var(--accent)',
                          background: 'none',
                          border: 'none',
                          cursor: saving ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
}

function EquipmentRow({
  item,
  saving,
  onPatch,
  onArchive,
}: {
  item: EquipmentCatalogueItem
  saving: boolean
  onPatch: (id: string, patch: Partial<EquipmentCatalogueItem>) => void
  onArchive: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [category, setCategory] = useState<EquipmentCategory>(item.category)

  function commit() {
    const patch: Partial<EquipmentCatalogueItem> = {}
    if (name.trim() && name.trim() !== item.name) patch.name = name.trim()
    if (category !== item.category) patch.category = category
    if (notes.trim() !== (item.notes ?? '')) patch.notes = notes.trim()
    if (Object.keys(patch).length > 0) onPatch(item.id, patch)
    setEditing(false)
  }

  if (editing) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} style={inputStyle} />
        <select
          value={category}
          onChange={e => setCategory(e.target.value as EquipmentCategory)}
          style={inputStyle}
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c}>
              {EQUIPMENT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={commit}
            disabled={saving}
            style={{
              fontSize: 12,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setName(item.name)
              setNotes(item.notes ?? '')
              setCategory(item.category)
              setEditing(false)
            }}
            style={{
              fontSize: 12,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          maxLength={240}
          style={{ ...inputStyle, gridColumn: '1 / span 3', marginTop: 2 }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.name}</div>
        {item.notes && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.notes}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Archive "${item.name}"? Historical jobs still resolve the name.`)) {
              onArchive(item.id)
            }
          }}
          disabled={saving}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          Archive
        </button>
      </div>
    </div>
  )
}
