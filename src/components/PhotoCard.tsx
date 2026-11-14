/*
 * components/PhotoCard.tsx
 *
 * One photo in the job's folder: preview, note, delete, and when / where / who.
 * Photos carry no stage tags; each document chooses its own photos.
 */
'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { Photo } from '@/lib/types'
import PhotoMeta from '@/components/PhotoMeta'

function hasPersistedPhotoId(id: string | undefined): id is string {
  return typeof id === 'string' && id.length > 0 && id !== 'undefined'
}

export interface PhotoCardProps {
  photo: Photo
  /** Shown as a badge when some document on the job uses this photo. */
  used?: boolean
  onDelete: (id: string) => void
  onUpdate: (photo: Photo) => void
}

export default function PhotoCard({ photo, used = false, onDelete, onUpdate }: PhotoCardProps) {
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [captionDraft, setCaptionDraft] = useState(photo.caption)

  async function handleDelete() {
    if (!hasPersistedPhotoId(photo.id)) {
      window.alert('This photo has no id yet. Refresh the page or re-upload.')
      return
    }
    if (!confirm(used ? 'This photo is used in a document. Delete it anyway?' : 'Delete this photo?')) return
    setDeleting(true)
    const res = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' })
    if (res.ok) onDelete(photo.id)
    else {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      window.alert(data.error ?? `Could not delete (${res.status})`)
    }
    setDeleting(false)
  }

  async function saveCaption() {
    if (!hasPersistedPhotoId(photo.id)) {
      window.alert('This photo has no id yet. Refresh the page or finish uploading.')
      return
    }
    const res = await fetch(`/api/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: captionDraft }),
    })
    const data = (await res.json()) as { photo?: Photo; error?: string }
    if (!res.ok || !data.photo) {
      window.alert(data.error ?? 'Could not save photo')
      return
    }
    onUpdate(data.photo)
    setEditing(false)
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
        <Image src={photo.file_url} alt={photo.caption || 'Job photo'} fill style={{ objectFit: 'cover' }} unoptimized />
        {used && (
          <span
            style={{
              position: 'absolute', left: 6, top: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: 'rgba(0,0,0,0.65)', color: '#fff',
            }}
          >
            In a document
          </span>
        )}
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
        {editing ? (
          <div>
            <textarea
              value={captionDraft}
              onChange={e => setCaptionDraft(e.target.value)}
              rows={3}
              placeholder="Note — what does this photo show?"
              style={{ width: '100%', fontSize: 12, resize: 'vertical', marginBottom: 6 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 10px' }} type="button" onClick={saveCaption}>
                Save
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '5px 10px' }}
                type="button"
                onClick={() => { setEditing(false); setCaptionDraft(photo.caption) }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ flex: 1 }}>
              {photo.caption ? (
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{photo.caption}</div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No note — tap ✏️ to add one</div>
              )}
            </div>
            <button
              onClick={() => { setCaptionDraft(photo.caption); setEditing(true) }}
              title="Edit note"
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
        )}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <PhotoMeta photo={photo} />
        </div>
      </div>
    </div>
  )
}
