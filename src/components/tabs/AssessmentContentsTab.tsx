/*
 * Assessment → Contents. HITL inventory of personal property / belongings
 * observed at the site, scoped per room with disposition decisions that feed
 * insurance scopes, disposal manifests, and contents cleaning quotes.
 *
 * Sections:
 *   1. Confirmed inventory — rows grouped by room, inline edit / remove.
 *   2. Add row — inline form for manual additions (room, name, category,
 *      quantity, disposition, notes, optional replacement value).
 *   3. AI suggestions — suggested_contents_ai rows with Accept / Edit / Dismiss.
 *   4. Identify / Generate buttons (explicit HITL trigger; never auto-runs).
 *
 * All persisted to assessment_data.contents_items and suggested_contents_ai.
 */
'use client'

import { useMemo, useState } from 'react'
import type {
  AssessmentData,
  ContentsCategory,
  ContentsDisposition,
  ContentsItem,
  Job,
} from '@/lib/types'
import {
  CONTENTS_CATEGORY_LABELS,
  CONTENTS_DISPOSITION_LABELS,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'

const CATEGORIES = Object.keys(CONTENTS_CATEGORY_LABELS) as ContentsCategory[]
const DISPOSITIONS = Object.keys(CONTENTS_DISPOSITION_LABELS) as ContentsDisposition[]

const DISPOSITION_THEME: Record<ContentsDisposition, { bg: string; border: string; color: string }> = {
  salvage:       { bg: 'rgba(52, 211, 153, 0.16)',  border: 'rgba(52, 211, 153, 0.4)',  color: '#6EE7B7' },
  decontaminate: { bg: 'rgba(96, 165, 250, 0.18)',  border: 'rgba(96, 165, 250, 0.45)', color: '#93C5FD' },
  discard:       { bg: 'rgba(248, 113, 113, 0.18)', border: 'rgba(248, 113, 113, 0.45)',color: '#FCA5A5' },
  undetermined:  { bg: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.4)', color: '#CBD5E1' },
}

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

/** Tiny cuid-ish ID generator. crypto.randomUUID is available in modern browsers. */
function newItemId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export default function AssessmentContentsTab({ job, onJobUpdate }: Props) {
  const ad = job.assessment_data
  const areaNames = useMemo(
    () => (ad?.areas ?? []).map(a => a.name).filter(Boolean),
    [ad?.areas],
  )

  const items = useMemo(() => ad?.contents_items ?? [], [ad?.contents_items])
  const suggestions = useMemo(
    () => ad?.suggested_contents_ai?.items ?? [],
    [ad?.suggested_contents_ai?.items],
  )

  const itemsByRoom = useMemo(() => {
    const m = new Map<string, ContentsItem[]>()
    for (const i of items) {
      const arr = m.get(i.room) ?? []
      arr.push(i)
      m.set(i.room, arr)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  const countsByDisposition = useMemo(() => {
    const c: Record<ContentsDisposition, number> = { salvage: 0, decontaminate: 0, discard: 0, undetermined: 0 }
    for (const i of items) c[i.disposition] = (c[i.disposition] ?? 0) + i.quantity
    return c
  }, [items])

  // Draft row state for manual add
  const [draftRoom, setDraftRoom] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState<ContentsCategory>('furniture')
  const [draftQty, setDraftQty] = useState<string>('1')
  const [draftDisposition, setDraftDisposition] = useState<ContentsDisposition>('undetermined')
  const [draftNotes, setDraftNotes] = useState('')
  const [draftValue, setDraftValue] = useState('')

  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<ContentsItem | null>(null)

  const busy = identifyLoading || generateLoading || saving

  async function patchAssessment(next: AssessmentData, what: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: next }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? `Could not save ${what}`)
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function persistItems(nextItems: ContentsItem[], what: string) {
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      contents_items: nextItems,
    }
    void patchAssessment(merged, what)
  }

  function persistItemsAndConsumedSuggestion(nextItems: ContentsItem[], consumedId: string, what: string) {
    const nextSug = suggestions.filter(s => s.id !== consumedId)
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      contents_items: nextItems,
      suggested_contents_ai: ad?.suggested_contents_ai
        ? { items: nextSug, generated_at: ad.suggested_contents_ai.generated_at }
        : undefined,
    }
    void patchAssessment(merged, what)
  }

  function addManualItem() {
    const room = draftRoom.trim()
    const name = draftName.trim()
    if (!room || !name) {
      setError('Room and item name are both required.')
      return
    }
    const qty = Math.max(1, Math.min(9999, Math.floor(Number(draftQty) || 1)))
    const valueRaw = Number(draftValue)
    const replacement_value = Number.isFinite(valueRaw) && valueRaw > 0 ? valueRaw : undefined
    const next: ContentsItem = {
      id: newItemId('cnt'),
      room,
      name,
      category: draftCategory,
      quantity: qty,
      disposition: draftDisposition,
      ...(draftNotes.trim() ? { notes: draftNotes.trim().slice(0, 240) } : {}),
      ...(replacement_value !== undefined ? { replacement_value } : {}),
      source: 'manual',
    }
    setDraftName('')
    setDraftNotes('')
    setDraftValue('')
    setDraftQty('1')
    persistItems([...items, next], 'contents item')
  }

  function acceptSuggestion(s: ContentsItem) {
    const next: ContentsItem = {
      ...s,
      id: newItemId('cnt'),
      source: 'ai',
    }
    persistItemsAndConsumedSuggestion([...items, next], s.id, 'accepted suggestion')
  }

  function dismissSuggestion(id: string) {
    const nextSug = suggestions.filter(s => s.id !== id)
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_contents_ai: ad?.suggested_contents_ai
        ? { items: nextSug, generated_at: ad.suggested_contents_ai.generated_at }
        : undefined,
    }
    void patchAssessment(merged, 'dismissal')
  }

  function removeItem(id: string) {
    persistItems(items.filter(i => i.id !== id), 'remove')
  }

  function beginEdit(item: ContentsItem) {
    setEditingId(item.id)
    setEditDraft({ ...item })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
  }

  function commitEdit() {
    if (!editDraft) return
    const draft = editDraft
    const room = draft.room.trim()
    const name = draft.name.trim()
    if (!room || !name) {
      setError('Room and item name are both required.')
      return
    }
    const qty = Math.max(1, Math.min(9999, Math.floor(Number(draft.quantity) || 1)))
    const next: ContentsItem = {
      ...draft,
      room,
      name,
      quantity: qty,
      notes: draft.notes?.trim() ? draft.notes.trim().slice(0, 240) : undefined,
      replacement_value:
        draft.replacement_value && draft.replacement_value > 0 ? draft.replacement_value : undefined,
    }
    const nextItems = items.map(i => (i.id === draft.id ? next : i))
    setEditingId(null)
    setEditDraft(null)
    persistItems(nextItems, 'edit')
  }

  async function runAi(mode: 'identify' | 'generate') {
    if (mode === 'identify') {
      setIdentifyLoading(true)
      setIdentifyError('')
    } else {
      setGenerateLoading(true)
      setGenerateError('')
    }
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await res.json()
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'AI request failed')
      if (payload.job) onJobUpdate(payload.job)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI request failed'
      if (mode === 'identify') setIdentifyError(msg)
      else setGenerateError(msg)
    } finally {
      if (mode === 'identify') setIdentifyLoading(false)
      else setGenerateLoading(false)
    }
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {error && (
        <div style={errorBoxStyle}>{error}</div>
      )}

      {/* ── Summary / counts ──────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={sectionHeaderStyle}>
          <span>Confirmed inventory</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {items.length === 0
              ? 'Nothing added yet'
              : `${items.length} row${items.length === 1 ? '' : 's'} · ${items.reduce((n, i) => n + i.quantity, 0)} item${items.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="card" style={{ padding: 16, display: 'grid', gap: 14 }}>
          {items.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DISPOSITIONS.map(d => (
                <span key={d} style={countChipStyle(d, countsByDisposition[d])}>
                  <strong style={{ fontWeight: 700 }}>{countsByDisposition[d]}</strong> {CONTENTS_DISPOSITION_LABELS[d].split(' ')[0]}
                </span>
              ))}
            </div>
          )}
          {itemsByRoom.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No contents documented yet. Add rows manually below, or press Identify to extract items the AI
              finds in progress notes and photo captions.
            </div>
          ) : (
            itemsByRoom.map(([room, rows]) => (
              <div key={room}>
                <div style={roomHeadingStyle}>{room} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {rows.length}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {rows.map(item => (
                    editingId === item.id && editDraft ? (
                      <EditRow
                        key={item.id}
                        draft={editDraft}
                        setDraft={setEditDraft}
                        areaNames={areaNames}
                        busy={busy}
                        onCancel={cancelEdit}
                        onSave={commitEdit}
                      />
                    ) : (
                      <DisplayRow
                        key={item.id}
                        item={item}
                        busy={busy}
                        onEdit={() => beginEdit(item)}
                        onRemove={() => removeItem(item.id)}
                      />
                    )
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Add row form ──────────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={sectionHeaderStyle}>
          <span>Add item</span>
        </div>
        <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
          <datalist id="contents-room-options">
            {areaNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 2fr) minmax(0, 1.1fr) 70px minmax(0, 1.2fr)',
              gap: 8,
            }}
          >
            <input
              value={draftRoom}
              onChange={e => setDraftRoom(e.target.value)}
              placeholder="Room (e.g. Living room)"
              maxLength={64}
              list="contents-room-options"
              disabled={busy}
              style={inputStyle}
            />
            <input
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder="Item name (e.g. Leather couch)"
              maxLength={80}
              disabled={busy}
              style={inputStyle}
            />
            <select
              value={draftCategory}
              onChange={e => setDraftCategory(e.target.value as ContentsCategory)}
              disabled={busy}
              style={inputStyle}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{CONTENTS_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={9999}
              value={draftQty}
              onChange={e => setDraftQty(e.target.value)}
              disabled={busy}
              style={inputStyle}
              aria-label="Quantity"
            />
            <select
              value={draftDisposition}
              onChange={e => setDraftDisposition(e.target.value as ContentsDisposition)}
              disabled={busy}
              style={inputStyle}
            >
              {DISPOSITIONS.map(d => (
                <option key={d} value={d}>{CONTENTS_DISPOSITION_LABELS[d]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr) auto', gap: 8 }}>
            <input
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              placeholder="Notes (optional, e.g. condition, location detail)"
              maxLength={240}
              disabled={busy}
              style={inputStyle}
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={draftValue}
              onChange={e => setDraftValue(e.target.value)}
              placeholder="Replacement $ (optional)"
              disabled={busy}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={addManualItem}
              disabled={busy || !draftRoom.trim() || !draftName.trim()}
              style={primaryBtnStyle(busy || !draftRoom.trim() || !draftName.trim())}
            >
              Add item
            </button>
          </div>
        </div>
      </section>

      {/* ── AI suggestions ───────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={sectionHeaderStyle}>
          <span>AI suggestions</span>
          {suggestions.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {suggestions.length} pending
            </span>
          )}
        </div>
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 140 }}>
          {(identifyError || generateError) && (
            <div style={{ fontSize: 12, color: '#F87171' }}>
              {identifyError && <div>{identifyError}</div>}
              {generateError && <div>{generateError}</div>}
            </div>
          )}
          {suggestions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              None yet. Press Identify to extract contents explicitly named in progress notes and captions,
              or Generate for a broader room-by-room inventory proposal.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suggestions.map(s => (
                <SuggestionRow
                  key={s.id}
                  item={s}
                  busy={busy}
                  onAccept={() => acceptSuggestion(s)}
                  onDismiss={() => dismissSuggestion(s.id)}
                />
              ))}
            </div>
          )}
          <div
            style={{
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
              gap: 10, flexWrap: 'wrap', marginTop: 'auto',
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAi('identify')}
              style={ghostBtnStyle(busy)}
            >
              {identifyLoading ? 'Identifying…' : 'Identify'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAi('generate')}
              style={accentBtnStyle(busy)}
            >
              {generateLoading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

/* ────────────────────────── Row components ───────────────────────── */

function DisplayRow({
  item, busy, onEdit, onRemove,
}: { item: ContentsItem; busy: boolean; onEdit: () => void; onRemove: () => void }) {
  const t = DISPOSITION_THEME[item.disposition]
  return (
    <div style={displayRowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ×{item.quantity} · {CONTENTS_CATEGORY_LABELS[item.category]}
          {item.replacement_value ? ` · $${item.replacement_value.toLocaleString()}` : ''}
        </span>
        <span style={dispoPillStyle(t)}>{CONTENTS_DISPOSITION_LABELS[item.disposition].split(' ')[0]}</span>
        {item.notes && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
            — {item.notes}
          </span>
        )}
        {item.source === 'ai' && (
          <span style={aiBadgeStyle} title="Accepted from AI suggestion">AI</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" onClick={onEdit} disabled={busy} style={linkBtnStyle(busy)}>Edit</button>
        <button type="button" onClick={onRemove} disabled={busy} style={linkBtnStyle(busy)}>Remove</button>
      </div>
    </div>
  )
}

function EditRow({
  draft, setDraft, areaNames, busy, onCancel, onSave,
}: {
  draft: ContentsItem
  setDraft: (i: ContentsItem) => void
  areaNames: string[]
  busy: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div style={{ ...displayRowStyle, alignItems: 'stretch', flexDirection: 'column', gap: 6, padding: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 2fr) minmax(0, 1.1fr) 70px minmax(0, 1.2fr)', gap: 6 }}>
        <input
          list="contents-room-options"
          value={draft.room}
          onChange={e => setDraft({ ...draft, room: e.target.value })}
          placeholder="Room"
          maxLength={64}
          disabled={busy}
          style={inputStyle}
        />
        <input
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="Item"
          maxLength={80}
          disabled={busy}
          style={inputStyle}
        />
        <select
          value={draft.category}
          onChange={e => setDraft({ ...draft, category: e.target.value as ContentsCategory })}
          disabled={busy}
          style={inputStyle}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CONTENTS_CATEGORY_LABELS[c]}</option>)}
        </select>
        <input
          type="number"
          min={1} max={9999}
          value={draft.quantity}
          onChange={e => setDraft({ ...draft, quantity: Number(e.target.value) || 1 })}
          disabled={busy}
          style={inputStyle}
        />
        <select
          value={draft.disposition}
          onChange={e => setDraft({ ...draft, disposition: e.target.value as ContentsDisposition })}
          disabled={busy}
          style={inputStyle}
        >
          {DISPOSITIONS.map(d => <option key={d} value={d}>{CONTENTS_DISPOSITION_LABELS[d]}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr) auto auto', gap: 6 }}>
        <input
          value={draft.notes ?? ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Notes"
          maxLength={240}
          disabled={busy}
          style={inputStyle}
        />
        <input
          type="number" min={0} step="0.01"
          value={draft.replacement_value ?? ''}
          onChange={e => {
            const v = Number(e.target.value)
            setDraft({ ...draft, replacement_value: Number.isFinite(v) && v > 0 ? v : undefined })
          }}
          placeholder="Replacement $"
          disabled={busy}
          style={inputStyle}
        />
        <button type="button" onClick={onCancel} disabled={busy} style={ghostBtnStyle(busy)}>Cancel</button>
        <button type="button" onClick={onSave} disabled={busy} style={accentBtnStyle(busy)}>Save</button>
      </div>
      {/* keep the room datalist available here too (parent renders it) */}
      {areaNames.length === 0 && null}
    </div>
  )
}

function SuggestionRow({
  item, busy, onAccept, onDismiss,
}: { item: ContentsItem; busy: boolean; onAccept: () => void; onDismiss: () => void }) {
  const t = DISPOSITION_THEME[item.disposition]
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 12px', borderRadius: 10,
        background: 'var(--surface-2)', border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {item.room} · ×{item.quantity} · {CONTENTS_CATEGORY_LABELS[item.category]}
      </div>
      <span style={dispoPillStyle(t)}>{CONTENTS_DISPOSITION_LABELS[item.disposition].split(' ')[0]}</span>
      {item.notes && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>— {item.notes}</div>
      )}
      <button type="button" onClick={onAccept} disabled={busy} style={chipActionStyle('accent', busy)}>✓ Accept</button>
      <button type="button" onClick={onDismiss} disabled={busy} style={chipActionStyle('ghost', busy)}>Dismiss</button>
    </div>
  )
}

/* ───────────────────────────── Styles ────────────────────────────── */

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

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 8,
  flexWrap: 'wrap',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
}

const roomHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
  marginTop: 4,
}

const displayRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
}

const errorBoxStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#fecaca',
  border: '1px solid #7f1d1d',
  background: 'rgba(127,29,29,0.15)',
  padding: '8px 10px',
  borderRadius: 8,
  marginBottom: 14,
}

const aiBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(167, 139, 250, 0.18)',
  color: '#C4B5FD',
  border: '1px solid rgba(167, 139, 250, 0.45)',
}

function dispoPillStyle(t: { bg: string; border: string; color: string }): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: 999,
    background: t.bg,
    border: `1px solid ${t.border}`,
    color: t.color,
  }
}

function countChipStyle(d: ContentsDisposition, count: number): React.CSSProperties {
  const t = DISPOSITION_THEME[d]
  const active = count > 0
  return {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 999,
    background: active ? t.bg : 'transparent',
    border: `1px solid ${active ? t.border : 'var(--border)'}`,
    color: active ? t.color : 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  }
}

function linkBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    color: 'var(--text-muted)',
    background: 'none',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'underline',
    padding: '2px 4px',
  }
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 14px',
    borderRadius: 8,
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: '10px 18px',
    borderRadius: 9,
    background: 'var(--surface-2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    opacity: disabled ? 0.75 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function accentBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: '10px 18px',
    borderRadius: 9,
    background: 'var(--green)',
    color: '#fff',
    border: '1px solid rgba(34, 197, 94, 0.45)',
    opacity: disabled ? 0.75 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function chipActionStyle(tone: 'accent' | 'ghost', disabled: boolean): React.CSSProperties {
  if (tone === 'accent') {
    return {
      fontSize: 12,
      fontWeight: 600,
      padding: '6px 12px',
      borderRadius: 6,
      background: 'var(--accent)',
      color: '#fff',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }
  }
  return {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}
