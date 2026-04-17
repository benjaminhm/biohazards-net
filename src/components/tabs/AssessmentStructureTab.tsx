/*
 * Assessment → Structure. HITL assessment of structural elements per room:
 * drywall / subfloor / HVAC / framing / tile / carpet / plumbing / electrical
 * etc., with a condition grade and a recommended action.
 *
 * This is what scopes the restoration estimate and tells the crew which
 * surfaces need to be cleaned vs cut-out-and-replaced.
 *
 * Sections:
 *   1. Confirmed assessment — rows grouped by room, inline edit / remove.
 *   2. Add row — inline form (room, element, condition, action, notes).
 *   3. AI suggestions — suggested_structure_ai rows with Accept / Dismiss.
 *   4. Identify / Generate buttons.
 *
 * Persists to assessment_data.structure_items and suggested_structure_ai.
 */
'use client'

import { useMemo, useState } from 'react'
import type {
  AssessmentData,
  Job,
  StructureAction,
  StructureCondition,
  StructureElement,
  StructureItem,
} from '@/lib/types'
import {
  STRUCTURE_ACTION_LABELS,
  STRUCTURE_CONDITION_LABELS,
  STRUCTURE_ELEMENT_LABELS,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'

const ELEMENTS = Object.keys(STRUCTURE_ELEMENT_LABELS) as StructureElement[]
const CONDITIONS = Object.keys(STRUCTURE_CONDITION_LABELS) as StructureCondition[]
const ACTIONS = Object.keys(STRUCTURE_ACTION_LABELS) as StructureAction[]

const CONDITION_THEME: Record<StructureCondition, { bg: string; border: string; color: string }> = {
  intact:           { bg: 'rgba(52, 211, 153, 0.16)',  border: 'rgba(52, 211, 153, 0.4)',  color: '#6EE7B7' },
  affected:         { bg: 'rgba(251, 191, 36, 0.16)',  border: 'rgba(251, 191, 36, 0.4)',  color: '#FCD34D' },
  heavily_affected: { bg: 'rgba(251, 146, 60, 0.18)',  border: 'rgba(251, 146, 60, 0.45)', color: '#FDBA74' },
  compromised:      { bg: 'rgba(248, 113, 113, 0.18)', border: 'rgba(248, 113, 113, 0.45)',color: '#FCA5A5' },
}

const ACTION_THEME: Record<StructureAction, { bg: string; border: string; color: string }> = {
  monitor:   { bg: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.4)', color: '#CBD5E1' },
  clean:     { bg: 'rgba(96, 165, 250, 0.18)',  border: 'rgba(96, 165, 250, 0.45)', color: '#93C5FD' },
  remediate: { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.45)',color: '#C4B5FD' },
  replace:   { bg: 'rgba(251, 146, 60, 0.18)',  border: 'rgba(251, 146, 60, 0.45)', color: '#FDBA74' },
  demolish:  { bg: 'rgba(248, 113, 113, 0.18)', border: 'rgba(248, 113, 113, 0.45)',color: '#FCA5A5' },
}

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function newItemId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export default function AssessmentStructureTab({ job, onJobUpdate }: Props) {
  const ad = job.assessment_data
  const areaNames = useMemo(
    () => (ad?.areas ?? []).map(a => a.name).filter(Boolean),
    [ad?.areas],
  )

  const items = useMemo(() => ad?.structure_items ?? [], [ad?.structure_items])
  const suggestions = useMemo(
    () => ad?.suggested_structure_ai?.items ?? [],
    [ad?.suggested_structure_ai?.items],
  )

  const itemsByRoom = useMemo(() => {
    const m = new Map<string, StructureItem[]>()
    for (const i of items) {
      const arr = m.get(i.room) ?? []
      arr.push(i)
      m.set(i.room, arr)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  const countsByAction = useMemo(() => {
    const c: Record<StructureAction, number> = { monitor: 0, clean: 0, remediate: 0, replace: 0, demolish: 0 }
    for (const i of items) c[i.action] = (c[i.action] ?? 0) + 1
    return c
  }, [items])

  const [draftRoom, setDraftRoom] = useState('')
  const [draftElement, setDraftElement] = useState<StructureElement>('wall')
  const [draftCondition, setDraftCondition] = useState<StructureCondition>('affected')
  const [draftAction, setDraftAction] = useState<StructureAction>('remediate')
  const [draftNotes, setDraftNotes] = useState('')

  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<StructureItem | null>(null)

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

  function persistItems(nextItems: StructureItem[], what: string) {
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      structure_items: nextItems,
    }
    void patchAssessment(merged, what)
  }

  function acceptSuggestion(s: StructureItem) {
    if (items.some(i => i.room.toLowerCase() === s.room.toLowerCase() && i.element === s.element)) {
      // already have that (room, element) — just drop the suggestion
      dismissSuggestion(s.id)
      return
    }
    const next: StructureItem = {
      ...s,
      id: newItemId('str'),
      source: 'ai',
    }
    const nextSug = suggestions.filter(x => x.id !== s.id)
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      structure_items: [...items, next],
      suggested_structure_ai: ad?.suggested_structure_ai
        ? { items: nextSug, generated_at: ad.suggested_structure_ai.generated_at }
        : undefined,
    }
    void patchAssessment(merged, 'accepted suggestion')
  }

  function dismissSuggestion(id: string) {
    const nextSug = suggestions.filter(s => s.id !== id)
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_structure_ai: ad?.suggested_structure_ai
        ? { items: nextSug, generated_at: ad.suggested_structure_ai.generated_at }
        : undefined,
    }
    void patchAssessment(merged, 'dismissal')
  }

  function addManualItem() {
    const room = draftRoom.trim()
    if (!room) {
      setError('Room is required.')
      return
    }
    if (items.some(i => i.room.toLowerCase() === room.toLowerCase() && i.element === draftElement)) {
      setError(`"${STRUCTURE_ELEMENT_LABELS[draftElement]}" is already assessed for "${room}". Edit the existing row instead.`)
      return
    }
    const next: StructureItem = {
      id: newItemId('str'),
      room,
      element: draftElement,
      condition: draftCondition,
      action: draftAction,
      ...(draftNotes.trim() ? { notes: draftNotes.trim().slice(0, 240) } : {}),
      source: 'manual',
    }
    setDraftNotes('')
    persistItems([...items, next], 'structure row')
  }

  function removeItem(id: string) {
    persistItems(items.filter(i => i.id !== id), 'remove')
  }

  function beginEdit(item: StructureItem) {
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
    if (!room) {
      setError('Room is required.')
      return
    }
    const next: StructureItem = {
      ...draft,
      room,
      notes: draft.notes?.trim() ? draft.notes.trim().slice(0, 240) : undefined,
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
      const res = await fetch(`/api/jobs/${job.id}/suggest-structure`, {
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
      {error && <div style={errorBoxStyle}>{error}</div>}

      {/* ── Confirmed assessment ────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={sectionHeaderStyle}>
          <span>Confirmed assessment</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {items.length === 0 ? 'Nothing assessed yet' : `${items.length} row${items.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="card" style={{ padding: 16, display: 'grid', gap: 14 }}>
          {items.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ACTIONS.map(a => (
                <span key={a} style={countChipStyle(a, countsByAction[a])}>
                  <strong style={{ fontWeight: 700 }}>{countsByAction[a]}</strong> {STRUCTURE_ACTION_LABELS[a]}
                </span>
              ))}
            </div>
          )}
          {itemsByRoom.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No structural assessment yet. Add rows manually below, or press Identify to extract
              element-level findings the AI finds in progress notes and photo captions.
            </div>
          ) : (
            itemsByRoom.map(([room, rows]) => (
              <div key={room}>
                <div style={roomHeadingStyle}>
                  {room} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {rows.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {rows.map(item => (
                    editingId === item.id && editDraft ? (
                      <EditRow
                        key={item.id}
                        draft={editDraft}
                        setDraft={setEditDraft}
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

      {/* ── Add row ──────────────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={sectionHeaderStyle}>
          <span>Add assessment</span>
        </div>
        <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
          <datalist id="structure-room-options">
            {areaNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 1fr)',
              gap: 8,
            }}
          >
            <input
              value={draftRoom}
              onChange={e => setDraftRoom(e.target.value)}
              placeholder="Room"
              maxLength={64}
              list="structure-room-options"
              disabled={busy}
              style={inputStyle}
            />
            <select
              value={draftElement}
              onChange={e => setDraftElement(e.target.value as StructureElement)}
              disabled={busy}
              style={inputStyle}
            >
              {ELEMENTS.map(el => <option key={el} value={el}>{STRUCTURE_ELEMENT_LABELS[el]}</option>)}
            </select>
            <select
              value={draftCondition}
              onChange={e => setDraftCondition(e.target.value as StructureCondition)}
              disabled={busy}
              style={inputStyle}
            >
              {CONDITIONS.map(c => <option key={c} value={c}>{STRUCTURE_CONDITION_LABELS[c]}</option>)}
            </select>
            <select
              value={draftAction}
              onChange={e => setDraftAction(e.target.value as StructureAction)}
              disabled={busy}
              style={inputStyle}
            >
              {ACTIONS.map(a => <option key={a} value={a}>{STRUCTURE_ACTION_LABELS[a]}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
            <input
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              placeholder="Notes (optional, e.g. extent / evidence)"
              maxLength={240}
              disabled={busy}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={addManualItem}
              disabled={busy || !draftRoom.trim()}
              style={primaryBtnStyle(busy || !draftRoom.trim())}
            >
              Add row
            </button>
          </div>
        </div>
      </section>

      {/* ── AI suggestions ──────────────────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <div style={sectionHeaderStyle}>
          <span>AI suggestions</span>
          {suggestions.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{suggestions.length} pending</span>
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
              None yet. Press Identify to extract element-level findings the AI sees in progress notes
              and captions, or Generate for a broader proposal given the approved hazards.
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
            <button type="button" disabled={busy} onClick={() => void runAi('identify')} style={ghostBtnStyle(busy)}>
              {identifyLoading ? 'Identifying…' : 'Identify'}
            </button>
            <button type="button" disabled={busy} onClick={() => void runAi('generate')} style={accentBtnStyle(busy)}>
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
}: { item: StructureItem; busy: boolean; onEdit: () => void; onRemove: () => void }) {
  const cT = CONDITION_THEME[item.condition]
  const aT = ACTION_THEME[item.action]
  return (
    <div style={displayRowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {STRUCTURE_ELEMENT_LABELS[item.element]}
        </span>
        <span style={pillStyle(cT)}>{STRUCTURE_CONDITION_LABELS[item.condition]}</span>
        <span style={pillStyle(aT)}>{STRUCTURE_ACTION_LABELS[item.action]}</span>
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
  draft, setDraft, busy, onCancel, onSave,
}: {
  draft: StructureItem
  setDraft: (i: StructureItem) => void
  busy: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div style={{ ...displayRowStyle, alignItems: 'stretch', flexDirection: 'column', gap: 6, padding: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 1fr)', gap: 6 }}>
        <input
          list="structure-room-options"
          value={draft.room}
          onChange={e => setDraft({ ...draft, room: e.target.value })}
          placeholder="Room"
          maxLength={64}
          disabled={busy}
          style={inputStyle}
        />
        <select
          value={draft.element}
          onChange={e => setDraft({ ...draft, element: e.target.value as StructureElement })}
          disabled={busy}
          style={inputStyle}
        >
          {ELEMENTS.map(el => <option key={el} value={el}>{STRUCTURE_ELEMENT_LABELS[el]}</option>)}
        </select>
        <select
          value={draft.condition}
          onChange={e => setDraft({ ...draft, condition: e.target.value as StructureCondition })}
          disabled={busy}
          style={inputStyle}
        >
          {CONDITIONS.map(c => <option key={c} value={c}>{STRUCTURE_CONDITION_LABELS[c]}</option>)}
        </select>
        <select
          value={draft.action}
          onChange={e => setDraft({ ...draft, action: e.target.value as StructureAction })}
          disabled={busy}
          style={inputStyle}
        >
          {ACTIONS.map(a => <option key={a} value={a}>{STRUCTURE_ACTION_LABELS[a]}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 6 }}>
        <input
          value={draft.notes ?? ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Notes"
          maxLength={240}
          disabled={busy}
          style={inputStyle}
        />
        <button type="button" onClick={onCancel} disabled={busy} style={ghostBtnStyle(busy)}>Cancel</button>
        <button type="button" onClick={onSave} disabled={busy} style={accentBtnStyle(busy)}>Save</button>
      </div>
    </div>
  )
}

function SuggestionRow({
  item, busy, onAccept, onDismiss,
}: { item: StructureItem; busy: boolean; onAccept: () => void; onDismiss: () => void }) {
  const cT = CONDITION_THEME[item.condition]
  const aT = ACTION_THEME[item.action]
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 12px', borderRadius: 10,
        background: 'var(--surface-2)', border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{STRUCTURE_ELEMENT_LABELS[item.element]}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.room}</div>
      <span style={pillStyle(cT)}>{STRUCTURE_CONDITION_LABELS[item.condition]}</span>
      <span style={pillStyle(aT)}>{STRUCTURE_ACTION_LABELS[item.action]}</span>
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

function pillStyle(t: { bg: string; border: string; color: string }): React.CSSProperties {
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

function countChipStyle(a: StructureAction, count: number): React.CSSProperties {
  const t = ACTION_THEME[a]
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
