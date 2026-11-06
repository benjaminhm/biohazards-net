'use client'

/*
 * components/workspace/JobPanel.tsx
 *
 * Right panel: the full Classic job page for the open job, in a same-origin
 * iframe, so every tab and /jobs/<id>/docs/<type> work unchanged. The
 * workspace's pending drafts and pinned flags sit in a strip above it so
 * approvals still happen here.
 *
 * The workspace bumps `version` after each agent turn and approval; the panel
 * then asks the embedded page to refresh quietly (lib/jobEmbed), falling back
 * to a reload. Saves inside the page come back as onEmbedChanged. Width is
 * draggable and remembered in localStorage.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Job } from '@/lib/types'
import { JOB_EMBED_MSG } from '@/lib/jobEmbed'
import DraftList, { type DraftView } from './DraftList'
import JobFlags from './JobFlags'

const WIDTH_KEY = 'bh.workspace.jobPanelWidth'
const DEFAULT_WIDTH = 640
const MIN_WIDTH = 380
/** Job list (260) plus a usable chat column. */
const RESERVED_LEFT = 260 + 340

function maxWidth() {
  return Math.max(MIN_WIDTH, window.innerWidth - RESERVED_LEFT)
}

function clampWidth(w: number) {
  return Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()))
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const stored = Number(window.localStorage.getItem(WIDTH_KEY))
  return clampWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH)
}

export default function JobPanel({
  job,
  drafts,
  version,
  onDraftsDecided,
  onEmbedChanged,
}: {
  job: Job
  drafts: DraftView[]
  version: number
  onDraftsDecided: () => void
  onEmbedChanged: () => void
}) {
  const base = `/jobs/${job.id}`
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadedRef = useRef(false)
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [strayed, setStrayed] = useState(false)
  const [framePath, setFramePath] = useState(base)
  const [width, setWidth] = useState(readStoredWidth)
  const [restoreWidth, setRestoreWidth] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [stripOpen, setStripOpen] = useState(true)

  const pending = drafts.filter(d => d.status === 'pending')
  const onChangedRef = useRef(onEmbedChanged)
  useEffect(() => {
    onChangedRef.current = onEmbedChanged
  })

  const saveWidth = useCallback((w: number) => {
    const next = clampWidth(w)
    setWidth(next)
    window.localStorage.setItem(WIDTH_KEY, String(next))
  }, [])

  useEffect(() => {
    const onResize = () => setWidth(w => clampWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const readFramePath = useCallback((): string | null => {
    try {
      const loc = iframeRef.current?.contentWindow?.location
      return loc ? `${loc.pathname}${loc.search}` : null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!loadedRef.current) return
      const path = readFramePath()
      const pathname = path?.split('?')[0] ?? ''
      setStrayed(!(pathname === base || pathname.startsWith(`${base}/`)))
      if (path) setFramePath(path)
    }, 1000)
    return () => clearInterval(timer)
  }, [base, readFramePath])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === JOB_EMBED_MSG.refreshAck) {
        if (ackTimer.current) clearTimeout(ackTimer.current)
        ackTimer.current = null
      } else if (e.data?.type === JOB_EMBED_MSG.changed) {
        onChangedRef.current()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    loadedRef.current = false
  }, [job.id])

  useEffect(() => {
    const win = iframeRef.current?.contentWindow
    if (!loadedRef.current || !win) return
    win.postMessage({ type: JOB_EMBED_MSG.refresh }, window.location.origin)
    if (ackTimer.current) clearTimeout(ackTimer.current)
    ackTimer.current = setTimeout(() => {
      ackTimer.current = null
      // Reload only the main job page; a composed document's URL can't be reloaded.
      if (readFramePath()?.split('?')[0] === base) {
        try { win.location.reload() } catch { /* navigated away */ }
      }
    }, 2500)
  }, [version, base, readFramePath])

  useEffect(() => () => {
    if (ackTimer.current) clearTimeout(ackTimer.current)
  }, [])

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setDragging(true)
    setRestoreWidth(null)
    const move = (ev: PointerEvent) => setWidth(clampWidth(startW + (startX - ev.clientX)))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
      saveWidth(startW + (startX - ev.clientX))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const wide = restoreWidth !== null
  function toggleWide() {
    if (wide) {
      saveWidth(restoreWidth)
      setRestoreWidth(null)
    } else {
      setRestoreWidth(width)
      saveWidth(maxWidth())
    }
  }

  function backToJob() {
    loadedRef.current = false
    setStrayed(false)
    setFramePath(base)
    setFrameKey(k => k + 1)
  }

  const btn: React.CSSProperties = {
    padding: '4px 9px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', width, borderLeft: '1px solid var(--border)' }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize job panel"
        title="Drag to resize"
        onPointerDown={startDrag}
        onDoubleClick={() => { setRestoreWidth(null); saveWidth(DEFAULT_WIDTH) }}
        style={{
          position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 5,
          background: dragging ? 'var(--accent-dim)' : 'transparent',
        }}
      />

      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>
            {job.job_code ? `#${job.job_code}` : ''}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.client_name || 'Unnamed'}
          </span>
          <button
            type="button"
            onClick={() => setStripOpen(o => !o)}
            aria-expanded={stripOpen}
            style={{ ...btn, color: pending.length ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            {pending.length ? `${pending.length} waiting` : 'Flags'} {stripOpen ? '▴' : '▾'}
          </button>
          <button type="button" onClick={toggleWide} aria-pressed={wide} style={btn} title="Widen the job panel">
            {wide ? 'Narrow' : 'Wide'}
          </button>
          <a href={strayed ? base : framePath} target="_blank" rel="noopener" style={{ ...btn, textDecoration: 'none' }} title="Open this job full-page in Classic view">
            Open in Classic ↗
          </a>
        </div>
        {stripOpen && (
          <div style={{ maxHeight: '35vh', overflowY: 'auto', marginTop: 8, display: 'grid', gap: 8 }}>
            <JobFlags jobId={job.id} reloadKey={version} compact />
            {pending.length > 0 && <DraftList drafts={pending} onDecided={onDraftsDecided} />}
          </div>
        )}
      </div>

      {strayed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)', fontSize: 13 }}>
          <span style={{ flex: 1 }}>This panel has left the job file.</span>
          <button type="button" onClick={backToJob} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }}>
            Back to job
          </button>
        </div>
      )}

      <iframe
        key={`${job.id}:${frameKey}`}
        ref={iframeRef}
        src={base}
        title={`Job file ${job.job_code ?? job.client_name ?? ''}`}
        onLoad={() => { loadedRef.current = true }}
        style={{ flex: 1, minHeight: 0, width: '100%', border: 'none', background: 'var(--bg)', pointerEvents: dragging ? 'none' : 'auto' }}
      />
    </div>
  )
}
