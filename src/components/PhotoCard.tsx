/*
 * components/PhotoCard.tsx
 *
 * Single uploaded photo: preview, category/area/caption edit, delete.
 * Used on Photos tab and per-area blocks on Assessment.
 */
'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { Photo, PhotoCategory } from '@/lib/types'

const CATEGORIES: { value: PhotoCategory; label: string; color: string }[] = [
  { value: 'before', label: 'Before', color: '#F87171' },
  { value: 'assessment', label: 'Assessment', color: '#60A5FA' },
  { value: 'during', label: 'During', color: '#FBBF24' },
  { value: 'after', label: 'After', color: '#4ADE80' },
]

const CATEGORY_COLORS: Record<PhotoCategory, string> = {
  before: '#F87171',
  during: '#FBBF24',
  after: '#4ADE80',
  assessment: '#60A5FA',
}

export interface PhotoCardProps {
  photo: Photo
  areaNames?: string[]
  /** When false, hides the area chip in summary (e.g. inside a room-specific block). Default true. */
  showAreaChip?: boolean
  onDelete: (id: string) => void
  onUpdate: (photo: Photo) => void
}

export default function PhotoCard({
  photo,
  areaNames = [],
  showAreaChip = true,
  onDelete,
  onUpdate,
}: PhotoCardProps) {
  const [deleting, setDeleting] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)
  const [captionDraft, setCaptionDraft] = useState(photo.caption)
  const [categoryDraft, setCategoryDraft] = useState<PhotoCategory>(photo.category)
  const [areaRefDraft, setAreaRefDraft] = useState(photo.area_ref || '')

  async function handleDelete() {
    if (!confirm('Delete this photo?')) return
    setDeleting(true)
    await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' })
    onDelete(photo.id)
  }

  function openEdit() {
    setCaptionDraft(photo.caption)
    setCategoryDraft(photo.category)
    setAreaRefDraft(photo.area_ref || '')
    setEditingDetails(true)
  }

  function cancelEdit() {
    setEditingDetails(false)
    setCaptionDraft(photo.caption)
    setCategoryDraft(photo.category)
    setAreaRefDraft(photo.area_ref || '')
  }

  async function saveDetails() {
    const res = await fetch(`/api/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: captionDraft, category: categoryDraft, area_ref: areaRefDraft }),
    })
    const data = (await res.json()) as { photo?: Photo; error?: string }
    if (!res.ok || !data.photo) {
      window.alert(data.error ?? 'Could not save photo')
      return
    }
    onUpdate(data.photo)
    setEditingDetails(false)
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        opacity: deleting ? 0.4 : 1,
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--surface-2)' }}>
        <Image src={photo.file_url} alt={photo.caption || photo.category} fill style={{ objectFit: 'cover' }} unoptimized />
        <button
          onClick={handleDelete}
          title="Delete photo"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            borderRadius: 5,
            padding: '4px 7px',
            fontSize: 13,
            cursor: 'pointer',
            color: '#fff',
          }}
        >
          🗑️
        </button>
      </div>
      <div style={{ padding: '10px 12px' }}>
        {editingDetails ? (
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: 6,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Category
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategoryDraft(c.value)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: `1px solid ${categoryDraft === c.value ? c.color : 'var(--border)'}`,
                    background: categoryDraft === c.value ? `${c.color}22` : 'transparent',
                    color: categoryDraft === c.value ? c.color : 'var(--text-muted)',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {areaNames.length > 0 ? (
              <select
                value={areaRefDraft}
                onChange={e => setAreaRefDraft(e.target.value)}
                style={{ width: '100%', fontSize: 12, marginBottom: 8, padding: '6px 8px' }}
              >
                <option value="">Area (optional)</option>
                {areaNames.map(a => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={areaRefDraft}
                onChange={e => setAreaRefDraft(e.target.value)}
                placeholder="Area / room (optional)"
                style={{ width: '100%', fontSize: 12, marginBottom: 8 }}
              />
            )}
            <textarea
              value={captionDraft}
              onChange={e => setCaptionDraft(e.target.value)}
              rows={3}
              placeholder="Note — what does this photo show?"
              style={{ width: '100%', fontSize: 12, resize: 'vertical', marginBottom: 6 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 10px' }} type="button" onClick={saveDetails}>
                Save
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }} type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: CATEGORY_COLORS[photo.category],
                }}
              >
                {photo.category}
              </span>
              {showAreaChip && photo.area_ref && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    background: 'var(--surface-2)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  {photo.area_ref}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ flex: 1 }}>
                {photo.caption ? (
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{photo.caption}</div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No note — tap ✏️ to edit</div>
                )}
              </div>
              <button
                onClick={openEdit}
                title="Edit category & note"
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  padding: '3px 7px',
                  fontSize: 12,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✏️
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
