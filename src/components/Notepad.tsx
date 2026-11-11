'use client'

/*
 * components/Notepad.tsx
 *
 * A private notepad for desk staff. Mounted once in the root layout, so it is
 * on every page and stays open with its text while moving between pages.
 * A round button in the bottom-left corner opens a floating card; the X
 * (or Esc while typing in it) closes it. There is no backdrop, so the page
 * behind stays usable.
 *
 * Who sees it:
 *   - Computer only: hidden below the Agent view width (lib/viewMode).
 *   - Not inside the Agent view's embedded job page, so only the outer window
 *     has one (lib/jobEmbed).
 *   - Not technicians: the proxy keeps them off /api/notepad (lib/staffDesk),
 *     and a 401 or 403 from it hides the pad.
 *
 * Saving: the whole pad autosaves shortly after typing stops, and again when
 * the tab is hidden or closed. Typing that has not reached the server is also
 * kept in localStorage (lib/notepad), so a failed save survives a reload.
 * The pad reloads when it is opened and when the tab comes back into view, so
 * a tab left open does not overwrite newer notes with stale text.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useUser } from '@/lib/userContext'
import { useWideScreen } from '@/lib/viewMode'
import { useIsEmbedded } from '@/lib/jobEmbed'
import {
  NOTEPAD_MAX_CHARS,
  draftToRestore,
  notepadDraftKey,
  parseNotepadDraft,
  type NotepadDraft,
} from '@/lib/notepad'

const OPEN_KEY = 'bh_notepad_open'
const SAVE_DELAY_MS = 800
const RETRY_DELAY_MS = 5000

/** `unavailable` means this person is not allowed a pad, so nothing is drawn. */
type LoadState = 'loading' | 'ready' | 'failed' | 'unavailable'
type SaveState = 'saved' | 'saving' | 'failed'

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage is full or blocked. The pad still saves to the server.
  }
}

export default function Notepad() {
  const { userId, loading } = useUser()
  const wide = useWideScreen()
  const embedded = useIsEmbedded()
  if (loading || !userId || !wide || embedded) return null
  return <Pad key={userId} userId={userId} />
}

