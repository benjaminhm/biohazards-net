/*
 * Sort disposal photos into loads. Used by the bulk loader (after an upload)
 * and by the Contents Disposal Record.
 *
 * Photos are shown in the order they were taken, already grouped the way the
 * times and GPS suggest. Staff fix what is wrong and confirm; nothing is saved
 * until they do. Each photo is also read once (what it shows, and a docket's
 * weight and fee) so dockets sort themselves and the record can prefill.
 */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CdrRole } from '@/lib/types'
import {
  CDR_ROLES,
  compactLoadNumbers,
  formatEventWhen,
  localStamp,
  suggestCdrTags,
  type CdrPhoto,
  type CdrTag,
  type SiteContext,
} from '@/lib/disposalTimeline'

export interface CdrTagRow { id: string; load: number | null; role: CdrRole | null }

interface Props {
  photos: CdrPhoto[]
  site: SiteContext | null
  saveTags: (rows: CdrTagRow[]) => Promise<{ photos?: CdrPhoto[]; error?: string }>
  readPhoto: (id: string) => Promise<{ photo?: CdrPhoto; error?: string }>
  /** Photos changed on the server (tags saved, or an image read). */
  onPhotos: (updated: CdrPhoto[]) => void
  onSaved?: () => void
}

const READ_CONCURRENCY = 3
const ROLE_COLOR: Record<CdrRole, string> = { load: '#60A5FA', dropoff: '#FBBF24', docket: '#4ADE80' }

const HEADING: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }
const PILL: CSSProperties = {
  padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
}

function savedTag(p: CdrPhoto): CdrTag {
  return { load: p.cdr_load ?? null, role: p.cdr_role ?? null }
}

function sameTag(a: CdrTag, b: CdrTag): boolean {
  return a.load === b.load && (a.load == null || a.role === b.role)
}

function timeOf(p: CdrPhoto): number {
  const t = p.taken_at ? Date.parse(p.taken_at) : NaN
  return Number.isFinite(t) ? t : Infinity
}

