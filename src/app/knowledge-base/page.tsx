/*
 * app/knowledge-base/page.tsx
 *
 * Landing page — greeting, category tiles, featured articles. The shell
 * (layout.tsx) handles the topbar, sidebar, search modal, and feature-flag
 * gate, so this page is pure content.
 *
 * Server component: all content is static and known at build time.
 */
import Link from 'next/link'
import { ARTICLES, getFeaturedArticles } from '@/lib/knowledgeBase/articles'
import { CATEGORIES, getCategory } from '@/lib/knowledgeBase/categories'

export default function KnowledgeBaseLanding() {
  const featured = getFeaturedArticles(4)

  return (
    <div style={{ padding: '40px 32px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <section style={{ marginBottom: 40 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 8,
          }}
        >
          Reference library
        </div>
        <h1
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: '-0.035em',
            marginBottom: 12,
            lineHeight: 1.1,
          }}
        >
          Everything you need on the way to a job.
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 620, margin: 0 }}>
          Biohazards, SDS quick-reference, PPE selection, and the core procedures. Search any time with{' '}
          <kbd
            style={{
              fontFamily: "'SF Mono', monospace",
              fontSize: 12,
              padding: '1px 7px',
              border: '1px solid var(--border-2)',
              background: 'var(--surface-2)',
              borderRadius: 4,
              color: 'var(--text)',
            }}
          >
            ⌘K
          </kbd>
          .
        </p>
      </section>

      <section style={{ marginBottom: 48 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 14,
          }}
        >
          Browse by category
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 14,
          }}
        >
          {CATEGORIES.map(cat => {
            const count = ARTICLES.filter(a => a.category === cat.id).length
            return (
              <Link
                key={cat.id}
                href={`/knowledge-base/search?cat=${cat.id}`}
                style={{
                  display: 'block',
                  padding: '18px 18px 16px',
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s, transform 0.12s',
                }}
              >
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: cat.accent,
                    opacity: 0.8,
                  }}
                />
                <div style={{ fontSize: 24, marginBottom: 8 }}>{cat.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: 'var(--text)' }}>
                  {cat.label}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0, marginBottom: 10 }}>
                  {cat.description}
                </p>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                  {count} article{count === 1 ? '' : 's'}
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      {featured.length > 0 ? (
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 14,
            }}
          >
            Featured
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {featured.map(a => {
              const cat = getCategory(a.category)
              return (
                <Link
                  key={a.slug}
                  href={`/knowledge-base/${a.slug}`}
                  style={{
                    display: 'block',
                    padding: '14px 16px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span aria-hidden style={{ fontSize: 13 }}>{cat?.icon}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {cat?.label ?? a.category}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: 'var(--text)' }}>
                    {a.title}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {a.summary}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