function Pad({ userId }: { userId: string }) {
  const draftKey = notepadDraftKey(userId)
  const [open, setOpen] = useState(() => readLocal(OPEN_KEY) === '1')
  const [load, setLoad] = useState<LoadState>('loading')
  const [text, setText] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // Kept in a ref so timers and page events always act on the latest values.
  const sync = useRef({
    text: '',
    /** updated_at of the saved pad the text sits on. */
    base: null as string | null,
    loaded: false,
    /** The text has changes the server does not have yet. */
    dirty: false,
    saving: false,
    alive: true,
    timer: null as ReturnType<typeof setTimeout> | null,
  })

  function writeDraft() {
    const s = sync.current
    const draft: NotepadDraft = { body: s.text, base: s.base }
    writeLocal(draftKey, JSON.stringify(draft))
  }

  function schedule(ms: number) {
    const s = sync.current
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => void save(), ms)
  }

  async function save(keepalive = false) {
    const s = sync.current
    if (s.timer) {
      clearTimeout(s.timer)
      s.timer = null
    }
    if (s.saving || !s.dirty) return
    s.saving = true
    const sent = s.text
    let saved = false
    try {
      const res = await fetch('/api/notepad', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: sent }),
        keepalive,
      })
      const data = await res.json()
      if (res.ok && typeof data.updated_at === 'string') {
        s.base = data.updated_at
        saved = true
      }
    } catch {
      // Offline, or signed out and sent to the login page. Treated as a failed save.
    }
    s.saving = false

    if (saved && s.text === sent) {
      s.dirty = false
      writeLocal(draftKey, null)
      setSaveState('saved')
      return
    }
    // Saved but typed more meanwhile: the draft now sits on the new version.
    if (saved) writeDraft()
    else setSaveState('failed')
    if (s.alive) schedule(saved ? SAVE_DELAY_MS : RETRY_DELAY_MS)
  }

  async function fetchPad() {
    const s = sync.current
    if (s.dirty || s.saving) return
    try {
      const res = await fetch('/api/notepad', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) {
        setLoad('unavailable')
        return
      }
      const data = await res.json()
      if (!res.ok || typeof data.body !== 'string') throw new Error('Could not load the notepad')
      // Typed while this was loading: what is on screen is newer.
      if (s.dirty || s.saving) return

      s.base = typeof data.updated_at === 'string' ? data.updated_at : null
      // Only the first load restores a draft. Later reloads could pick up one
      // that another open tab is still in the middle of saving.
      const draft = s.loaded ? null : draftToRestore(parseNotepadDraft(readLocal(draftKey)), s.base)
      s.loaded = true
      s.text = draft ?? data.body
      setText(s.text)
      setLoad('ready')
      if (draft !== null && draft !== data.body) {
        s.dirty = true
        setSaveState('saving')
        schedule(0)
      }
    } catch {
      setLoad(prev => (prev === 'loading' ? 'failed' : prev))
    }
  }

  const refresh = useEffectEvent(() => void fetchPad())
  const flush = useEffectEvent(() => void save(true))

  useEffect(() => {
    const s = sync.current
    s.alive = true
    refresh()
    const onVisibility = () => (document.visibilityState === 'visible' ? refresh() : flush())
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      s.alive = false
      flush()
    }
  }, [])

  function onType(value: string) {
    const s = sync.current
    s.text = value
    s.dirty = true
    setText(value)
    setSaveState(prev => (prev === 'failed' ? prev : 'saving'))
    writeDraft()
    schedule(SAVE_DELAY_MS)
  }

  function show() {
    setOpen(true)
    writeLocal(OPEN_KEY, '1')
    void fetchPad()
    requestAnimationFrame(() => areaRef.current?.focus())
  }

  function hide() {
    setOpen(false)
    writeLocal(OPEN_KEY, null)
  }

  if (load === 'loading' || load === 'unavailable') return null

  const full = text.length >= NOTEPAD_MAX_CHARS
  const warn = saveState === 'failed' || full
  const status =
    load !== 'ready' ? ''
    : saveState === 'failed' ? 'Not saved. Retrying…'
    : full ? 'Notepad is full'
    : saveState === 'saving' ? 'Saving…'
    : 'Saved'

  return (
    <div className="notepad">
      {open && (
        <section
          aria-label="Notepad"
          onKeyDown={e => {
            if (e.key === 'Escape') hide()
          }}
          style={{
            position: 'fixed', left: 20, bottom: 80, zIndex: 950,
            width: 340, height: 420, maxHeight: 'calc(100vh - 100px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notepad</span>
            <span role="status" style={{ flex: 1, fontSize: 12, color: warn ? 'var(--red)' : 'var(--text-muted)' }}>{status}</span>
            <button
              type="button"
              onClick={hide}
              aria-label="Close notepad"
              style={{ width: 28, height: 28, borderRadius: 6, fontSize: 14, color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </header>

          {load === 'ready' ? (
            <textarea
              ref={areaRef}
              value={text}
              onChange={e => onType(e.target.value)}
              maxLength={NOTEPAD_MAX_CHARS}
              aria-label="Notes"
              placeholder="Lists, to-dos, reminders. Only you can see this."
              style={{
                flex: 1, resize: 'none', padding: '12px 14px', fontSize: 14, lineHeight: 1.5,
                border: 'none', borderRadius: 0, background: 'transparent', boxShadow: 'none',
              }}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              <div>Could not load your notes.</div>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => void fetchPad()}>
                Try again
              </button>
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={open ? hide : show}
        aria-label={open ? 'Close notepad' : 'Open notepad'}
        aria-expanded={open}
        title="Notepad"
        style={{
          position: 'fixed', left: 20, bottom: 20, zIndex: 950,
          width: 48, height: 48, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface-3)', border: '1px solid var(--border-2)', color: 'var(--text)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      </button>
    </div>
  )
}
