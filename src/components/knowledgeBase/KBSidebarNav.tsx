/*
 * components/knowledgeBase/KBSidebarNav.tsx
 *
 * Left-rail navigation for the Knowledge Base. Groups articles by category,
 * collapsible per-section. The current route (pathname) is matched to a
 * slug so the active article is highlighted. Uses `<Link>` to keep SPA
 * transitions fast — article pages are statically rendered.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ARTICLES } from '@/lib/knowledgeBase/articles'
import { CATEGORIES } from '@/lib/knowledgeBase/categories'
import type { CategoryId } from '@/lib/knowledgeBase/types'

export function KBSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? ''
  const activeSlug = pathname.startsWith('/knowledge-base/') && !pathname.startsWith('/knowledge-base/search')
    ? pathname.replace('/knowledge-base/', '').replace(/\/$/, '')
    : ''

  // Default: expand the category that contains the active article; expand all
  // if we're on the landing or search page so nothing is hidden by default.
  const initialExpanded = useMemo<Record<CategoryId, boolean>>(() => {
    const activeArticle = ARTICLES.find(a => a.slug === activeSlug)
    if (activeArticle) {
      return CATEGORIES.reduce((acc, c) => {
        acc[c.id] = c.id === activeArticle.category
        return acc
      }, {} as Record<CategoryId, boolean>)
    }
    return CATEGORIES.reduce((acc, c) => { acc[c.id] = true; return acc }, {} as Record<CategoryId, boolean>)
  }, [activeSlug])

  const [expanded, setExpanded] = useState<Record<CategoryId, boolean>>(initialExpanded)

  function toggle(id: CategoryId) {
    setExpanded(s => ({ ...s, [id]: !s[id] }))
  }

  return (
    <nav aria-label="Knowledge Base sections" style={{ padding: '20px 4px 40px' }}>
      <Link
        href="/knowledge-base"
        onClick={onNavigate}
        style={{
          display: 'block',
          padding: '8px 12px',
          fontSize: 13,
          fontWeight: 700,
          color: pathname === '/knowledge-base' ? 'var(--text)' : 'var(--text-muted)',
          background: pathname === '/knowledge-base' ? 'var(--surface-2)' : 'transparent',
          borderRadius: 8,
          marginBottom: 16,
          transition: 'color 0.12s, background 0.12s',
        }}
      >
        Overview
      </Link>

      {CATEGORIES.map(cat => {
        const catArticles = ARTICLES.filter(a => a.category === cat.id)
        if (catArticles.length === 0) return null
        const isExpanded = expanded[cat.id]
        return (
          <div key={cat.id} style={{ marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => toggle(cat.id)}
              aria-expanded={isExpanded}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                borderRadius: 6,
                transition: 'color 0.12s',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>{cat.icon}</span>
                {cat.label}
              </span>
              <span aria-hidden style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {isExpanded ? '▾' : '▸'}
              </span>
            </button>
            {isExpanded && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 10px' }}>
                {catArticles.map(a => {
                  const isActive = a.slug === activeSlug
                  return (
                    <li key={a.slug}>
                      <Link
                        href={`/knowledge-base/${a.slug}`}
                        onClick={onNavigate}
                        style={{
                          display: 'block',
                          padding: '7px 12px 7px 28px',
                          fontSize: 13,
                          lineHeight: 1.35,
                          color: isActive ? 'var(--accent)' : 'var(--text)',
                          background: isActive ? 'rgba(255,107,53,0.08)' : 'transparent',
                          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                          marginLeft: 10,
                          transition: 'color 0.12s, background 0.12s',
                        }}
                      >
                        {a.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
