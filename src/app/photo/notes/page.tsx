/*
 * app/photo/notes/page.tsx — job notepad (notes.biohazards.net, also photo.biohazards.net/notes).
 *
 * PIN → job code → one endless page for the job, oldest at the top. Write at
 * the bottom; the note saves itself a moment after you stop typing. Snap or
 * pick photos and give each a description. Notes are ordinary progress notes
 * and photos ordinary Untagged job photos, so nothing is typed up again in the
 * office.
 *
 * Unsent notes are kept on this phone (localStorage) and retried when there is
 * signal. Unsent photos are retried while the page stays open.
 */
'use client'

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type Ref, type RefObject } from 'react'
import {
  JobStep,
  PinStep,
  captureShell,
  useCaptureSession,
  type CaptureJob,
  type CapturePerson,
} from '@/components/photoApp/CaptureSignIn'
import { compressImage } from '@/lib/compressImage'
import { readPhotoExif } from '@/lib/photoExif'
import { noteWasEdited, sortPad, type PadItem, type PadNote } from '@/lib/photoNotes'

const APP = 'Job notepad'
const JOB_KEY = 'bh_notepad_job'
const SAVE_DELAY_MS = 900
const RETRY_MS = 20_000

type Sync = 'saved' | 'sending' | 'waiting' | 'failed'

interface NoteEntry {
  kind: 'note'
  key: string
  id: string | null
  body: string
  at: string
  updated_at: string
  by: string
  mine: boolean
  sync: Sync
}

interface PhotoEntry {
  kind: 'photo'
  key: string
  id: string | null
  src: string
  caption: string
  savedCaption: string
  at: string
  by: string
  mine: boolean
  sync: Sync
  file?: File
  error?: string
}

type Entry = NoteEntry | PhotoEntry

const pendingKey = (jobId: string) => `bh_notepad_pending:${jobId}`

function readPending(jobId: string): NoteEntry[] {
  try {
    const raw = window.localStorage.getItem(pendingKey(jobId))
    const list = raw ? (JSON.parse(raw) as NoteEntry[]) : []
    return Array.isArray(list) ? list.filter(n => n && n.kind === 'note' && typeof n.body === 'string').map(n => ({ ...n, sync: 'waiting' })) : []
  } catch {
    return []
  }
}

function writePending(jobId: string, entries: Entry[]) {
  const pending = entries.filter((e): e is NoteEntry => e.kind === 'note' && e.sync !== 'saved' && Boolean(e.body.trim()))
  try {
    if (pending.length) window.localStorage.setItem(pendingKey(jobId), JSON.stringify(pending))
    else window.localStorage.removeItem(pendingKey(jobId))
  } catch {}
}

function fromItem(item: PadItem): Entry {
  if (item.kind === 'note') return { ...item, key: `note:${item.id}`, sync: 'saved' }
  return {
    kind: 'photo', key: `photo:${item.id}`, id: item.id, src: item.file_url, caption: item.caption,
    savedCaption: item.caption, at: item.at, by: item.by, mine: item.mine, sync: 'saved',
  }
}

/** Server copy, except where this phone still has changes the server has not got. */
function mergeEntries(local: Entry[], server: Entry[]): Entry[] {
  const byId = new Map(local.filter(e => e.id).map(e => [`${e.kind}:${e.id}`, e]))
  const out: Entry[] = server.map(s => {
    const id = `${s.kind}:${s.id}`
    const l = byId.get(id)
    if (!l) return s
    byId.delete(id)
    if (l.sync !== 'saved') return l
    return l.kind === 'photo' && s.kind === 'photo' ? { ...s, key: l.key, src: l.src } : { ...s, key: l.key }
  })
  for (const l of local) {
    if (!l.id || (l.sync !== 'saved' && byId.has(`${l.kind}:${l.id}`))) out.push(l)
  }
  return out
}

function isImage(f: File) {
  return f.type.startsWith('image/') || /\.(jpe?g|png|webp|hei[cf])$/i.test(f.name)
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim()
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

class SignedOutError extends Error {}

/** Read during the first render, which is always the loading screen, so server and client markup match. */
function rememberedJob(): CaptureJob | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(JOB_KEY)
    return raw ? (JSON.parse(raw) as CaptureJob) : null
  } catch {
    return null
  }
}

