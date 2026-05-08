/*
 * components/knowledgeBase/KBSearchModal.tsx
 *
 * Stripe Docs-style command-palette search. Opens on Cmd/Ctrl+K (or via the
 * topbar button), shows typeahead results as the user types, navigates to
 * the selected article on Enter or click.
 *
 * Keyboard model:
 *   Esc       close
 *   ↑ / ↓     move selection
 *   Enter     open selected
 *   Tab-like: focus stays in the input; the results list is a live
 *             aria-controlled listbox rather than a focus-trap tree.
 */
'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ARTICLES } from '@/lib/knowledgeBase/articles'
import { getCategory } from '@/lib/knowledgeBase/categories'
import { searchArticles, type SearchResult } from '@/lib/knowledgeBase/search'

interface Props {
  open: boolean
  onClose: () => void
}

const MAX_RESULTS = 8

export function KBSearchModal({ open, onClose }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)

  const results = useMemo<SearchResult[]>(
    () => (query.trim().length < 2 ? [] : searchArticles(query, ARTICLES, { limit: MAX_RESULTS })),
    [query]
  )

  // Reset selection when the query changes — React 19 "derive during render"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes).
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setSelectedIdx(0)
  }

  // Clear the input when the modal closes, same render-phase pattern.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(i => (results.length === 0 ? 0 : (i + 1) % results.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(i => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
      } else if (e.key === 'Enter') {
        const r = results[selectedIdx]
        if (r) {
          e.preventDefault()
          onClose()
          router.push(`/knowledge-base/${r.article.slug}`)
        } else if (query.trim().length >= 2) {
          e.preventDefault()
          onClose()
          router.push(`/knowledge-base/search?q=${encodeURIComponent(query.trim())}`)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, results, selectedIdx, router, query])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search the knowledge base"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, calc(100% - 32px))',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span aria-hidden style={{ fontSize: 16, color: 'var(--text-muted)' }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search biohazards, SDS, procedures…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: '8px 2px',
              color: 'var(--text)',
              fontSize: 15,
            }}
            aria-label="Search the knowledge base"
            aria-autocomplete="list"
            aria-controls="kb-search-results"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
              padding: '4px 8px',
              border: '1px solid var(--border-2)',
              borderRadius: 6,
              background: 'var(--surface-2)',
            }}
          >
            Esc
          </button>
        </div>

        <div id="kb-search-results" role="listbox" style={{ maxHeight: '56vh', overflowY: 'auto' }}>
          {query.trim().length < 2 ? (
            <EmptyHint />
          ) : results.length === 0 ? (
            <div style={{ padding: '28px 18px', color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
              No matches for “{query}”.
            </div>
          ) : (
            results.map((r, idx) => {
              const isSel = idx === selectedIdx
              const cat = getCategory(r.article.category)
              return (
                <button
                  key={r.article.slug}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => { onClose(); router.push(`/knowledge-base/${r.article.slug}`) }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: isSel ? 'var(--surface-2)' : 'transparent',
                    transition: 'background 0.08s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span aria-hidden style={{ fontSize: 13 }}>{cat?.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      {cat?.label ?? r.article.category}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>
                    {r.article.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {r.snippet}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {query.trim().length >= 2 && results.length > 0 ? (
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-2)',
              fontSize: 12,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>
              <kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navigate · <kbd style={kbdStyle}>↵</kbd> open · <kbd style={kbdStyle}>Esc</kbd> close
            </span>
            <button
              type="button"
              onClick={() => { onClose(); router.push(`/knowledge-base/search?q=${encodeURIComponent(query.trim())}`) }}
              style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}
            >
              See all results →
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  fontSize: 11,
  padding: '1px 6px',
  border: '1px solid var(--border-2)',
  background: 'var(--surface)',
  color: 'var(--text)',
  borderRadius: 4,
}

function EmptyHint() {
  const popular = ARTICLES.filter(a => a.featured).slice(0, 4)
  return (
    <div style={{ padding: '16px 16px 20px' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
        Popular
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {popular.map(a => (
          <a
            key={a.slug}
            href={`/knowledge-base/${a.slug}`}
            style={{ fontSize: 13, color: 'var(--text)', padding: '6px 8px', borderRadius: 6 }}
          >
            {a.title}
          </a>
        ))}
      </div>
    </div>
  )
}
