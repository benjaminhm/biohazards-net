/*
 * app/knowledge-base/search/page.tsx
 *
 * Shareable search results page. Reads ?q= and ?cat= from the URL and renders
 * a Google-style ranked list of article hits. Works both as the landing
 * target for "See all results" from the command palette and as a category
 * browse page when `?cat=` is set without `?q=`.
 *
 * Search logic lives in lib/knowledgeBase/search.ts — this component only
 * handles the URL state, the category chip row, and the results layout.
 */
'use client'

import Link from 'next/link'
import { Suspense, useMemo, useState, useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ARTICLES } from '@/lib/knowledgeBase/articles'
import { CATEGORIES, getCategory } from '@/lib/knowledgeBase/categories'
import { searchArticles, type SearchResult } from '@/lib/knowledgeBase/search'
import type { CategoryId } from '@/lib/knowledgeBase/types'

export default function KnowledgeBaseSearchPage() {
  return (
    <Suspense fallback={<SearchShell q="" cat={null} onQueryChange={() => {}} onCatChange={() => {}} results={[]} />}>
      <SearchPageInner />
    </Suspense>
  )
}

function SearchPageInner() {
  const router = useRouter()
  const pathname = usePathname() ?? '/knowledge-base/search'
  const params = useSearchParams()

  const urlQ = params.get('q') ?? ''
  const urlCat = (params.get('cat') as CategoryId | null) ?? null

  const [q, setQ] = useState(urlQ)
  const [cat, setCat] = useState<CategoryId | null>(urlCat)

  // Keep local state in sync if the user navigates back/forward.
  useEffect(() => { setQ(urlQ) }, [urlQ])
  useEffect(() => { setCat(urlCat) }, [urlCat])

  const writeUrl = useCallback((nextQ: string, nextCat: CategoryId | null) => {
    const sp = new URLSearchParams()
    if (nextQ) sp.set('q', nextQ)
    if (nextCat) sp.set('cat', nextCat)
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [pathname, router])

  const onQueryChange = useCallback((next: string) => {
    setQ(next)
    writeUrl(next, cat)
  }, [cat, writeUrl])

  const onCatChange = useCallback((next: CategoryId | null) => {
    setCat(next)
    writeUrl(q, next)
  }, [q, writeUrl])

  const results = useMemo<SearchResult[]>(() => {
    if (q.trim().length >= 2) {
      return searchArticles(q, ARTICLES, { limit: 50, category: cat ?? undefined })
    }
    // No query — surface the category (or all articles) as pseudo-results so
    // the page doubles as a browse view.
    const pool = cat ? ARTICLES.filter(a => a.category === cat) : ARTICLES
    return pool.map(a => ({
      article: a,
      score: 0,
      snippet: a.summary,
      hitIn: [],
    }))
  }, [q, cat])

  return <SearchShell q={q} cat={cat} onQueryChange={onQueryChange} onCatChange={onCatChange} results={results} />
}

function SearchShell({
  q, cat, onQueryChange, onCatChange, results,
}: {
  q: string
  cat: CategoryId | null
  onQueryChange: (s: string) => void
  onCatChange: (c: CategoryId | null) => void
  results: SearchResult[]
}) {
  return (
    <div style={{ padding: '32px 32px 80px', maxWidth: 900, margin: '0 auto' }}>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          marginBottom: 16,
        }}
      >
        {q.trim() ? `Results for “${q.trim()}”` : cat ? `${getCategory(cat)?.label ?? 'Category'}` : 'All articles'}
      </h1>

      <input
        value={q}
        onChange={e => onQueryChange(e.target.value)}
        placeholder="Search biohazards, SDS, procedures…"
        style={{
          width: '100%',
          padding: '12px 14px',
          borderRadius: 10,
          fontSize: 15,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-2)',
          color: 'var(--text)',
          marginBottom: 14,
        }}
        aria-label="Search the knowledge base"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        <Chip active={cat === null} onClick={() => onCatChange(null)}>All</Chip>
        {CATEGORIES.map(c => (
          <Chip key={c.id} active={cat === c.id} onClick={() => onCatChange(cat === c.id ? null : c.id)}>
            <span aria-hidden style={{ marginRight: 6 }}>{c.icon}</span>{c.label}
          </Chip>
        ))}
      </div>

      {results.length === 0 ? (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 14,
            border: '1px dashed var(--border)',
            borderRadius: 12,
          }}
        >
          No matches{q.trim() ? ` for “${q.trim()}”` : ''}.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.map(r => {
            const c = getCategory(r.article.category)
            return (
              <li key={r.article.slug}>
                <Link
                  href={`/knowledge-base/${r.article.slug}`}
                  style={{
                    display: 'block',
                    padding: '14px 16px',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span aria-hidden style={{ fontSize: 13 }}>{c?.icon}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {c?.label ?? r.article.category}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
                    {r.article.title}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {r.snippet}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: '6px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-2)'}`,
        background: active ? 'rgba(255,107,53,0.10)' : 'var(--surface-2)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  )
}
