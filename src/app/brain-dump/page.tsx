/*
 * app/brain-dump/page.tsx
 *
 * Brain Dump — a private, per-admin room for freeform capture.
 *
 * Flow:
 *   1. Admin types or dictates a brain-dump into the capture panel
 *      (see components/brainDump/BrainDumpCapture).
 *   2. "Structure with AI" POSTs /api/brain-dump/structure. Claude splits
 *      the text into atomic items (todo / reminder / note / moment) and
 *      the server inserts them into brain_dump_items, stamped with the
 *      caller as owner.
 *   3. The living list below renders every open + done item *for this
 *      admin only*. HITL is mandatory: every item can be edited inline,
 *      re-bucketed, toggled done, or soft-deleted — nothing auto-sends
 *      anywhere.
 *
 * Access: org admins only, and per-user scoped on the server. Two admins
 * in the same org do NOT see each other's items. Non-admins are
 * redirected to /. See docs/ai-product-principles.md — AI is invisible
 * to clients; this surface is staff-only with HITL control.
 *
 * Reminders carry a due_at but are NOT yet wired to any scheduler.
 */
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import BrainDumpCapture from '@/components/brainDump/BrainDumpCapture'
import BrainDumpItemCard from '@/components/brainDump/BrainDumpItemCard'
import type { BrainDumpItem } from '@/components/brainDump/types'

type GroupKey = 'open' | 'done'

export default function BrainDumpPage() {
  const router = useRouter()
  const { isAdmin, loading: userLoading } = useUser()
  const [items, setItems] = useState<BrainDumpItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [structuring, setStructuring] = useState(false)
  const [structureError, setStructureError] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [filter, setFilter] = useState<'all' | BrainDumpItem['kind']>('all')

  useEffect(() => {
    if (!userLoading && !isAdmin) router.replace('/')
  }, [userLoading, isAdmin, router])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const res = await fetch('/api/brain-dump')
      const data = (await res.json()) as { items?: BrainDumpItem[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not load items')
      setItems(data.items ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!userLoading && isAdmin) void load()
  }, [userLoading, isAdmin, load])

  async function handleStructure(text: string) {
    setStructureError('')
    setStructuring(true)
    try {
      const res = await fetch('/api/brain-dump/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = (await res.json()) as { items?: BrainDumpItem[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'AI structure failed')
      if (data.items?.length) {
        setItems(prev => [...data.items!, ...prev])
      } else {
        await load()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI structure failed'
      setStructureError(msg)
      throw e instanceof Error ? e : new Error(msg)
    } finally {
      setStructuring(false)
    }
  }

  async function patchItem(id: string, patch: Partial<BrainDumpItem>) {
    const prev = items
    setItems(prev.map(it => (it.id === id ? { ...it, ...patch } : it)))
    try {
      const res = await fetch(`/api/brain-dump/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json()) as { item?: BrainDumpItem; error?: string }
      if (!res.ok) throw new Error(data.error || 'Update failed')
      if (data.item) {
        setItems(cur => cur.map(it => (it.id === id ? data.item! : it)))
      }
    } catch (e) {
      setItems(prev)
      console.error('[brain-dump patch]', e)
    }
  }

  async function deleteItem(id: string) {
    const prev = items
    setItems(prev.filter(it => it.id !== id))
    try {
      const res = await fetch(`/api/brain-dump/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    } catch (e) {
      setItems(prev)
      console.error('[brain-dump delete]', e)
    }
  }

  const grouped = useMemo(() => {
    const visible = items.filter(it => filter === 'all' || it.kind === filter)
    const groups: Record<GroupKey, BrainDumpItem[]> = { open: [], done: [] }
    for (const it of visible) {
      if (it.status === 'done') groups.done.push(it)
      else groups.open.push(it)
    }
    return groups
  }, [items, filter])

  const counts = useMemo(() => {
    const c = { all: 0, todo: 0, reminder: 0, note: 0, moment: 0 }
    for (const it of items) {
      if (it.status === 'done') continue
      c.all += 1
      c[it.kind] += 1
    }
    return c
  }, [items])

  if (!userLoading && !isAdmin) return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{ padding: '28px 20px 16px', maxWidth: 920, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-muted)',
              fontSize: 13,
              textDecoration: 'none',
              padding: '4px 0',
            }}
          >
            ← Dashboard
          </Link>
        </div>
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>Your private workspace</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '4px 0 0' }}>
          Brain Dump
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          Your personal living list — only you see these items. Capture freeform
          thoughts and let AI sort them into todos, reminders, notes, and
          moments. You stay in charge of every item.
        </div>
      </header>

      <main
        style={{
          maxWidth: 920,
          margin: '0 auto',
          padding: '0 20px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <BrainDumpCapture onStructure={handleStructure} structuring={structuring} />

        {structureError && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#F87171',
              fontSize: 13,
            }}
          >
            {structureError}
          </div>
        )}

        {/* Filter row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <FilterPill label="All"      active={filter === 'all'}      count={counts.all}      onClick={() => setFilter('all')} />
          <FilterPill label="Todos"    active={filter === 'todo'}     count={counts.todo}     onClick={() => setFilter('todo')} />
          <FilterPill label="Reminders" active={filter === 'reminder'} count={counts.reminder} onClick={() => setFilter('reminder')} />
          <FilterPill label="Notes"    active={filter === 'note'}     count={counts.note}     onClick={() => setFilter('note')} />
          <FilterPill label="Moments"  active={filter === 'moment'}   count={counts.moment}   onClick={() => setFilter('moment')} />
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setShowDone(v => !v)}
            style={{
              padding: '5px 10px',
              borderRadius: 99,
              border: '1px solid var(--border)',
              background: showDone ? 'var(--surface-2)' : 'transparent',
              color: 'var(--text-muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showDone ? 'Hide done' : `Show done${grouped.done.length ? ` (${grouped.done.length})` : ''}`}
          </button>
        </div>

        {/* Lists */}
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        ) : loadError ? (
          <div
            role="alert"
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#F87171',
              fontSize: 13,
            }}
          >
            {loadError}
          </div>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grouped.open.map(it => (
                <BrainDumpItemCard
                  key={it.id}
                  item={it}
                  onPatch={patchItem}
                  onDelete={deleteItem}
                />
              ))}
              {grouped.open.length === 0 && (
                <div
                  style={{
                    padding: '20px 16px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 13,
                    border: '1px dashed var(--border)',
                    borderRadius: 10,
                  }}
                >
                  Nothing open in this view.
                </div>
              )}
            </div>

            {showDone && grouped.done.length > 0 && (
              <div>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--text-dim)', marginBottom: 8, marginTop: 8 }}
                >
                  Done
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {grouped.done.map(it => (
                    <BrainDumpItemCard
                      key={it.id}
                      item={it}
                      onPatch={patchItem}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 11px',
        borderRadius: 99,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'rgba(255,107,53,0.12)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '0 6px',
          borderRadius: 99,
          background: active ? 'rgba(255,107,53,0.2)' : 'var(--surface-2)',
          color: active ? 'var(--accent)' : 'var(--text-dim)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '40px 20px',
        textAlign: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 14,
        color: 'var(--text-muted)',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
        Nothing captured yet
      </div>
      <div style={{ fontSize: 13, maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>
        Type or dictate anything that&apos;s on your mind — supplier orders, client
        details you need to remember, observations from a site visit. AI will
        split it into a tidy list you can edit and tick off.
      </div>
    </div>
  )
}