export default function CdrPhotoTagger({ photos, site, saveTags, readPhoto, onPhotos, onSaved }: Props) {
  const [edits, setEdits] = useState<Record<string, CdrTag>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showOthers, setShowOthers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<CdrPhoto | null>(null)
  const [reading, setReading] = useState<{ done: number; total: number; failed: number } | null>(null)

  const sorted = useMemo(() => [...photos].filter(p => p.file_url).sort((a, b) => timeOf(a) - timeOf(b)), [photos])
  const suggestions = useMemo(() => suggestCdrTags(sorted.filter(p => p.cdr_load != null), site), [sorted, site])

  const tagOf = (p: CdrPhoto): CdrTag => {
    const edit = edits[p.id]
    if (edit) return edit
    const saved = savedTag(p)
    if (saved.load === 0) return suggestions.get(p.id) ?? saved
    return saved
  }
  const isSuggestion = (p: CdrPhoto) => !edits[p.id] && p.cdr_load === 0 && suggestions.has(p.id)

  // Read each disposal photo once. Results arrive as they finish and sharpen the suggestions.
  const attempted = useRef(new Set<string>())
  const readRef = useRef(readPhoto)
  readRef.current = readPhoto
  const onPhotosRef = useRef(onPhotos)
  onPhotosRef.current = onPhotos
  const unread = useMemo(() => sorted.filter(p => p.cdr_load != null && !p.cdr_read).map(p => p.id).join(','), [sorted])
  const queue = useRef<string[]>([])
  const run = useRef({ active: 0, done: 0, total: 0, failed: 0, streak: 0, alive: true })
  useEffect(() => {
    const state = run.current
    state.alive = true
    return () => { state.alive = false }
  }, [])
  const pump = useCallback(() => {
    const state = run.current
    while (state.active < READ_CONCURRENCY && queue.current.length) {
      const id = queue.current.shift() as string
      state.active += 1
      void readRef.current(id)
        .catch(() => ({ error: 'failed' } as { photo?: CdrPhoto; error?: string }))
        .then(result => {
          state.active -= 1
          if (!state.alive) return
          state.done += 1
          if (result.photo) {
            state.streak = 0
            onPhotosRef.current([result.photo])
          } else {
            state.failed += 1
            state.streak += 1
          }
          // Three failures in a row means reading is down. The rest are left for staff to sort.
          if (state.streak >= 3 && queue.current.length) {
            state.failed += queue.current.length
            state.done += queue.current.length
            queue.current = []
          }
          const finished = state.done >= state.total
          setReading(finished && !state.failed ? null : { done: state.done, total: state.total, failed: state.failed })
          pump()
        })
    }
  }, [])
  useEffect(() => {
    const fresh = unread.split(',').filter(id => id && !attempted.current.has(id))
    if (!fresh.length) return
    for (const id of fresh) attempted.current.add(id)
    queue.current.push(...fresh)
    run.current.total += fresh.length
    setReading({ done: run.current.done, total: run.current.total, failed: run.current.failed })
    pump()
  }, [unread, pump])

  const loadNumbers = useMemo(() => {
    const set = new Set<number>()
    for (const p of sorted) {
      const n = tagOf(p).load
      if (n != null && n >= 1) set.add(n)
    }
    return [...set].sort((a, b) => a - b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, edits, suggestions])

  const inLoad = (n: number) => sorted.filter(p => tagOf(p).load === n)
  const unsorted = sorted.filter(p => tagOf(p).load === 0)
  const others = sorted.filter(p => tagOf(p).load == null)
  const changed = sorted.filter(p => !sameTag(tagOf(p), savedTag(p)))
  const suggestedCount = sorted.filter(isSuggestion).length
  // Loads are confirmed once every photo has been read, so each load starts with what its photos show.
  const stillReading = reading != null && reading.done < reading.total

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll(list: CdrPhoto[]) {
    setSelected(prev => {
      const ids = list.map(p => p.id)
      const all = ids.every(id => prev.has(id))
      const next = new Set(prev)
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function apply(change: (current: CdrTag, p: CdrPhoto) => CdrTag) {
    setEdits(prev => {
      const next = { ...prev }
      for (const p of sorted) if (selected.has(p.id)) next[p.id] = change(tagOf(p), p)
      return next
    })
    setError('')
  }

  const moveTo = (load: number | null) => {
    apply(current => (load == null ? { load: null, role: null } : { load, role: current.role ?? 'load' }))
    setSelected(new Set())
  }
  const setRole = (role: CdrRole) => apply(current => ({ load: current.load == null ? 0 : current.load, role }))

  async function confirm() {
    const tags = new Map<string, CdrTag>()
    for (const p of sorted) tags.set(p.id, tagOf(p))
    const compact = compactLoadNumbers(tags)
    const rows: CdrTagRow[] = []
    for (const p of sorted) {
      const tag = compact.get(p.id)
      if (tag && !sameTag(tag, savedTag(p))) rows.push({ id: p.id, load: tag.load, role: tag.load == null ? null : tag.role })
    }
    if (!rows.length) return
    setSaving(true)
    setError('')
    const result = await saveTags(rows).catch(() => ({ error: 'Could not save. Check the connection and try again.' } as { photos?: CdrPhoto[]; error?: string }))
    setSaving(false)
    if (!result.photos) {
      setError(result.error || 'Could not save the tags.')
      return
    }
    onPhotos(result.photos)
    setEdits({})
    setSelected(new Set())
    onSaved?.()
  }

  const group = (title: string, list: CdrPhoto[], note?: string) => {
    if (!list.length) return null
    const first = list.find(p => p.taken_at)
    const when = first ? formatEventWhen(localStamp(first.taken_at)) : ''
    return (
      <div key={title} style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ ...HEADING, color: 'var(--accent)' }}>{title}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {list.length} photo{list.length === 1 ? '' : 's'}{when ? ` · from ${when}` : ''}{note ? ` · ${note}` : ''}
          </span>
          <button type="button" onClick={() => selectAll(list)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
            Select all
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 8 }}>
          {list.map(p => (
            <TagThumb
              key={p.id}
              photo={p}
              tag={tagOf(p)}
              suggested={isSuggestion(p)}
              selected={selected.has(p.id)}
              onToggle={() => toggle(p.id)}
              onZoom={() => setZoom(p)}
            />
          ))}
        </div>
      </div>
    )
  }

  if (!sorted.length) {
    return <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No disposal photos on this job yet.</div>
  }

  const nextLoad = (loadNumbers[loadNumbers.length - 1] ?? 0) + 1

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {reading && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {reading.done < reading.total
            ? `Reading photos… ${reading.done} of ${reading.total}`
            : `${reading.failed} photo${reading.failed === 1 ? '' : 's'} could not be read. Sort ${reading.failed === 1 ? 'it' : 'them'} by hand.`}
        </div>
      )}
      {suggestedCount > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Dashed photos are sorted by their time and place, not yet confirmed. Tap photos to select them, then move them or change what they show.
        </div>
      )}

      {loadNumbers.map(n => group(`Load ${n}`, inLoad(n)))}
      {group('Not yet in a load', unsorted, unsorted.every(p => !p.taken_at) ? 'no camera time to sort by' : undefined)}
      {others.length > 0 && (
        showOthers || others.some(p => p.cdr_load != null || edits[p.id])
          ? group('Not in the disposal record', others)
          : (
            <button type="button" onClick={() => setShowOthers(true)} style={{ ...PILL, justifySelf: 'start' }}>
              Add from the job&rsquo;s other photos ({others.length})
            </button>
          )
      )}

      <div style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'grid', gap: 8, padding: '10px 0', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>{selected.size} selected</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Move to</span>
            {loadNumbers.map(n => (
              <button key={n} type="button" style={PILL} onClick={() => moveTo(n)}>Load {n}</button>
            ))}
            <button type="button" style={PILL} onClick={() => moveTo(nextLoad)}>New load</button>
            <button type="button" style={{ ...PILL, color: 'var(--text-muted)' }} onClick={() => moveTo(null)}>Not in record</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>Shows</span>
            {CDR_ROLES.map(r => (
              <button key={r.id} type="button" style={{ ...PILL, borderColor: ROLE_COLOR[r.id], color: ROLE_COLOR[r.id] }} onClick={() => setRole(r.id)}>
                {r.label}
              </button>
            ))}
            <button type="button" style={{ ...PILL, border: 'none', background: 'none', color: 'var(--text-muted)' }} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={saving || stillReading || changed.length === 0} onClick={() => void confirm()} style={{ fontWeight: 800 }}>
            {saving ? 'Saving…' : stillReading && reading ? `Reading photos… ${reading.done} of ${reading.total}` : changed.length ? `Confirm ${loadNumbers.length} load${loadNumbers.length === 1 ? '' : 's'}` : 'Tags confirmed'}
          </button>
          {changed.length > 0 && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{changed.length} photo{changed.length === 1 ? '' : 's'} to save</span>
          )}
          {error && <span style={{ fontSize: 13, fontWeight: 700, color: '#F87171' }}>{error}</span>}
        </div>
      </div>

      {zoom && (
        <div
          role="dialog"
          aria-label="Photo"
          onClick={() => setZoom(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.file_url} alt={zoom.caption || 'Disposal photo'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}

function TagThumb({ photo, tag, suggested, selected, onToggle, onZoom }: {
  photo: CdrPhoto
  tag: CdrTag
  suggested: boolean
  selected: boolean
  onToggle: () => void
  onZoom: () => void
}) {
  const role = tag.load != null ? tag.role : null
  const color = role ? ROLE_COLOR[role] : 'var(--text-muted)'
  const stamp = localStamp(photo.taken_at)
  const label = role ? CDR_ROLES.find(r => r.id === role)?.label : tag.load == null ? '' : 'Unsorted'
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div
        role="checkbox"
        aria-checked={selected}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle() } }}
        style={{
          position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: 'var(--surface-2)',
          outline: selected ? '3px solid #FF6B35' : `2px ${suggested ? 'dashed' : 'solid'} ${role ? color : 'var(--border)'}`,
          outlineOffset: selected ? 0 : -2,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.file_url} alt={photo.caption || 'Disposal photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {label && (
          <span style={{ position: 'absolute', left: 4, bottom: 4, padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: 'rgba(0,0,0,0.72)', color }}>
            {label}{suggested ? ' ?' : ''}
          </span>
        )}
        <button
          type="button"
          aria-label="View photo"
          onClick={e => { e.stopPropagation(); onZoom() }}
          style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, padding: 0, border: 'none', borderRadius: 999, background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: '24px', cursor: 'zoom-in' }}
        >
          ⤢
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stamp ? formatEventWhen(stamp).replace(/ \d{4},/, ',') : 'No camera time'}
      </div>
    </div>
  )
}