export default function NotepadPage() {
  const session = useCaptureSession()
  const { booting, person, setPerson } = session
  const [job, setJob] = useState<CaptureJob | null>(rememberedJob)

  function chooseJob(next: CaptureJob) {
    setJob(next)
    try { window.localStorage.setItem(JOB_KEY, JSON.stringify(next)) } catch {}
  }

  function changeJob() {
    setJob(null)
    try { window.localStorage.removeItem(JOB_KEY) } catch {}
  }

  if (booting) {
    return <div style={captureShell}><div style={{ margin: 'auto', fontWeight: 800 }}>Loading…</div></div>
  }
  if (!person) return <PinStep app={APP} onSignedIn={setPerson} />
  if (!job) return <JobStep app={APP} person={person} actionLabel="Open notepad" onJob={chooseJob} onSignOut={() => void session.signOut()} />
  return (
    <Notepad
      key={job.id}
      person={person}
      job={job}
      onChangeJob={changeJob}
      onSignOut={() => { void session.signOut(); changeJob() }}
      onSignedOut={() => setPerson(null)}
    />
  )
}

function Notepad({ person, job, onChangeJob, onSignOut, onSignedOut }: {
  person: CapturePerson
  job: CaptureJob
  onChangeJob: () => void
  onSignOut: () => void
  onSignedOut: () => void
}) {
  const entriesRef = useRef<Entry[]>([])
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [online, setOnline] = useState(true)
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const timers = useRef(new Map<string, number>())
  const inflight = useRef(new Set<string>())
  const again = useRef(new Set<string>())
  const uploadChain = useRef<Promise<void>>(Promise.resolve())
  const signedOutRef = useRef(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const me = firstName(person.name)
  const entries = entriesRef.current

  const mutate = useCallback((fn: (prev: Entry[]) => Entry[]) => {
    entriesRef.current = fn(entriesRef.current)
    writePending(job.id, entriesRef.current)
    rerender()
  }, [job.id])

  const update = useCallback((key: string, fn: (e: Entry) => Entry | null) => {
    mutate(prev => prev.flatMap(e => {
      if (e.key !== key) return [e]
      const next = fn(e)
      return next ? [next] : []
    }))
  }, [mutate])

  const find = (key: string) => entriesRef.current.find(e => e.key === key)

  const handleSignedOut = useCallback(() => {
    if (signedOutRef.current) return
    signedOutRef.current = true
    const photosWaiting = entriesRef.current.some(e => e.kind === 'photo' && e.sync !== 'saved')
    window.alert(photosWaiting
      ? 'Your sign-in expired. Enter your PIN again. Notes are kept on this phone; photos not yet sent need adding again.'
      : 'Your sign-in expired. Enter your PIN again. Notes not yet sent are kept on this phone.')
    onSignedOut()
  }, [onSignedOut])

  const load = useCallback(async (initial: boolean) => {
    try {
      const res = await fetch(`/api/photo/notes?job_id=${encodeURIComponent(job.id)}`, { cache: 'no-store' })
      if (res.status === 401) { handleSignedOut(); return }
      const data = (await res.json().catch(() => ({}))) as { items?: PadItem[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Could not load the notepad (${res.status}).`)
      const server = (data.items ?? []).map(fromItem)
      mutate(prev => {
        const local = initial ? [...prev, ...readPending(job.id).filter(p => !prev.some(e => e.key === p.key))] : prev
        return mergeEntries(local, server)
      })
      setLoadError('')
    } catch (e) {
      if (initial) setLoadError(e instanceof Error ? e.message : 'Could not load the notepad.')
    } finally {
      if (initial) setLoading(false)
    }
  }, [handleSignedOut, job.id, mutate])

  async function syncNote(key: string) {
    if (inflight.current.has(key)) { again.current.add(key); return }
    const entry = find(key)
    if (!entry || entry.kind !== 'note') return
    const body = entry.body.trim()
    if (!body) return
    inflight.current.add(key)
    update(key, e => ({ ...e, sync: 'sending' }))
    try {
      const res = entry.id
        ? await fetch(`/api/photo/notes/${entry.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ body }) })
        : await fetch('/api/photo/notes', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ job_id: job.id, body, written_at: entry.at }) })
      if (res.status === 401) throw new SignedOutError()
      const data = (await res.json().catch(() => ({}))) as { note?: PadNote; error?: string }
      if (!res.ok || !data.note) throw new Error(data.error ?? 'Not saved')
      const saved = data.note
      update(key, e => (e.kind !== 'note' ? e : {
        ...e, id: saved.id, at: saved.at, updated_at: saved.updated_at,
        sync: e.body.trim() === body ? 'saved' : 'waiting',
      }))
    } catch (e) {
      update(key, x => ({ ...x, sync: e instanceof SignedOutError ? 'waiting' : 'failed' }))
      if (e instanceof SignedOutError) handleSignedOut()
    } finally {
      inflight.current.delete(key)
      const latest = find(key)
      if (again.current.delete(key) || latest?.sync === 'waiting') schedule(key)
    }
  }

  async function syncCaption(key: string) {
    if (inflight.current.has(key)) { again.current.add(key); return }
    const entry = find(key)
    if (!entry || entry.kind !== 'photo' || !entry.id) return
    const caption = entry.caption.trim()
    inflight.current.add(key)
    update(key, e => ({ ...e, sync: 'sending' }))
    try {
      const res = await fetch(`/api/photo/notes/photos/${entry.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ caption }) })
      if (res.status === 401) throw new SignedOutError()
      if (!res.ok) throw new Error('Not saved')
      update(key, e => (e.kind !== 'photo' ? e : {
        ...e, savedCaption: caption, sync: e.caption.trim() === caption ? 'saved' : 'waiting',
      }))
    } catch (e) {
      update(key, x => ({ ...x, sync: e instanceof SignedOutError ? 'waiting' : 'failed' }))
      if (e instanceof SignedOutError) handleSignedOut()
    } finally {
      inflight.current.delete(key)
      const latest = find(key)
      if (again.current.delete(key) || latest?.sync === 'waiting') schedule(key)
    }
  }

  async function uploadPhoto(key: string) {
    const entry = find(key)
    if (!entry || entry.kind !== 'photo' || entry.id || !entry.file) return
    const file = entry.file
    update(key, e => ({ ...e, sync: 'sending', error: undefined }))
    try {
      const exif = await readPhotoExif(file).catch(() => null)
      let compressed: Blob
      try {
        compressed = await compressImage(file)
      } catch {
        throw new Error(/\.hei[cf]$/i.test(file.name) ? 'HEIC not supported here — export as JPEG' : 'Could not read this image')
      }
      const caption = (find(key) as PhotoEntry | undefined)?.caption.trim() ?? ''
      const body = new FormData()
      body.append('file', compressed, 'photo.jpg')
      body.append('job_id', job.id)
      body.append('category', 'untagged')
      body.append('caption', caption)
      if (exif?.takenAt) {
        const t = new Date(exif.takenAt)
        if (!Number.isNaN(t.getTime())) body.append('taken_at', t.toISOString())
      }
      if (exif?.lat != null && exif?.lng != null) {
        body.append('lat', String(exif.lat))
        body.append('lng', String(exif.lng))
      }
      const res = await fetch('/api/photo/bulk/upload', { method: 'POST', body })
      if (res.status === 401) throw new SignedOutError()
      const data = (await res.json().catch(() => ({}))) as { photo?: { id: string }; error?: string }
      if (!res.ok || !data.photo) throw new Error(data.error ?? `Upload failed (${res.status})`)
      const id = data.photo.id
      update(key, e => (e.kind !== 'photo' ? e : {
        ...e, id, file: undefined, savedCaption: caption,
        sync: e.caption.trim() === caption ? 'saved' : 'waiting',
      }))
      if (find(key)?.sync === 'waiting') schedule(key)
    } catch (e) {
      if (e instanceof SignedOutError) {
        update(key, x => ({ ...x, sync: 'waiting' }))
        handleSignedOut()
      } else {
        update(key, x => ({ ...x, sync: 'failed', error: e instanceof Error ? e.message : 'Upload failed' }))
      }
    }
  }

  function queueUpload(key: string) {
    uploadChain.current = uploadChain.current.then(() => uploadPhoto(key))
  }

  function schedule(key: string, delay = SAVE_DELAY_MS) {
    const t = timers.current.get(key)
    if (t) window.clearTimeout(t)
    timers.current.set(key, window.setTimeout(() => {
      timers.current.delete(key)
      const e = find(key)
      if (!e) return
      if (e.kind === 'note') void syncNote(key)
      else if (e.id) void syncCaption(key)
    }, delay))
  }

  function flush(key: string) {
    const t = timers.current.get(key)
    if (!t) return
    window.clearTimeout(t)
    timers.current.delete(key)
    const e = find(key)
    if (e?.kind === 'note') void syncNote(key)
    else if (e?.kind === 'photo' && e.id) void syncCaption(key)
  }

  function editNote(key: string, body: string) {
    update(key, e => (e.kind === 'note' ? { ...e, body, sync: 'waiting' } : e))
    schedule(key)
  }

  function writeInComposer(body: string) {
    if (currentKey && find(currentKey)) {
      editNote(currentKey, body)
      return
    }
    if (!body.trim()) return
    const key = crypto.randomUUID()
    const now = new Date().toISOString()
    mutate(prev => [...prev, { kind: 'note', key, id: null, body, at: now, updated_at: now, by: me, mine: true, sync: 'waiting' }])
    setCurrentKey(key)
    schedule(key)
  }

  /** The note being written is done: send it now, or drop it if it was emptied. */
  function finishCurrent() {
    if (!currentKey) return
    const e = find(currentKey)
    setCurrentKey(null)
    if (!e || e.kind !== 'note') return
    if (e.body.trim()) { flush(e.key); return }
    removeNote(e.key)
  }

  function removeNote(key: string) {
    const e = find(key)
    if (!e || e.kind !== 'note') return
    const t = timers.current.get(key)
    if (t) { window.clearTimeout(t); timers.current.delete(key) }
    update(key, () => null)
    if (e.id) {
      void fetch(`/api/photo/notes/${e.id}`, { method: 'DELETE' }).then(res => {
        if (res.status === 401) handleSignedOut()
        else if (!res.ok) window.alert('The note could not be deleted. It will show again next time the notepad loads.')
      }).catch(() => window.alert('No signal. The note was not deleted and will show again next time the notepad loads.'))
    }
  }

  async function addPhotos(list: FileList) {
    finishCurrent()
    const files = Array.from(list).filter(isImage)
    let last: string | null = null
    for (const file of files) {
      const exif = await readPhotoExif(file).catch(() => null)
      const taken = exif?.takenAt ? new Date(exif.takenAt) : null
      const at = taken && !Number.isNaN(taken.getTime()) && taken.getTime() <= Date.now() + 60_000
        ? taken.toISOString()
        : new Date().toISOString()
      const key = crypto.randomUUID()
      mutate(prev => [...prev, {
        kind: 'photo', key, id: null, src: URL.createObjectURL(file), caption: '', savedCaption: '',
        at, by: me, mine: true, sync: 'sending', file,
      }])
      queueUpload(key)
      last = key
    }
    if (last) setFocusKey(last)
  }

  function editCaption(key: string, caption: string) {
    const e = find(key)
    if (!e || e.kind !== 'photo') return
    update(key, x => (x.kind === 'photo' ? { ...x, caption, sync: x.id ? 'waiting' : x.sync } : x))
    if (e.id) schedule(key)
  }

  function retryAll() {
    if (signedOutRef.current) return
    for (const e of entriesRef.current) {
      if (inflight.current.has(e.key) || timers.current.has(e.key)) continue
      if (e.sync !== 'failed' && e.sync !== 'waiting') continue
      if (e.kind === 'note') void syncNote(e.key)
      else if (e.id) void syncCaption(e.key)
      else if (e.file) queueUpload(e.key)
    }
  }
  const retryRef = useRef(retryAll)
  retryRef.current = retryAll

  useEffect(() => {
    void load(true).then(() => retryRef.current())
  }, [load])

  useEffect(() => {
    const goOnline = () => { setOnline(true); retryRef.current() }
    const goOffline = () => setOnline(false)
    const onVisible = () => { if (document.visibilityState === 'visible') void load(false).then(() => retryRef.current()) }
    setOnline(navigator.onLine)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => retryRef.current(), RETRY_MS)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [load])

  const photosUnsent = entries.some(e => e.kind === 'photo' && e.sync !== 'saved')
  useEffect(() => {
    if (!photosUnsent) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [photosUnsent])

  useEffect(() => () => {
    for (const e of entriesRef.current) if (e.kind === 'photo' && e.src.startsWith('blob:')) URL.revokeObjectURL(e.src)
    for (const t of timers.current.values()) window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!loading) window.scrollTo({ top: document.documentElement.scrollHeight })
  }, [loading])

  useEffect(() => {
    if (!focusKey) return
    document.querySelector(`[data-entry="${focusKey}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusKey])

  const current = currentKey ? entries.find(e => e.key === currentKey) as NoteEntry | undefined : undefined
  const feed = sortPad(entries.filter(e => e.key !== currentKey))
  const unsent = entries.filter(e => e.sync !== 'saved').length
  const failed = entries.filter(e => e.sync === 'failed').length
  const status = !online
    ? { text: unsent ? `Offline · ${unsent} waiting` : 'Offline', color: '#FBBF24' }
    : failed
      ? { text: `${failed} not sent · retrying`, color: '#F87171' }
      : unsent
        ? { text: 'Saving…', color: 'var(--text-muted)' }
        : { text: 'All saved ✓', color: '#4ADE80' }

  let lastDay = ''

  return (
    <div style={captureShell}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ ...pageColumn, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, color: '#FF6B35' }}>#{job.job_code}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: status.color }}>{status.text}</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.client_name || 'Unnamed client'}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onChangeJob} style={{ fontSize: 12, padding: '4px 8px' }}>Change job</button>
          <button type="button" className="btn btn-ghost" onClick={onSignOut} style={{ fontSize: 12, padding: '4px 8px' }} title={`Signed in as ${person.name}`}>Sign out</button>
        </div>
      </header>

      <main
        onClick={e => { if (e.target === e.currentTarget) composerRef.current?.focus() }}
        style={{ ...pageColumn, flex: 1, padding: '8px 16px 140px', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}><span className="spinner" /></div>}
        {loadError && (
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 14 }}>
            {loadError}
          </div>
        )}
        {!loading && !loadError && feed.length === 0 && !current && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, padding: '30px 0 0' }}>
            Nothing here yet. Write below, or snap a photo.
          </div>
        )}

        {feed.map(e => {
          const day = dayLabel(e.at)
          const showDay = day !== lastDay
          lastDay = day
          return (
            <div key={e.key} data-entry={e.key} style={{ display: 'grid', gap: 6 }}>
              {showDay && <div style={dayStyle}>{day}</div>}
              {e.kind === 'note'
                ? <NoteBlock
                    entry={e}
                    editing={editingKey === e.key}
                    onEdit={() => setEditingKey(e.key)}
                    onDone={() => { setEditingKey(null); flush(e.key) }}
                    onChange={body => editNote(e.key, body)}
                    onDelete={() => { if (window.confirm('Delete this note?')) { setEditingKey(null); removeNote(e.key) } }}
                  />
                : <PhotoBlock
                    entry={e}
                    autoFocus={focusKey === e.key}
                    onCaption={caption => editCaption(e.key, caption)}
                    onCaptionDone={() => { flush(e.key); setFocusKey(null) }}
                    onRetry={() => queueUpload(e.key)}
                  />}
            </div>
          )
        })}

        <div data-entry="composer" style={{ display: 'grid', gap: 6 }}>
          {current && <Meta at={current.at} by={me} sync={current.sync} />}
          <AutoTextarea
            ref={composerRef}
            value={current?.body ?? ''}
            onChange={writeInComposer}
            placeholder="Tap here and write…"
            minHeight={120}
            style={{ ...writingStyle, border: '1px dashed var(--border)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface)' }}
          />
        </div>
      </main>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 5, background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ ...pageColumn, display: 'flex', gap: 8, padding: '10px 16px' }}>
          <button type="button" className="btn btn-primary" onClick={() => cameraRef.current?.click()} style={barButton}>
            📷 Snap photo
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => libraryRef.current?.click()} style={barButton}>
            🖼 From library
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={e => { if (e.target.files) void addPhotos(e.target.files); e.target.value = '' }}
          style={{ display: 'none' }}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => { if (e.target.files) void addPhotos(e.target.files); e.target.value = '' }}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}

