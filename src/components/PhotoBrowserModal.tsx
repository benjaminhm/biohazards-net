'use client'

/*
 * components/PhotoBrowserModal.tsx
 *
 * Pop-up browser over every photo on a job, for filling a document section
 * (e.g. the completion report's Before remediation). Filter by tag, tick
 * photos (shift-click for a range), upload more (saved Untagged), then add the
 * ticked photos in the order they were taken. Adding never changes a photo's
 * tag; the section keeps its own list.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import type { Photo, PhotoCategory } from '@/lib/types'
import { sortPhotosByTimeTaken } from '@/lib/postRemediationEvaluations'
import { uploadJobPhotos } from '@/components/tabs/PostRemediationEvaluationTab'

const TAGS: { id: PhotoCategory; label: string; color: string }[] = [
  { id: 'untagged', label: 'Untagged', color: '#9CA3AF' },
  { id: 'before', label: 'Before', color: '#F87171' },
  { id: 'assessment', label: 'Assessment', color: '#60A5FA' },
  { id: 'during', label: 'During', color: '#FBBF24' },
  { id: 'after', label: 'After', color: '#4ADE80' },
]
const TAG_BY_ID = Object.fromEntries(TAGS.map(t => [t.id, t])) as Record<PhotoCategory, (typeof TAGS)[number]>

function photoTime(p: Photo): string {
  return p.taken_at || p.uploaded_at || ''
}

function dayLabel(iso: string): string {
  if (!iso) return 'Date unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date unknown'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Brisbane' })
}

function timeLabel(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' })
}

export default function PhotoBrowserModal({
  jobId,
  title,
  photos,
  alreadyIds,
  onAdd,
  onClose,
  onPhotosUpdate,
}: {
  jobId: string
  /** Section name, e.g. "Before remediation". */
  title: string
  photos: Photo[]
  /** Photos already in the section; shown as added and not selectable. */
  alreadyIds: Set<string>
  onAdd: (ids: string[]) => void
  onClose: () => void
  onPhotosUpdate: (photos: Photo[]) => void
}) {
  const [filter, setFilter] = useState<PhotoCategory | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const images = useMemo(
    () => sortPhotosByTimeTaken(photos.filter(p => p.file_url && !/\.pdf($|\?)/i.test(p.file_url))),
    [photos],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: images.length }
    for (const p of images) c[p.category] = (c[p.category] ?? 0) + 1
    return c
  }, [images])
  const visible = useMemo(() => (filter === 'all' ? images : images.filter(p => p.category === filter)), [images, filter])
  const days = useMemo(() => {
    const out: { label: string; photos: Photo[] }[] = []
    for (const p of visible) {
      const label = dayLabel(photoTime(p))
      const last = out[out.length - 1]
      if (last && last.label === label) last.photos.push(p)
      else out.push({ label, photos: [p] })
    }
    return out
  }, [visible])

  function toggle(photo: Photo, e: MouseEvent) {
    if (alreadyIds.has(photo.id)) return
    const next = new Set(selected)
    if (e.shiftKey && anchorId) {
      const from = visible.findIndex(p => p.id === anchorId)
      const to = visible.findIndex(p => p.id === photo.id)
      if (from >= 0 && to >= 0) {
        const on = !selected.has(photo.id)
        for (const p of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (alreadyIds.has(p.id)) continue
          if (on) next.add(p.id)
          else next.delete(p.id)
        }
        setSelected(next)
        setAnchorId(photo.id)
        return
      }
    }
    if (next.has(photo.id)) next.delete(photo.id)
    else next.add(photo.id)
    setSelected(next)
    setAnchorId(photo.id)
  }

  const selectableVisible = visible.filter(p => !alreadyIds.has(p.id))
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(p => selected.has(p.id))

  function toggleAllVisible() {
    const next = new Set(selected)
    for (const p of selectableVisible) {
      if (allVisibleSelected) next.delete(p.id)
      else next.add(p.id)
    }
    setSelected(next)
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!files.length || uploading) return
    setUploading(true)
    setError('')
    const { added, error: uploadError } = await uploadJobPhotos(jobId, files, { category: 'untagged', capture_phase: 'assessment' })
    if (added.length) {
      onPhotosUpdate([...photos, ...added])
      setSelected(prev => new Set([...prev, ...added.map(p => p.id)]))
      if (filter !== 'all' && filter !== 'untagged') setFilter('all')
    }
    if (uploadError) setError(uploadError)
    setUploading(false)
  }

  function add() {
    onAdd(images.filter(p => selected.has(p.id)).map(p => p.id))
  }

  const chip = (id: PhotoCategory | 'all', label: string, color?: string) => {
    const on = filter === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        aria-pressed={on}
        style={{
          padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          border: `1px solid ${on ? color ?? 'var(--accent)' : 'var(--border)'}`,
          background: on ? `${color ?? '#FF6B35'}22` : 'transparent',
          color: on ? color ?? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        {label} ({counts[id] ?? 0})
      </button>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add photos to ${title}`}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{
        width: '100%', maxWidth: 1100, height: '100%', maxHeight: 820, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Add photos to</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => void onUpload(e)} style={{ display: 'none' }} />
            <button type="button" className="btn btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()} style={{ fontSize: 13 }}>
              {uploading ? 'Uploading…' : 'Upload more'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ fontSize: 18, padding: '4px 10px' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {chip('all', 'All')}
            {TAGS.map(t => chip(t.id, t.label, t.color))}
            {selectableVisible.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={toggleAllVisible} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }}>
                {allVisibleSelected ? 'Clear these' : `Select all ${selectableVisible.length}`}
              </button>
            )}
          </div>
          {error && <div role="alert" style={{ color: '#F87171', fontSize: 13 }}>{error}</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {days.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              {images.length === 0 ? 'No photos on this job yet. Use Upload more.' : 'No photos with this tag.'}
            </div>
          )}
          {days.map(day => (
            <div key={day.label} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
                {day.label} · {day.photos.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {day.photos.map(p => {
                  const added = alreadyIds.has(p.id)
                  const on = selected.has(p.id)
                  const tag = TAG_BY_ID[p.category] ?? TAG_BY_ID.untagged
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={e => toggle(p, e)}
                      disabled={added}
                      aria-pressed={on}
                      title={added ? 'Already in this section' : p.caption || p.area_ref || 'Select photo'}
                      style={{
                        position: 'relative', padding: 0, borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3',
                        border: `3px solid ${on ? '#FF6B35' : 'transparent'}`, background: 'var(--surface-2)',
                        cursor: added ? 'default' : 'pointer', opacity: added ? 0.45 : 1,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.file_url} alt={p.caption || 'Job photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <span style={{ position: 'absolute', left: 6, bottom: 6, padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 800, background: 'rgba(0,0,0,0.72)', color: tag.color }}>
                        {tag.label}
                      </span>
                      {timeLabel(photoTime(p)) && (
                        <span style={{ position: 'absolute', right: 6, bottom: 6, padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                          {timeLabel(photoTime(p))}
                        </span>
                      )}
                      <span style={{
                        position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900,
                        background: on ? '#FF6B35' : 'rgba(0,0,0,0.5)', color: '#fff', border: on ? 'none' : '2px solid rgba(255,255,255,0.8)',
                      }}>
                        {added ? '✓' : on ? '✓' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-muted)' }}>
            {selected.size ? `${selected.size} selected` : 'Tick photos to add. Shift-click to select a range.'}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!selected.size} onClick={add} style={{ fontWeight: 800 }}>
            {selected.size ? `Add ${selected.size} to ${title}` : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
