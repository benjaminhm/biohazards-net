/*
 * app/knowledge-base/[slug]/page.tsx
 *
 * Individual article reader. Server component — renders the article's
 * Block[] through <KBArticleRenderer>, with the right-side TOC as the only
 * client component on the page.
 *
 * generateStaticParams returns every article slug so the entire catalogue is
 * statically generated at build time. When v2 adds org-authored content we
 * can mix in dynamic rendering for the org layer without touching this file.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ARTICLES, getArticle, getRelated } from '@/lib/knowledgeBase/articles'
import { getCategory } from '@/lib/knowledgeBase/categories'
import { KBArticleRenderer } from '@/components/knowledgeBase/KBArticleRenderer'
import { KBTOC } from '@/components/knowledgeBase/KBTOC'
import { KBSourceBadge } from '@/components/knowledgeBase/KBSourceBadge'

export function generateStaticParams() {
  return ARTICLES.map(a => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) return { title: 'Not found — Knowledge Base' }
  return {
    title: `${article.title} — Knowledge Base`,
    description: article.summary,
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) notFound()

  const category = getCategory(article.category)
  const related = getRelated(article)
  const updated = new Date(article.lastUpdated).toLocaleDateString('en-AU', {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  return (
    <div
      className="kb-article-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 220px',
        gap: 48,
        padding: '40px 32px 80px',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <article>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          <Link href="/knowledge-base" style={{ color: 'var(--text-muted)' }}>Knowledge Base</Link>
          <span aria-hidden style={{ color: 'var(--text-dim)' }}>/</span>
          <Link href={`/knowledge-base/search?cat=${article.category}`} style={{ color: 'var(--text-muted)' }}>
            {category?.label ?? article.category}
          </Link>
        </div>

        {/* Header */}
        <header style={{ marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              color: 'var(--text)',
              margin: '0 0 12px',
            }}
          >
            {article.title}
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 720 }}>
            {article.summary}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <KBSourceBadge source={article.source} />
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Updated {updated}</span>
          </div>
        </header>

        {/* Body */}
        <KBArticleRenderer blocks={article.blocks} />

        {/* Related */}
        {related.length > 0 ? (
          <section
            style={{
              marginTop: 56,
              paddingTop: 28,
              borderTop: '1px solid var(--border)',
              maxWidth: 720,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              Related
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {related.map(r => {
                const rc = getCategory(r.category)
                return (
                  <Link
                    key={r.slug}
                    href={`/knowledge-base/${r.slug}`}
                    style={{
                      display: 'block',
                      padding: '10px 14px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--surface)',
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
                      {rc?.icon} {rc?.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{r.title}</div>
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}
      </article>

      <KBTOC blocks={article.blocks} />

      <style>{`
        @media (max-width: 1100px) {
          .kb-article-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .kb-article-grid > aside { display: none !important; }
        }
      `}</style>
    </div>
  )
}