function Meta({ at, by, sync, edited }: { at: string; by: string; sync: Sync; edited?: boolean }) {
  const syncText: Record<Sync, string> = { saved: '', sending: 'Sending…', waiting: 'Not sent yet', failed: 'Not sent · will retry' }
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
      <span>{timeLabel(at)} · {by}{edited ? ' · edited' : ''}</span>
      {sync !== 'saved' && <span style={{ color: sync === 'failed' ? '#F87171' : '#FBBF24' }}>{syncText[sync]}</span>}
    </div>
  )
}

function NoteBlock({ entry, editing, onEdit, onDone, onChange, onDelete }: {
  entry: NoteEntry
  editing: boolean
  onEdit: () => void
  onDone: () => void
  onChange: (body: string) => void
  onDelete: () => void
}) {
  const edited = entry.id != null && noteWasEdited(entry)
  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <Meta at={entry.at} by={entry.by} sync={entry.sync} edited={edited} />
        <AutoTextarea autoFocus value={entry.body} onChange={onChange} onBlur={onDone} style={{ ...writingStyle, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-ghost" onMouseDown={e => e.preventDefault()} onClick={onDelete} style={{ fontSize: 12, color: '#F87171', padding: '4px 8px' }}>Delete note</button>
          <button type="button" className="btn btn-secondary" onClick={onDone} style={{ fontSize: 12, padding: '4px 12px' }}>Done</button>
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Meta at={entry.at} by={entry.by} sync={entry.sync} edited={edited} />
      <div
        onClick={entry.mine ? onEdit : undefined}
        style={{ ...writingStyle, whiteSpace: 'pre-wrap', cursor: entry.mine ? 'text' : 'default' }}
      >
        {entry.body}
      </div>
    </div>
  )
}

function PhotoBlock({ entry, autoFocus, onCaption, onCaptionDone, onRetry }: {
  entry: PhotoEntry
  autoFocus: boolean
  onCaption: (caption: string) => void
  onCaptionDone: () => void
  onRetry: () => void
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Meta at={entry.at} by={entry.by} sync={entry.sync} />
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: 'var(--surface-2)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.src} alt={entry.caption || 'Job photo'} loading="lazy" style={{ width: '100%', display: 'block' }} />
        {entry.sync === 'sending' && !entry.id && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner" />
          </div>
        )}
      </div>
      {entry.sync === 'failed' && !entry.id && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#F87171', fontWeight: 700 }}>
          <span style={{ flex: 1 }}>{entry.error ?? 'Not uploaded'}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry} style={{ fontSize: 12, padding: '4px 12px' }}>Retry</button>
        </div>
      )}
      {entry.mine ? (
        <AutoTextarea
          autoFocus={autoFocus}
          value={entry.caption}
          onChange={onCaption}
          onBlur={onCaptionDone}
          placeholder="Add a description…"
          style={{ ...writingStyle, fontSize: 15, padding: '2px 0', border: 'none', background: 'transparent' }}
        />
      ) : entry.caption ? (
        <div style={{ ...writingStyle, fontSize: 15, whiteSpace: 'pre-wrap' }}>{entry.caption}</div>
      ) : null}
    </div>
  )
}

function AutoTextarea({ ref, value, onChange, onBlur, placeholder, autoFocus, minHeight = 0, style }: {
  ref?: Ref<HTMLTextAreaElement>
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  autoFocus?: boolean
  minHeight?: number
  style?: CSSProperties
}) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  }, [value, minHeight])
  return (
    <textarea
      ref={el => {
        inner.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as RefObject<HTMLTextAreaElement | null>).current = el
      }}
      autoFocus={autoFocus}
      value={value}
      rows={1}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      style={{ width: '100%', resize: 'none', overflow: 'hidden', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', ...style }}
    />
  )
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const pageColumn: CSSProperties = { width: '100%', maxWidth: 680, margin: '0 auto' }
const writingStyle: CSSProperties = { fontSize: 17, lineHeight: 1.5 }
const dayStyle: CSSProperties = {
  alignSelf: 'center', justifySelf: 'center', marginTop: 10, padding: '3px 12px', borderRadius: 999,
  background: 'var(--surface-2)', fontSize: 12, fontWeight: 800, color: 'var(--text-muted)',
}
const barButton: CSSProperties = { flex: 1, height: 50, fontSize: 15, fontWeight: 800, borderRadius: 12 }
