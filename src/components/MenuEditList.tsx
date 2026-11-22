'use client'

/*
 * components/MenuEditList.tsx
 *
 * Editable, reorderable list rows used by Edit mode in both:
 *   - Job Manager FileMenu (app/jobs/queue)
 *   - Job page HomeWorkflowDrawer (app/jobs/[id])
 *
 * Supports:
 *   - Inline label editing (click/tap input to rename)
 *   - Touch-friendly ↑ / ↓ buttons for iPad/tablet & desktop reordering
 *   - Desktop drag-and-drop via the ⋮⋮ handle
 *   - Hide / Restore toggle (staged in draft state until Save is clicked)
 */
import React, { useRef, useState } from 'react'

export interface EditableMenuItem {
  id: string
  /** Current draft label (shown in input). */
  label: string
  /** Default label shown as placeholder if cleared. */
  defaultLabel: string
}

export function MenuEditList({
  items,
  numbered = false,
  compact = false,
  onMove,
  onRename,
  onHide,
}: {
  items: EditableMenuItem[]
  numbered?: boolean
  compact?: boolean
  onMove: (fromIndex: number, toIndex: number) => void
  onRename: (id: string, nextLabel: string) => void
  onHide: (id: string) => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const handleArmedRef = useRef(false)

  const iconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: compact ? 26 : 36,
    minHeight: compact ? 30 : 38,
    padding: 0,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: compact ? 12 : 14,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6 }}>
      {items.map((item, idx) => {
        const isDragging = dragIndex === idx
        const isOver = overIndex === idx && dragIndex !== null && dragIndex !== idx
        return (
          <div
            key={item.id}
            draggable
            onDragStart={e => {
              const target = e.target as HTMLElement | null
              if (!handleArmedRef.current && target?.closest('input, button')) {
                e.preventDefault()
                return
              }
              setDragIndex(idx)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', item.id)
            }}
            onDragOver={e => {
              if (dragIndex === null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (overIndex !== idx) setOverIndex(idx)
            }}
            onDrop={e => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== idx) {
                onMove(dragIndex, idx)
              }
              setDragIndex(null)
              setOverIndex(null)
              handleArmedRef.current = false
            }}
            onDragEnd={() => {
              setDragIndex(null)
              setOverIndex(null)
              handleArmedRef.current = false
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: compact ? 5 : 8,
              padding: compact ? '4px 6px' : '6px 8px',
              borderRadius: 8,
              border: isOver
                ? '1.5px dashed var(--accent)'
                : '1px solid var(--border)',
              background: isOver
                ? 'var(--accent-dim)'
                : 'var(--surface)',
              opacity: isDragging ? 0.5 : 1,
              transition: 'border-color 0.12s, background 0.12s',
            }}
          >
            {/* Drag handle */}
            <span
              aria-hidden
              title="Drag to reorder"
              onPointerDown={() => { handleArmedRef.current = true }}
              onPointerUp={() => { handleArmedRef.current = false }}
              style={{
                cursor: 'grab',
                color: 'var(--text-muted)',
                fontSize: compact ? 13 : 15,
                lineHeight: 1,
                padding: compact ? '4px 1px' : '6px 3px',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              ⋮⋮
            </span>

            {numbered && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: compact ? 20 : 24,
                  height: compact ? 20 : 24,
                  borderRadius: '50%',
                  fontSize: 11,
                  fontWeight: 700,
                  background: 'var(--bg)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                }}
              >
                {idx + 1}
              </span>
            )}

            <input
              type="text"
              value={item.label}
              placeholder={item.defaultLabel}
              maxLength={60}
              aria-label={`Rename ${item.defaultLabel}`}
              onChange={e => onRename(item.id, e.target.value)}
              onDragStart={e => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                width: '100%',
                minHeight: compact ? 30 : 38,
                padding: compact ? '4px 7px' : '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: compact ? 13 : 16,
                fontWeight: 600,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />

            <button
              type="button"
              aria-label={`Move ${item.label || item.defaultLabel} up`}
              title="Move up"
              disabled={idx === 0}
              onClick={() => onMove(idx, idx - 1)}
              style={{
                ...iconBtn,
                opacity: idx === 0 ? 0.35 : 1,
                cursor: idx === 0 ? 'default' : 'pointer',
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${item.label || item.defaultLabel} down`}
              title="Move down"
              disabled={idx === items.length - 1}
              onClick={() => onMove(idx, idx + 1)}
              style={{
                ...iconBtn,
                opacity: idx === items.length - 1 ? 0.35 : 1,
                cursor: idx === items.length - 1 ? 'default' : 'pointer',
              }}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Hide ${item.label || item.defaultLabel}`}
              title="Hide item"
              onClick={() => onHide(item.id)}
              style={{
                ...iconBtn,
                color: 'var(--text-muted)',
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
    return list
  }
  const next = [...list]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
