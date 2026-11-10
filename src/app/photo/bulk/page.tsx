/*
 * app/photo/bulk/page.tsx — bulk photo loader (photo.biohazards.net/bulk).
 *
 * PIN → job code → drop in many photos. Each photo is compressed in the
 * browser (keeping the camera time and GPS read from the original), uploaded a
 * few at a time, and saved as an ordinary job photo with the chosen tag, so it
 * shows in the job's Photos tab and the report photo pickers.
 */
'use client'

import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { compressImage } from '@/lib/compressImage'
import { readPhotoExif } from '@/lib/photoExif'

interface Person { person_id: string; name: string; person_code: string }
interface BulkJob { id: string; job_code: string; client_name: string; site_address: string }

type Category = 'before' | 'during' | 'after' | 'assessment'
const CATEGORIES: { id: Category; label: string; color: string }[] = [
  { id: 'before', label: 'Before', color: '#F87171' },
  { id: 'during', label: 'During', color: '#FBBF24' },
  { id: 'after', label: 'After', color: '#4ADE80' },
  { id: 'assessment', label: 'Assessment', color: '#60A5FA' },
]

type ItemStatus = 'waiting' | 'uploading' | 'done' | 'failed'
interface Item {
  id: string
  file: File
  preview: string
  status: ItemStatus
  category: Category | null
  error?: string
}

const CONCURRENCY = 3

class SignedOutError extends Error {}

