/*
 * components/knowledgeBase/KBShell.tsx
 *
 * Persistent chrome for every Knowledge Base page. Owns:
 *   - Top bar: back link, title, search trigger with Cmd+K hint
 *   - Left sidebar navigation (collapsible on mobile — hamburger toggles a drawer)
 *   - Search modal state (Cmd/Ctrl+K opens, Esc closes)
 *   - Feature-flag gate: if `orgs.features.training_education` is off for the
 *     current org, every KB page renders a gate message instead of content,
 *     matching the Consultation / Inventory pattern.
 *
 * Pages underneath are server components rendering static content. This shell
 * is the only client component needed at the top of the tree.
 */
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useUser } from '@/lib/userContext'
import { KBSidebarNav } from './KBSidebarNav'
import { KBSearchModal } from './KBSearchModal'

const SIDEBAR_WIDTH = 264
const TOPBAR_HEIGHT = 56

export function KBShell({ children }: { children: ReactNode }) {
  const { org, loading } = useUser()
  const enabled = org?.features?.training_education === true

  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      const isSlash = e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)
      if (isModShortcut || isSlash) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }

  if (org && !enabled) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: '24px 20px 40px' }}>
        <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'inline-block', marginBottom: 20 }}>
          ← Dashboard
        </Link>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 }}>Knowledge Base</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          Knowledge Base is not enabled for your organisation. Contact your platform administrator if you need access.
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Top bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          height: TOPBAR_HEIGHT,
          background: 'rgba(8,8,8,0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
        }}
      >
        <button
          type="button"
          className="kb-mobile-only"
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(o => !o)}
          style={{
            padding: '6px 10px',
            border: '1px solid var(--border-2)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            fontSize: 14,
          }}
        >
          ☰
        </button>
        <Link
          href="/"
          aria-label="Back to dashboard"
          style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
        >
          ← Dashboard
        </Link>
        <Link
          href="/knowledge-base"
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--text)',
            marginLeft: 4,
            paddingLeft: 12,
            borderLeft: '1px solid var(--border-2)',
            whiteSpace: 'nowrap',
          }}
        >
          Knowledge Base
        </Link>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={openSearch}
          aria-label="Search the knowledge base"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 10px 6px 12px',
            minWidth: 240,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 8,
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          <span aria-hidden>🔍</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
          <kbd
            style={{
              fontFamily: "'SF Mono', monospace",
              fontSize: 11,
              padding: '1px 6px',
              border: '1px solid var(--border-2)',
              background: 'var(--surface)',
              color: 'var(--text-muted)',
              borderRadius: 4,
            }}
          >
            ⌘K
          </kbd>
        </button>
      </header>

      {/* Body grid: sidebar | main */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${SIDEBAR_WIDTH}px 1fr`,
          alignItems: 'start',
          minHeight: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
        }}
        className="kb-body-grid"
      >
        <aside
          aria-label="Knowledge Base navigation"
          className="kb-sidebar"
          style={{
            position: 'sticky',
            top: TOPBAR_HEIGHT,
            maxHeight: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
            overflowY: 'auto',
            borderRight: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <KBSidebarNav />
        </aside>

        <main style={{ minWidth: 0 }}>
          {children}
        </main>
      </div>

      {/* Mobile nav drawer */}
      {mobileNavOpen ? (
        <div
          role="dialog"
          aria-label="Knowledge Base navigation"
          onClick={() => setMobileNavOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 30,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(300px, 85vw)',
              height: '100%',
              background: 'var(--bg)',
              borderRight: '1px solid var(--border)',
              overflowY: 'auto',
            }}
          >
            <KBSidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <KBSearchModal open={searchOpen} onClose={closeSearch} />

      {/* Scoped responsive rules — inline styles can't do media queries. */}
      <style>{`
        .kb-mobile-only { display: none; }
        @media (max-width: 900px) {
          .kb-mobile-only { display: inline-flex; }
          .kb-body-grid { grid-template-columns: 1fr !important; }
          .kb-sidebar { display: none !important; }
        }
      `}</style>
    </div>
  )
}
