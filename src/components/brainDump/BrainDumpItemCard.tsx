/*
 * components/brainDump/BrainDumpItemCard.tsx
 *
 * Single item row in the living list. HITL controls:
 *   - edit text inline (click to edit, Enter to save, Esc to cancel)
 *   - change kind (todo/reminder/note/moment) via small pill dropdown
 *   - toggle done (todos/reminders)
 *   - delete (soft)
 *
 * Kept flexible: all mutations flow through onPatch / onDelete callbacks
 * from the parent page, so behaviour can be changed without touching this
 * component.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import type { BrainDumpItem, BrainDumpKind } from './types'

const KIND_META: Record<BrainDumpKind, { label: string; color: string; icon: string }> = {
  todo:     { label: 'Todo',     color: '#FF6B35', icon: '✓' },
  reminder: { label: 'Reminder', color: '#A855F7', icon: '◷' },
  note:     { label: 'Note',     color: '#3B82F6', icon: '✎' },
  moment:   { label: 'Moment',   color: '#10B981', icon: '◉' },
}

const KINDS: BrainDumpKind[] = ['todo', 'reminder', 'note', 'moment']

interface Props {
  item: BrainDumpItem
  onPatch: (id: string, patch: Partial<BrainDumpItem>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function BrainDumpItemCard({ item, onPatch, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const [kindOpen, setKindOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(draft.length, draft.length)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  useEffect(() => {
    setDraft(item.text)
  }, [item.text])

  const meta = KIND_META[item.kind]
  const isDone = item.status === 'done'

  async function saveText() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === item.text) {
      setEditing(false)
      setDraft(item.text)
      return
    }
    setBusy(true)
    try {
      await onPatch(item.id, { text: trimmed })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function changeKind(next: BrainDumpKind) {
    setKindOpen(false)
    if (next === item.kind) return
    setBusy(true)
    try {
      await onPatch(item.id, { kind: next })
    } finally {
      setBusy(false)
    }
  }

  async function toggleDone() {
    setBusy(true)
    try {
      await onPatch(item.id, { status: isDone ? 'open' : 'done' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this item?')) return
    setBusy(true)
    try {
      await onDelete(item.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        opacity: isDone ? 0.55 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {/* Done checkbox (todos/reminders) */}
      {(item.kind === 'todo' || item.kind === 'reminder') ? (
        <button
          type="button"
          onClick={() => void toggleDone()}
          disabled={busy}
          aria-label={isDone ? 'Mark as open' : 'Mark as done'}
          style={{
            marginTop: 2,
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `1.5px solid ${isDone ? meta.color : 'var(--border-2)'}`,
            background: isDone ? meta.color : 'transparent',
            color: '#fff',
            fontSize: 11,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: busy ? 'default' : 'pointer',
            flexShrink: 0,
          }}
        >
          {isDone ? '✓' : ''}
        </button>
      ) : (
        <span
          aria-hidden
          style={{
            marginTop: 3,
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: meta.color,
            fontSize: 13,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {meta.icon}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 4000))}
            onBlur={() => void saveText()}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void saveText()
              } else if (e.key === 'Escape') {
                setDraft(item.text)
                setEditing(false)
              }
            }}
            rows={Math.max(1, Math.min(6, draft.split('\n').length))}
            style={{
              width: '100%',
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-2)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.5,
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <div
            onClick={() => !busy && setEditing(true)}
            style={{
              fontSize: 14,
              color: 'var(--text)',
              lineHeight: 1.5,
              cursor: 'text',
              textDecoration: isDone ? 'line-through' : 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            title="Click to edit"
          >
            {item.text}
          </div>
        )}

        <div
          style={{
            marginTop: 6,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          {/* Kind pill with dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setKindOpen(o => !o)}
              style={{
                padding: '2px 8px',
                borderRadius: 99,
                border: `1px solid ${meta.color}40`,
                background: `${meta.color}14`,
                color: meta.color,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.02em',
                cursor: 'pointer',
              }}
            >
              {meta.label} ▾
            </button>
            {kindOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 4,
                  zIndex: 10,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                  minWidth: 120,
                }}
              >
                {KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => void changeKind(k)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: k === item.kind ? 'var(--surface-3)' : 'transparent',
                      color: KIND_META[k].color,
                      fontSize: 12,
                      fontWeight: 600,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {KIND_META[k].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {item.priority > 0 && (
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 99,
                background: item.priority === 2 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                color: item.priority === 2 ? '#EF4444' : '#F59E0B',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontSize: 10,
              }}
            >
              {item.priority === 2 ? 'Urgent' : 'Priority'}
            </span>
          )}

          {item.due_at && (
            <span style={{ color: 'var(--text-muted)' }}>
              ◷ {formatDue(item.due_at)}
            </span>
          )}

          {item.tags.length > 0 && (
            <span style={{ color: 'var(--text-dim)' }}>
              {item.tags.map(t => `#${t}`).join(' ')}
            </span>
          )}

          <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
            {item.created_by_first_name || 'Someone'} · {formatAge(item.created_at)}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={busy}
        aria-label="Delete item"
        title="Delete"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          fontSize: 18,
          lineHeight: 1,
          cursor: busy ? 'default' : 'pointer',
          padding: '2px 4px',
          borderRadius: 6,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
      >
        ×
      </button>
    </div>
  )
}

function formatDue(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const hhmm = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${hhmm}`
}

function formatAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
