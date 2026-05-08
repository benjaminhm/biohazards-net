/*
 * components/knowledgeBase/KBTOC.tsx
 *
 * Right-side table of contents for article pages. Builds itself from the
 * article's h2 (and indented h3) blocks. Uses IntersectionObserver to
 * highlight the section currently in view — no scroll listeners.
 *
 * Hidden on narrow viewports; see `display` rules in KBShell's grid.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Block } from '@/lib/knowledgeBase/types'

interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

export function KBTOC({ blocks }: { blocks: Block[] }) {
  const items = useMemo<TocItem[]>(() => {
    const out: TocItem[] = []
    for (const b of blocks) {
      if (b.type === 'h2') out.push({ id: b.id, text: b.text, level: 2 })
      else if (b.type === 'h3') out.push({ id: b.id, text: b.text, level: 3 })
    }
    return out
  }, [blocks])

  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (items.length === 0) return
    const ids = items.map(i => i.id)
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-88px 0px -60% 0px', threshold: 0 }
    )
    ids.forEach(id => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [items])

  if (items.length === 0) return null

  return (
    <aside
      aria-label="Table of contents"
      style={{
        position: 'sticky',
        top: 88,
        alignSelf: 'start',
        maxHeight: 'calc(100vh - 110px)',
        overflowY: 'auto',
        padding: '4px 0 24px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        On this page
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map(item => {
          const isActive = item.id === activeId
          return (
            <li key={item.id} style={{ marginBottom: 2 }}>
              <a
                href={`#${item.id}`}
                style={{
                  display: 'block',
                  padding: '5px 0 5px ' + (item.level === 3 ? '14px' : '0'),
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  paddingLeft: item.level === 3 ? 20 : 10,
                  marginLeft: item.level === 3 ? 4 : 0,
                  transition: 'color 0.12s, border-color 0.12s',
                }}
              >
                {item.text}
              </a>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
