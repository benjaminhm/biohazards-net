'use client'

/*
 * components/UxTagger.tsx
 *
 * Admin-only floating UX/UI Feature Tagger. Mounted once in RootLayout so it
 * stays available on every staff page (and stays out of embedded iframes so
 * only the outer window renders it).
 *
 * Lets the admin tag the current screen, any job section/tab/route, or a custom
 * feature as:
 *   - Simplify (orange) : actively used — target for UX & data-entry reduction
 *   - Keep     (green)  : actively used — leave as-is
 *   - Ignore   (muted)  : archived / unused — skip in audits & refactors
 *
 * Persists to `orgs.features` (works on live Vercel & tablet) and, in local
 * dev (`NODE_ENV === 'development'`), automatically writes `docs/ux-audit-tags.json`
 * so AI coding sessions immediately see every tag directly in the repo.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import { useIsEmbedded } from '@/lib/jobEmbed'
import {
  UX_CATALOG,
  UX_CONTEXT_EVENT,
  makeFeatureTagKey,
  routeContextFromPathname,
  type UxActiveContext,
  type UxAuditManifest,
  type UxTagRecord,
  type UxTagStatus,
} from '@/lib/uxTags'

type FilterMode = 'all' | 'simplify' | 'keep' | 'ignore' | 'untagged'

const TAG_META: Record<UxTagStatus, { label: string; short: string; color: string; bg: string; border: string }> = {
  simplify: {
    label: 'Simplify',
    short: '✂️',
    color: '#F97316',
    bg: 'rgba(249, 115, 22, 0.14)',
    border: 'rgba(249, 115, 22, 0.45)',
  },
  keep: {
    label: 'Keep',
    short: '✅',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.45)',
  },
  ignore: {
    label: 'Ignore',
    short: '🚫',
    color: '#94A3B8',
    bg: 'rgba(148, 163, 184, 0.14)',
    border: 'rgba(148, 163, 184, 0.4)',
  },
}

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
}

export default function UxTagger() {
  const { isAdmin, loading } = useUser()
  const embedded = useIsEmbedded()
  if (loading || !isAdmin || embedded) return null
  return <UxTaggerPanel />
}

function UxTaggerPanel() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState<Record<string, UxTagRecord>>({})
  const [manifest, setManifest] = useState<UxAuditManifest | null>(null)
  const [canWriteRepoFile, setCanWriteRepoFile] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Live context broadcast from embedded or direct /jobs/[id] page
  const [jobContext, setJobContext] = useState<UxActiveContext | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  // Custom feature tagger
  const [showCustom, setShowCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customNote, setCustomNote] = useState('')

  // All-items filter
  const [filter, setFilter] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')

  // Reset jobContext when navigating away from job shells
  useEffect(() => {
    const isJobShell =
      pathname?.startsWith('/jobs/') ||
      pathname === '/workspace'
    if (!isJobShell) setJobContext(null)
  }, [pathname])

  // Listen for section/tab announcements from /jobs/[id] (direct or same-origin iframe)
  useEffect(() => {
    const onCtx = (e: Event) => {
      const detail = (e as CustomEvent<UxActiveContext>).detail
      if (detail?.key && detail?.label) {
        setJobContext(detail)
      }
    }
    window.addEventListener(UX_CONTEXT_EVENT, onCtx)
    return () => window.removeEventListener(UX_CONTEXT_EVENT, onCtx)
  }, [])

  const routeContext = useMemo(() => routeContextFromPathname(pathname), [pathname])
  const activeContext = jobContext ?? routeContext
  const activeRecord = tags[activeContext.key]

  useEffect(() => {
    setNoteDraft(activeRecord?.note ?? '')
  }, [activeContext.key, activeRecord?.note])

  const loadTags = useCallback(async () => {
    try {
      const res = await fetch('/api/org/ux-tags', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        tags?: Record<string, UxTagRecord>
        manifest?: UxAuditManifest
        canWriteRepoFile?: boolean
      }
      if (data.tags) setTags(data.tags)
      if (data.manifest) setManifest(data.manifest)
      setCanWriteRepoFile(Boolean(data.canWriteRepoFile))
      setLoaded(true)
    } catch {
      /* ignore */
    }
  }, [])

  // Load once on mount (for the live status dot) and refresh whenever opened
  useEffect(() => {
    void loadTags()
  }, [loadTags])

  useEffect(() => {
    if (open) void loadTags()
  }, [open, loadTags])

  async function saveTag(key: string, tag: UxTagStatus | null, note?: string) {
    setBusyKey(key)
    setError('')
    setStatusMsg('')
    try {
      const res = await fetch('/api/org/ux-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, tag, note }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        tags?: Record<string, UxTagRecord>
        manifest?: UxAuditManifest
        wroteRepoFile?: boolean
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Could not save tag')
        return
      }
      if (data.tags) setTags(data.tags)
      if (data.manifest) setManifest(data.manifest)
      setStatusMsg(
        data.wroteRepoFile
          ? 'Saved & synced to docs/ux-audit-tags.json'
          : 'Saved to org (sync to code anytime)',
      )
    } catch {
      setError('Network error while saving tag')
    } finally {
      setBusyKey(null)
    }
  }

  async function syncNow() {
    setBusyKey('__sync__')
    setError('')
    try {
      const res = await fetch('/api/org/ux-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncOnly: true }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        tags?: Record<string, UxTagRecord>
        manifest?: UxAuditManifest
        wroteRepoFile?: boolean
      }
      if (data.tags) setTags(data.tags)
      if (data.manifest) setManifest(data.manifest)
      setStatusMsg(
        data.wroteRepoFile
          ? 'Synced to docs/ux-audit-tags.json'
          : 'Manifest refreshed — copy JSON below',
      )
    } finally {
      setBusyKey(null)
    }
  }

  async function copyManifestJson() {
    if (!manifest) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  async function handleAddCustom(tag: UxTagStatus) {
    const key = makeFeatureTagKey(customName)
    if (!key) {
      setError('Type a feature name first (e.g. "BCQ room pricing")')
      return
    }
    const prefixedNote = customNote.trim()
      ? `[${activeContext.label}] ${customNote.trim()}`
      : `Tagged from ${activeContext.label}`
    await saveTag(key, tag, prefixedNote)
    setCustomName('')
    setCustomNote('')
    setShowCustom(false)
  }

  const allItems = useMemo(() => {
    const seen = new Set(UX_CATALOG.map(c => c.key))
    const customItems = Object.keys(tags)
      .filter(k => !seen.has(k))
      .map(key => ({
        key,
        group: 'feature' as const,
        label: key.startsWith('feature:') ? key.slice('feature:'.length).replace(/-/g, ' ') : key,
      }))
    return [
      ...UX_CATALOG.map(c => ({ key: c.key, group: c.group, label: c.label })),
      ...customItems,
    ]
  }, [tags])

  const counts = useMemo(() => {
    let simplify = 0
    let keep = 0
    let ignore = 0
    let untagged = 0
    for (const item of allItems) {
      const rec = tags[item.key]
      if (!rec) untagged++
      else if (rec.tag === 'simplify') simplify++
      else if (rec.tag === 'keep') keep++
      else ignore++
    }
    return { all: allItems.length, simplify, keep, ignore, untagged }
  }, [allItems, tags])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allItems.filter(item => {
      const rec = tags[item.key]
      if (filter === 'untagged' && rec) return false
      if (filter !== 'all' && filter !== 'untagged' && rec?.tag !== filter) return false
      if (!q) return true
      return (
        item.label.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        (rec?.note ?? '').toLowerCase().includes(q)
      )
    })
  }, [allItems, tags, filter, search])

  const dotColor = activeRecord ? TAG_META[activeRecord.tag].color : '#64748B'

  return (
    <>
      {/* Floating admin trigger pill (bottom-right, opposite Notepad) */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`UX Feature Tagger — current: ${activeContext.label}${activeRecord ? ` (${activeRecord.tag})` : ''}`}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 99980,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 12px',
          borderRadius: 999,
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.28)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span>🏷️ Tag UI</span>
        {loaded && counts.simplify > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 999,
              background: TAG_META.simplify.bg,
              color: TAG_META.simplify.color,
            }}
          >
            {counts.simplify}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="UX Feature Tagger"
          style={{
            position: 'fixed',
            bottom: 58,
            right: 16,
            zIndex: 99985,
            width: 'min(410px, calc(100vw - 24px))',
            maxHeight: 'min(78vh, 680px)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.42)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                🏷️ UX Feature Tagger
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Mark what to simplify, keep, or ignore in code
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close UX Tagger"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 18,
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >
              ✕
            </button>
          </div>

          {/* Current screen quick-tagger */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Current screen
              </span>
              <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{activeContext.key}</code>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              {activeContext.label}
              {activeRecord?.source === 'menu_archived' && (
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#94A3B8', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>
                  archived in menu
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['simplify', 'keep', 'ignore'] as UxTagStatus[]).map(status => {
                const meta = TAG_META[status]
                const selected = activeRecord?.tag === status
                return (
                  <button
                    key={status}
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() =>
                      void saveTag(
                        activeContext.key,
                        selected && activeRecord?.source !== 'menu_archived' ? null : status,
                        noteDraft,
                      )
                    }
                    style={{
                      flex: 1,
                      padding: '7px 8px',
                      borderRadius: 8,
                      border: `1px solid ${selected ? meta.border : 'var(--border)'}`,
                      background: selected ? meta.bg : 'var(--bg)',
                      color: selected ? meta.color : 'var(--text)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {meta.short} {meta.label}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && activeRecord) {
                    void saveTag(activeContext.key, activeRecord.tag, noteDraft)
                  }
                }}
                placeholder="Optional note (e.g. too many fields, merge with BCQ…)"
                style={INPUT_STYLE}
              />
              {activeRecord && noteDraft.trim() !== (activeRecord.note ?? '') && (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void saveTag(activeContext.key, activeRecord.tag, noteDraft)}
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: '6px 10px', flexShrink: 0 }}
                >
                  Save
                </button>
              )}
            </div>

            {/* Custom feature tagger toggle */}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setShowCustom(s => !s)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--accent)',
                  cursor: 'pointer',
                }}
              >
                {showCustom ? '− Hide custom feature tag' : '+ Tag a specific feature on this screen'}
              </button>
              {showCustom && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', display: 'grid', gap: 6 }}>
                  <input
                    type="text"
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    placeholder="Feature name (e.g. BCQ room pricing, SMS modal)"
                    style={INPUT_STYLE}
                  />
                  <input
                    type="text"
                    value={customNote}
                    onChange={e => setCustomNote(e.target.value)}
                    placeholder="What should change or be ignored?"
                    style={INPUT_STYLE}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['simplify', 'keep', 'ignore'] as UxTagStatus[]).map(status => {
                      const meta = TAG_META[status]
                      return (
                        <button
                          key={status}
                          type="button"
                          disabled={busyKey !== null || !customName.trim()}
                          onClick={() => void handleAddCustom(status)}
                          style={{
                            flex: 1,
                            padding: '6px 6px',
                            borderRadius: 6,
                            border: `1px solid ${meta.border}`,
                            background: meta.bg,
                            color: meta.color,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {meta.short} {meta.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* All pages / sections / tabs quick-tag list */}
          <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {(
                [
                  ['all', `All (${counts.all})`],
                  ['simplify', `✂️ ${counts.simplify}`],
                  ['keep', `✅ ${counts.keep}`],
                  ['ignore', `🚫 ${counts.ignore}`],
                  ['untagged', `Untagged (${counts.untagged})`],
                ] as [FilterMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFilter(mode)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 999,
                    border: `1px solid ${filter === mode ? 'var(--accent)' : 'var(--border)'}`,
                    background: filter === mode ? 'var(--accent-dim)' : 'var(--bg)',
                    color: filter === mode ? 'var(--accent)' : 'var(--text-muted)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter sections, tabs, pages…"
              style={INPUT_STYLE}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
            {filteredItems.map(item => {
              const rec = tags[item.key]
              const isCurrent = item.key === activeContext.key
              return (
                <div
                  key={item.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 6px',
                    borderRadius: 8,
                    background: isCurrent ? 'var(--accent-dim)' : 'transparent',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                      {rec?.source === 'menu_archived' && (
                        <span style={{ marginLeft: 5, fontSize: 9, color: '#94A3B8', fontWeight: 700 }}>
                          ARCHIVED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec?.note ? rec.note : item.key}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    {(['simplify', 'keep', 'ignore'] as UxTagStatus[]).map(status => {
                      const meta = TAG_META[status]
                      const selected = rec?.tag === status
                      return (
                        <button
                          key={status}
                          type="button"
                          title={meta.label}
                          disabled={busyKey === item.key}
                          onClick={() =>
                            void saveTag(
                              item.key,
                              selected && rec?.source !== 'menu_archived' ? null : status,
                              rec?.note,
                            )
                          }
                          style={{
                            width: 26,
                            height: 24,
                            borderRadius: 6,
                            border: `1px solid ${selected ? meta.border : 'var(--border)'}`,
                            background: selected ? meta.bg : 'var(--bg)',
                            color: selected ? meta.color : 'var(--text-muted)',
                            fontSize: 11,
                            cursor: 'pointer',
                            opacity: selected ? 1 : 0.6,
                          }}
                        >
                          {meta.short}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {filteredItems.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                No matching items.
              </div>
            )}
          </div>

          {/* Footer status + repo sync / copy */}
          <div
            style={{
              padding: '9px 14px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 11, color: error ? '#F87171' : 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {error || statusMsg || (canWriteRepoFile ? 'Auto-writes docs/ux-audit-tags.json' : 'Saved to org · sync via npm run ux-tags:sync')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {canWriteRepoFile && (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void syncNow()}
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                >
                  Sync file
                </button>
              )}
              <button
                type="button"
                disabled={!manifest}
                onClick={() => void copyManifestJson()}
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                {copied ? '✓ Copied' : 'Copy JSON'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