async function uploadOne(file: File, jobId: string, category: Category): Promise<void> {
  const exif = await readPhotoExif(file).catch(() => null)
  let compressed: Blob
  try {
    compressed = await compressImage(file)
  } catch {
    throw new Error(/\.hei[cf]$/i.test(file.name) ? 'HEIC not supported here — export as JPEG' : 'Could not read this image')
  }
  const body = new FormData()
  body.append('file', compressed, 'photo.jpg')
  body.append('job_id', jobId)
  body.append('category', category)
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
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`)
}

export default function BulkPhotoLoaderPage() {
  const [booting, setBooting] = useState(true)
  const [person, setPerson] = useState<Person | null>(null)
  const [job, setJob] = useState<BulkJob | null>(null)

  useEffect(() => {
    fetch('/api/photo/bulk/session', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setPerson(d?.person ?? null))
      .catch(() => {})
      .finally(() => setBooting(false))
  }, [])

  async function signOut() {
    await fetch('/api/photo/bulk/session', { method: 'DELETE' }).catch(() => {})
    setPerson(null)
    setJob(null)
  }

  if (booting) {
    return <div style={shell}><div style={{ margin: 'auto', fontWeight: 800 }}>Loading…</div></div>
  }
  if (!person) return <PinStep onSignedIn={setPerson} />
  if (!job) return <JobStep person={person} onJob={setJob} onSignOut={() => void signOut()} />
  return (
    <Loader
      person={person}
      job={job}
      onChangeJob={() => setJob(null)}
      onSignOut={() => void signOut()}
      onSignedOut={() => { setPerson(null); setJob(null) }}
    />
  )
}

function Brand({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF6B35' }}>
        Bulk photo loader
      </div>
      <h1 style={{ margin: '4px 0 6px', fontSize: 26, fontWeight: 900 }}>{title}</h1>
      {subtitle && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{subtitle}</p>}
    </div>
  )
}

function PinStep({ onSignedIn }: { onSignedIn: (p: Person) => void }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!/^\d{4}$/.test(pin) || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/photo/bulk/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = (await res.json().catch(() => ({}))) as { person?: Person; error?: string }
      if (!res.ok || !data.person) throw new Error(data.error ?? 'Could not sign in.')
      onSignedIn(data.person)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={shell}>
      <form
        onSubmit={e => { e.preventDefault(); void submit() }}
        style={{ ...column, maxWidth: 380 }}
      >
        <Brand title="Enter your PIN" subtitle="Your photo PIN, the same one used on the camera." />
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          aria-label="Photo PIN"
          style={{ ...bigInput, letterSpacing: '0.6em', textAlign: 'center' }}
        />
        {error && <div style={errorBox}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={pin.length !== 4 || busy} style={bigButton}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}

function JobStep({ person, onJob, onSignOut }: { person: Person; onJob: (j: BulkJob) => void; onSignOut: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<BulkJob | null>(null)

  async function find() {
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    setFound(null)
    try {
      const res = await fetch(`/api/photo/bulk/job?code=${encodeURIComponent(code.trim())}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { job?: BulkJob; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error ?? 'Job not found.')
      setFound(data.job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Job not found.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={shell}>
      <div style={{ ...column, maxWidth: 420 }}>
        <SignedInBar person={person} onSignOut={onSignOut} />
        <Brand title="Which job?" subtitle="Type the job code, e.g. 3456." />
        <form onSubmit={e => { e.preventDefault(); void find() }} style={{ display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase().slice(0, 32)); setFound(null) }}
            placeholder="Job code"
            aria-label="Job code"
            inputMode="numeric"
            style={{ ...bigInput, flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
          <button type="submit" className="btn btn-secondary" disabled={!code.trim() || busy} style={{ padding: '0 18px', fontWeight: 800 }}>
            {busy ? '…' : 'Find'}
          </button>
        </form>
        {error && <div style={errorBox}>{error}</div>}
        {found && (
          <div style={{ border: '2px solid #FF6B35', borderRadius: 14, padding: 14, background: 'var(--surface)', display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, color: '#FF6B35' }}>#{found.job_code}</div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{found.client_name || 'Unnamed client'}</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{found.site_address}</div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => onJob(found)} style={bigButton}>
              Load photos to this job
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SignedInBar({ person, onSignOut }: { person: Person; onSignOut: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, color: 'var(--text-muted)' }}>
      <span>Signed in as <strong style={{ color: 'var(--text)' }}>{person.name}</strong> ({person.person_code})</span>
      <button type="button" onClick={onSignOut} className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>Sign out</button>
    </div>
  )
}

function Loader({ person, job, onChangeJob, onSignOut, onSignedOut }: {
  person: Person
  job: BulkJob
  onChangeJob: () => void
  onSignOut: () => void
  onSignedOut: () => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [category, setCategory] = useState<Category>('before')
  const [running, setRunning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => () => { for (const it of itemsRef.current) URL.revokeObjectURL(it.preview) }, [])

  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  function addFiles(list: FileList | File[]) {
    const images = Array.from(list).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|hei[cf])$/i.test(f.name))
    if (!images.length) return
    setItems(prev => [
      ...prev,
      ...images.map(file => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        status: 'waiting' as const,
        category: null,
      })),
    ])
  }

  function patch(id: string, next: Partial<Item>) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...next } : it)))
  }

  function remove(id: string) {
    setItems(prev => {
      const it = prev.find(x => x.id === id)
      if (it) URL.revokeObjectURL(it.preview)
      return prev.filter(x => x.id !== id)
    })
  }

  function clearFinished() {
    setItems(prev => {
      for (const it of prev) if (it.status === 'done') URL.revokeObjectURL(it.preview)
      return prev.filter(it => it.status !== 'done')
    })
  }

  async function start(statuses: ItemStatus[]) {
    const queue = itemsRef.current.filter(it => statuses.includes(it.status))
    if (!queue.length) return
    const ids = new Set(queue.map(it => it.id))
    setItems(prev => prev.map(it => (ids.has(it.id) ? { ...it, status: 'waiting', error: undefined, category } : it)))
    setRunning(true)
    let signedOut = false
    let next = 0
    const worker = async () => {
      while (!signedOut && next < queue.length) {
        const it = queue[next++]
        patch(it.id, { status: 'uploading' })
        try {
          await uploadOne(it.file, job.id, category)
          patch(it.id, { status: 'done' })
        } catch (e) {
          if (e instanceof SignedOutError) {
            signedOut = true
            patch(it.id, { status: 'waiting' })
          } else {
            patch(it.id, { status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' })
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setRunning(false)
    if (signedOut) {
      window.alert('Your sign-in expired. Enter your PIN again; photos not yet uploaded will need to be added again.')
      onSignedOut()
    }
  }

  const counts = items.reduce(
    (acc, it) => { acc[it.status] += 1; return acc },
    { waiting: 0, uploading: 0, done: 0, failed: 0 } as Record<ItemStatus, number>,
  )
  const total = items.length
  const progress = total ? Math.round(((counts.done + counts.failed) / total) * 100) : 0

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  return (
    <div style={shell}>
      <div style={{ ...column, maxWidth: 960 }}>
        <SignedInBar person={person} onSignOut={onSignOut} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 900, color: '#FF6B35' }}>#{job.job_code}</div>
            <div style={{ fontWeight: 800, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.client_name || 'Unnamed client'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.site_address}</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onChangeJob} disabled={running} style={{ fontSize: 13 }}>Change job</button>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Tag these photos as
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => {
              const on = c.id === category
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={running}
                  onClick={() => setCategory(c.id)}
                  aria-pressed={on}
                  style={{
                    padding: '8px 16px', borderRadius: 999, fontWeight: 800, fontSize: 14, cursor: running ? 'default' : 'pointer',
                    border: `2px solid ${on ? c.color : 'var(--border)'}`,
                    background: on ? `${c.color}22` : 'transparent',
                    color: on ? c.color : 'var(--text)',
                  }}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
          style={{
            border: `2px dashed ${dragOver ? '#FF6B35' : 'var(--border)'}`,
            background: dragOver ? 'rgba(255,107,53,0.08)' : 'var(--surface)',
            borderRadius: 16, padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 32 }}>📷</div>
          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 6 }}>Drop photos here, or tap to choose</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Select as many as you like</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }}
          />
        </div>

        {total > 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, fontSize: 14 }}>
                <strong>{total}</strong> photo{total === 1 ? '' : 's'}
                {counts.done > 0 && <> · <span style={{ color: '#4ADE80' }}>{counts.done} uploaded</span></>}
                {counts.failed > 0 && <> · <span style={{ color: '#F87171' }}>{counts.failed} failed</span></>}
                {counts.waiting > 0 && <> · {counts.waiting} waiting</>}
              </div>
              {counts.done > 0 && !running && (
                <button type="button" className="btn btn-ghost" onClick={clearFinished} style={{ fontSize: 13 }}>Clear uploaded</button>
              )}
              {counts.failed > 0 && !running && (
                <button type="button" className="btn btn-secondary" onClick={() => void start(['failed'])} style={{ fontSize: 13 }}>
                  Retry {counts.failed} failed
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={running || counts.waiting === 0}
                onClick={() => void start(['waiting'])}
                style={{ fontWeight: 800 }}
              >
                {running ? `Uploading… ${progress}%` : `Upload ${counts.waiting} as ${CATEGORIES.find(c => c.id === category)?.label}`}
              </button>
            </div>
            {running && (
              <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: '#FF6B35', transition: 'width 0.2s' }} />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {items.map(it => <Thumb key={it.id} item={it} onRemove={running ? undefined : () => remove(it.id)} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Thumb({ item, onRemove }: { item: Item; onRemove?: () => void }) {
  const cat = CATEGORIES.find(c => c.id === item.category)
  const overlay: Record<ItemStatus, string> = {
    waiting: 'rgba(0,0,0,0)',
    uploading: 'rgba(0,0,0,0.45)',
    done: 'rgba(0,0,0,0)',
    failed: 'rgba(127,29,29,0.55)',
  }
  return (
    <div title={item.error ?? item.file.name} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)', aspectRatio: '1' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.preview} alt={item.file.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', inset: 0, background: overlay[item.status], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12, textAlign: 'center', padding: 6 }}>
        {item.status === 'uploading' && <span className="spinner" />}
        {item.status === 'failed' && <span>{item.error ?? 'Failed'}</span>}
      </div>
      {item.status === 'done' && (
        <span style={{ position: 'absolute', bottom: 4, left: 4, padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: 'rgba(0,0,0,0.7)', color: cat?.color ?? '#4ADE80' }}>
          ✓ {cat?.label}
        </span>
      )}
      {onRemove && item.status !== 'done' && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.file.name}`}
          style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, padding: 0, border: 'none', borderRadius: 999, background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: '22px', cursor: 'pointer' }}
        >
          ×
        </button>
      )}
    </div>
  )
}

const shell: CSSProperties = { minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }
const column: CSSProperties = { width: '100%', margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }
const bigInput: CSSProperties = {
  width: '100%', height: 56, padding: '0 16px', borderRadius: 12, fontSize: 22, fontWeight: 800,
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
}
const bigButton: CSSProperties = { height: 52, fontSize: 16, fontWeight: 800, borderRadius: 12 }
const errorBox: CSSProperties = { padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.14)', color: '#F87171', fontWeight: 700, fontSize: 14 }
