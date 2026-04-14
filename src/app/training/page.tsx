/*
 * app/training/page.tsx
 *
 * Training & education area — shell for future modules (orgs.features.training_education).
 */
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useUser } from '@/lib/userContext'
import { seedStudies, type CaseStudy, type StudyStatus } from './mockCaseStudies'

type StudentStatus = 'invited' | 'active' | 'suspended'
interface StudentInvite {
  id: string
  name: string
  email: string
  cohort: string
  status: StudentStatus
}

type ViewMode = 'catalog' | 'manage_overview' | 'manage_students' | 'manage_case_studies' | 'manage_preview'

const seedStudents: StudentInvite[] = [
  { id: 's1', name: 'Alex Chen', email: 'alex@example.com', cohort: 'YT Apr 2026', status: 'invited' },
  { id: 's2', name: 'Riley Jones', email: 'riley@example.com', cohort: 'YT Apr 2026', status: 'active' },
  { id: 's3', name: 'Jordan Lee', email: 'jordan@example.com', cohort: 'YT Mar 2026', status: 'suspended' },
]

const STATUS_LABELS: Record<StudyStatus, string> = {
  draft: 'Draft',
  authorized_admin_only: 'HITL Authorized (Admin Only)',
  published_students: 'Published to Students',
}

function fmtIso(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TrainingPage() {
  const { org, loading, isAdmin } = useUser()
  const enabled = org?.features?.training_education === true
  const [viewMode, setViewMode] = useState<ViewMode>('catalog')
  const [studentPreviewMode, setStudentPreviewMode] = useState(false)
  const [students] = useState<StudentInvite[]>(seedStudents)
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>(seedStudies)
  const [selectedPreviewId, setSelectedPreviewId] = useState<string>(seedStudies[0]?.id ?? '')

  const publishedStudies = useMemo(
    () => caseStudies.filter(study => study.studentVisible && study.status === 'published_students'),
    [caseStudies],
  )
  const selectedPreview = caseStudies.find(study => study.id === selectedPreviewId) ?? caseStudies[0] ?? null

  function authorizeStudy(studyId: string) {
    setCaseStudies(prev =>
      prev.map(study => {
        if (study.id !== studyId || study.status !== 'draft') return study
        return {
          ...study,
          status: 'authorized_admin_only',
          authorisedBy: 'Current Admin',
          authorisedAt: new Date().toISOString(),
          studentVisible: false,
          publishedAt: null,
        }
      }),
    )
  }

  function publishStudy(studyId: string) {
    setCaseStudies(prev =>
      prev.map(study => {
        if (study.id !== studyId || study.status !== 'authorized_admin_only') return study
        return {
          ...study,
          status: 'published_students',
          studentVisible: true,
          publishedAt: new Date().toISOString(),
        }
      }),
    )
  }

  function unpublishStudy(studyId: string) {
    setCaseStudies(prev =>
      prev.map(study => {
        if (study.id !== studyId || study.status !== 'published_students') return study
        return {
          ...study,
          status: 'authorized_admin_only',
          studentVisible: false,
          publishedAt: null,
        }
      }),
    )
  }

  const counts = useMemo(
    () => ({
      draft: caseStudies.filter(study => study.status === 'draft').length,
      authorized: caseStudies.filter(study => study.status === 'authorized_admin_only').length,
      published: caseStudies.filter(study => study.status === 'published_students').length,
    }),
    [caseStudies],
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: '24px 20px 40px' }}>
      <Link
        href="/"
        style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}
      >
        ← Dashboard
      </Link>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>
        Training Room
      </h1>

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        {isAdmin && !studentPreviewMode ? 'Administrator View' : 'Student View (Read-only)'}
      </div>

      {!loading && org && !enabled ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 520 }}>
          Training is not enabled for your organisation. Contact your platform administrator if you need access.
        </p>
      ) : (
        <>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {!studentPreviewMode ? (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 13 }}
                  onClick={() => {
                    setStudentPreviewMode(true)
                    setViewMode('catalog')
                  }}
                >
                  Student Screen Preview
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => {
                    setStudentPreviewMode(false)
                    setViewMode('manage_overview')
                  }}
                >
                  Exit Student Preview
                </button>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <button
              onClick={() => setViewMode('catalog')}
              className="btn btn-ghost"
              style={{
                fontSize: 13,
                borderColor: viewMode === 'catalog' ? 'var(--accent)' : undefined,
                color: viewMode === 'catalog' ? 'var(--accent)' : undefined,
              }}
            >
              Catalog (Student Read-only)
            </button>
            {isAdmin && !studentPreviewMode && (
              <>
                <button
                  onClick={() => setViewMode('manage_overview')}
                  className="btn btn-ghost"
                  style={{
                    fontSize: 13,
                    borderColor: viewMode === 'manage_overview' ? 'var(--accent)' : undefined,
                    color: viewMode === 'manage_overview' ? 'var(--accent)' : undefined,
                  }}
                >
                  Manage · Overview
                </button>
                <button
                  onClick={() => setViewMode('manage_students')}
                  className="btn btn-ghost"
                  style={{
                    fontSize: 13,
                    borderColor: viewMode === 'manage_students' ? 'var(--accent)' : undefined,
                    color: viewMode === 'manage_students' ? 'var(--accent)' : undefined,
                  }}
                >
                  Manage · Students
                </button>
                <button
                  onClick={() => setViewMode('manage_case_studies')}
                  className="btn btn-ghost"
                  style={{
                    fontSize: 13,
                    borderColor: viewMode === 'manage_case_studies' ? 'var(--accent)' : undefined,
                    color: viewMode === 'manage_case_studies' ? 'var(--accent)' : undefined,
                  }}
                >
                  Manage · Case Studies
                </button>
                <button
                  onClick={() => setViewMode('manage_preview')}
                  className="btn btn-ghost"
                  style={{
                    fontSize: 13,
                    borderColor: viewMode === 'manage_preview' ? 'var(--accent)' : undefined,
                    color: viewMode === 'manage_preview' ? 'var(--accent)' : undefined,
                  }}
                >
                  Manage · Portal Preview
                </button>
              </>
            )}
          </div>

          {viewMode === 'catalog' && (
            <div style={{ maxWidth: 1200 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Student Portal</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Read-only published case studies for student learning.
              </div>
              {publishedStudies.length === 0 ? (
                <div
                  className="card"
                  style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '28px 14px' }}
                >
                  No published case studies yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                  {publishedStudies.map(study => (
                    <Link
                      key={study.id}
                      href={`/training/case-studies/${study.slug}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div
                        className="card"
                        style={{
                          borderRadius: 14,
                          padding: 14,
                          minHeight: 240,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ height: 2, background: 'var(--accent)', opacity: 0.75, margin: '-14px -14px 6px' }} />
                        <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{study.title}</div>
                        <div
                          style={{
                            fontSize: 13,
                            color: 'var(--text-muted)',
                            lineHeight: 1.45,
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {study.overview}
                        </div>
                        <div style={{ marginTop: 'auto', display: 'grid', gap: 6 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Published: {fmtIso(study.publishedAt)}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <span className="badge">{study.hazardType}</span>
                            <span className="badge">{study.difficulty}</span>
                            <span className="badge">{study.readTimeMin} min read</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2 }}>
                          Open case study →
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {isAdmin && viewMode === 'manage_overview' && (
            <div className="card" style={{ maxWidth: 900 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Training Admin Overview</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{counts.draft}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Draft</div>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{counts.authorized}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>HITL Authorized (Admin Only)</div>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{counts.published}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Published to Students</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" style={{ fontSize: 13 }}>Invite Student</button>
                <button className="btn btn-secondary" style={{ fontSize: 13 }}>New Case Study</button>
                <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setViewMode('catalog')}>
                  Open Student Preview
                </button>
              </div>
            </div>
          )}

          {isAdmin && viewMode === 'manage_students' && (
            <div className="card" style={{ maxWidth: 980 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Student Portal Access</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Invite Student</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  <input disabled value="email@example.com" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)' }} />
                  <input disabled value="YT Apr 2026" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)' }} />
                  <button className="btn btn-primary" disabled style={{ fontSize: 13 }}>Send Invite (Phase 2 API)</button>
                </div>
              </div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Roster</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {students.map(student => (
                  <div key={student.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr', gap: 8 }}>
                    <div>{student.name}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{student.email}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{student.cohort}</div>
                    <div style={{ fontWeight: 600 }}>{student.status}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && viewMode === 'manage_case_studies' && (
            <div className="card" style={{ maxWidth: 1000 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Case Study Lifecycle</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Hosted file lives here first, then moves through HITL authorization and publish toggles.
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {caseStudies.map(study => (
                  <div key={study.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 3 }}>{study.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>/{study.slug}</div>
                      </div>
                      <span className="badge" style={{ alignSelf: 'flex-start' }}>{STATUS_LABELS[study.status]}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: 'grid', gap: 2 }}>
                      <div>Hosted file: {study.hostedFileUrl}</div>
                      <div>Authorised by: {study.authorisedBy ?? '-'}</div>
                      <div>Authorised at: {fmtIso(study.authorisedAt)}</div>
                      <div>Published at: {fmtIso(study.publishedAt)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 12 }}
                        disabled={study.status !== 'draft'}
                        onClick={() => authorizeStudy(study.id)}
                      >
                        Mark HITL Authorized
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 12 }}
                        disabled={study.status !== 'authorized_admin_only'}
                        onClick={() => publishStudy(study.id)}
                      >
                        Publish to Students
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        disabled={study.status !== 'published_students'}
                        onClick={() => unpublishStudy(study.id)}
                      >
                        Unpublish (Admin Only)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && viewMode === 'manage_preview' && (
            <div className="card" style={{ maxWidth: 980 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Portal Preview (Read-only)</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                This preview mirrors the student experience; no editing actions are exposed.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {caseStudies.map(study => (
                  <button
                    key={study.id}
                    className="btn btn-ghost"
                    style={{
                      fontSize: 12,
                      borderColor: selectedPreview?.id === study.id ? 'var(--accent)' : undefined,
                      color: selectedPreview?.id === study.id ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => setSelectedPreviewId(study.id)}
                  >
                    {study.title}
                  </button>
                ))}
              </div>
              {selectedPreview && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{selectedPreview.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Student visibility: {selectedPreview.studentVisible ? 'Live' : 'Not live'}
                  </div>
                  <div style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                    Read-only hosted page render placeholder:
                    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                      {selectedPreview.hostedFileUrl}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                Phase 2 hand-off: persist case studies/students in DB, replace mock actions with APIs, and add publish audit trail.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
