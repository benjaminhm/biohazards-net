'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import { seedStudies } from '../../mockCaseStudies'

function fmtDateOnly(iso: string | null) {
  if (!iso) return 'Not published'
  return new Date(iso).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export default function CaseStudyPage() {
  const { slug } = useParams() as { slug: string }
  const { org, loading, isAdmin } = useUser()
  const enabled = org?.features?.training_education === true
  const found = seedStudies.find(study => study.slug === slug) ?? null
  const canRead = !!found && (isAdmin || (found.studentVisible && found.status === 'published_students'))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: '24px 20px 40px' }}>
      <Link
        href="/training"
        style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}
      >
        ← All case studies
      </Link>

      {!loading && org && !enabled && (
        <div className="card" style={{ maxWidth: 760 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Training disabled</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Training is not enabled for your organisation.
          </div>
        </div>
      )}

      {enabled && !canRead && (
        <div className="card" style={{ maxWidth: 760 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Case study unavailable</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            This case study is not published for student access.
          </div>
        </div>
      )}

      {enabled && canRead && found && (
        <div style={{ maxWidth: 900, display: 'grid', gap: 14 }}>
          <div className="card" style={{ borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className="badge">{found.hazardType}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Published {fmtDateOnly(found.publishedAt)}</span>
            </div>
            <h1 style={{ fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.03em', marginBottom: 8 }}>{found.title}</h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 10 }}>{found.overview}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge">{found.difficulty}</span>
              <span className="badge">{found.readTimeMin} min read</span>
              <span className="badge">Read-only</span>
            </div>
          </div>

          <div className="card" style={{ borderRadius: 14, padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Case Study File</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface-2)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
                Hosted read-only page placeholder
              </div>
              <div style={{ fontSize: 14, marginBottom: 10 }}>{found.hostedFileUrl}</div>
              <a
                href={found.hostedFileUrl}
                style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
              >
                Open hosted case-study file
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

