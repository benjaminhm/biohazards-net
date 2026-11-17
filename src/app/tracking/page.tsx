/*
 * app/tracking/page.tsx
 *
 * The client photo feed at tracking.<brand>.com.au. A client signs in with a
 * code texted to their mobile (or emailed), then follows their job's photos
 * oldest first, grouped into posts by day. Swipe through a post, tap a photo
 * to see it full size, and comment; replies come from the office.
 *
 * Someone following more than one job picks it from a list; ?job= keeps the
 * choice in the address.
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { brisbaneDayKey, brisbaneDayLabel, brisbaneTimeLabel } from '@/lib/tracking/feed'

interface Me {
  signedIn: boolean
  brand: string
  name?: string
  jobs?: { id: string; title: string }[]
}

interface Comment {
  id: string
  author_kind: 'client' | 'staff'
  author_name: string
  body: string
  created_at: string
}

interface Post {
  id: string
  area: string
  at: string
  caption: string
  photos: { id: string; url: string }[]
  comments: Comment[]
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '13px 14px',
  fontSize: 16,
  border: '1px solid #DBDBDB',
  borderRadius: 8,
  background: '#FAFAFA',
  color: '#111',
  fontFamily: font,
}

const primary: React.CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  fontSize: 15,
  fontWeight: 700,
  border: 'none',
  borderRadius: 8,
  background: '#FF6B35',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: font,
}

const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#555',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: font,
  textDecoration: 'underline',
}

function selectedJobFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('job')
}

async function fetchMe(): Promise<Me> {
  const res = await fetch('/api/tracking/me', { cache: 'no-store' })
  return (await res.json().catch(() => ({ signedIn: false, brand: '' }))) as Me
}

function setJobInUrl(jobId: string | null) {
  const url = new URL(window.location.href)
  if (jobId) url.searchParams.set('job', jobId)
  else url.searchParams.delete('job')
  window.history.replaceState(null, '', url.toString())
}

export default function TrackingPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const applyMe = useCallback((data: Me) => {
    setMe(data)
    const jobs = data.jobs ?? []
    const wanted = selectedJobFromUrl()
    if (wanted && jobs.some(j => j.id === wanted)) setJobId(wanted)
    else if (jobs.length === 1) setJobId(jobs[0].id)
    else setJobId(null)
  }, [])

  const loadMe = useCallback(() => {
    void fetchMe().then(applyMe)
  }, [applyMe])

  useEffect(() => {
    fetchMe().then(applyMe, () => applyMe({ signedIn: false, brand: '' }))
  }, [applyMe])

  async function signOut() {
    await fetch('/api/tracking/auth/logout', { method: 'POST' })
    setJobId(null)
    setJobInUrl(null)
    void loadMe()
  }

  if (!me) return <Shell brand=""><p style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>Loading…</p></Shell>
  if (!me.signedIn) return <Shell brand={me.brand}><SignIn onSignedIn={loadMe} /></Shell>

  const jobs = me.jobs ?? []
  const job = jobs.find(j => j.id === jobId)

  return (
    <Shell brand={me.brand} onSignOut={signOut}>
      {!jobs.length ? (
        <Card>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
            There are no photos to show you yet. We will let you know when there are.
          </p>
        </Card>
      ) : job ? (
        <>
          {jobs.length > 1 && (
            <button type="button" style={{ ...link, margin: '0 16px 12px' }} onClick={() => { setJobId(null); setJobInUrl(null) }}>
              ← All jobs
            </button>
          )}
          <Feed jobId={job.id} title={job.title} />
        </>
      ) : (
        <Card>
          <h2 style={{ margin: '0 0 12px', fontSize: 17 }}>Your jobs</h2>
          {jobs.map(j => (
            <button
              key={j.id}
              type="button"
              onClick={() => { setJobId(j.id); setJobInUrl(j.id) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '14px 0', border: 'none', borderTop: '1px solid #EFEFEF', background: 'none', fontSize: 15, cursor: 'pointer', fontFamily: font, color: '#111' }}
            >
              {j.title} →
            </button>
          ))}
        </Card>
      )}
    </Shell>
  )
}

function Shell({ brand, onSignOut, children }: { brand: string; onSignOut?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', fontFamily: font }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', borderBottom: '1px solid #DBDBDB' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{brand}</span>
          {onSignOut && <button type="button" style={link} onClick={onSignOut}>Sign out</button>}
        </div>
      </header>
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '16px 0 60px' }}>{children}</main>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#fff', border: '1px solid #DBDBDB', borderRadius: 10, padding: 20, margin: '0 12px' }}>{children}</div>
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'contact' | 'code'>('contact')
  const [kind, setKind] = useState<'mobile' | 'email'>('mobile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/tracking/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || 'Something went wrong. Try again.')
      return
    }
    setKind(data.kind === 'email' ? 'email' : 'mobile')
    setStep('code')
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/tracking/auth/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact, code }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || 'Something went wrong. Try again.')
      return
    }
    onSignedIn()
  }

  return (
    <Card>
      <h1 style={{ margin: '0 0 6px', fontSize: 20 }}>See your job photos</h1>
      {step === 'contact' ? (
        <form onSubmit={requestCode}>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#555', lineHeight: 1.5 }}>
            Enter the mobile number we have for you. We will text you a code.
          </p>
          <input
            style={field}
            value={contact}
            onChange={e => setContact(e.target.value)}
            placeholder="Mobile (04…) or email"
            autoComplete="tel"
            inputMode="text"
            autoFocus
          />
          {error && <p style={{ color: '#C0392B', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
          <button type="submit" style={{ ...primary, marginTop: 14, opacity: busy || !contact.trim() ? 0.6 : 1 }} disabled={busy || !contact.trim()}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#555', lineHeight: 1.5 }}>
            If {contact.trim()} is set up for a job, a 6-digit code is on its way by {kind === 'email' ? 'email' : 'text'}.
          </p>
          <input
            style={{ ...field, fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
          />
          {error && <p style={{ color: '#C0392B', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
          <button type="submit" style={{ ...primary, marginTop: 14, opacity: busy || code.length !== 6 ? 0.6 : 1 }} disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button type="button" style={link} onClick={() => { setStep('contact'); setCode(''); setError('') }}>Use a different number</button>
            <button type="button" style={link} onClick={() => void requestCode()} disabled={busy}>Send again</button>
          </div>
        </form>
      )}
    </Card>
  )
}

function Feed({ jobId, title }: { jobId: string; title: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<string | null>(null)

  const apply = useCallback((result: { status: number; data: { error?: string; posts?: Post[] } }) => {
    if (result.status === 401) {
      window.location.reload()
      return
    }
    if (result.status !== 200) {
      setError(result.data.error || 'The photos could not be loaded.')
      return
    }
    setError('')
    setPosts(result.data.posts ?? [])
  }, [])

  const load = useCallback(() => {
    fetch(`/api/tracking/jobs/${jobId}`, { cache: 'no-store' })
      .then(async res => ({ status: res.status, data: await res.json().catch(() => ({})) }))
      .then(apply, () => apply({ status: 0, data: {} }))
  }, [jobId, apply])

  useEffect(() => {
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  let lastDay = ''
  return (
    <>
      <h1 style={{ fontSize: 18, margin: '0 16px 14px' }}>{title}</h1>
      {error && <Card><p style={{ margin: 0, color: '#C0392B' }}>{error}</p></Card>}
      {posts && !posts.length && (
        <Card><p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>No photos yet. They will appear here as the work goes on.</p></Card>
      )}
      {posts?.map(post => {
        const day = brisbaneDayKey(post.at)
        const heading = day !== lastDay ? brisbaneDayLabel(post.at) : null
        lastDay = day
        return (
          <div key={post.id}>
            {heading && (
              <div style={{ margin: '22px 16px 10px', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8E8E8E' }}>{heading}</div>
            )}
            <PostCard jobId={jobId} post={post} onZoom={setZoom} onCommented={load} />
          </div>
        )
      })}
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <span style={{ position: 'absolute', top: 14, right: 18, color: '#fff', fontSize: 28 }}>×</span>
        </div>
      )}
    </>
  )
}

function PostCard({ jobId, post, onZoom, onCommented }: { jobId: string; post: Post; onZoom: (url: string) => void; onCommented: () => void }) {
  const [index, setIndex] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const strip = useRef<HTMLDivElement>(null)

  function onScroll() {
    const el = strip.current
    if (!el) return
    setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    setBusy(true)
    setError('')
    const res = await fetch(`/api/tracking/jobs/${jobId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: post.id, body: comment }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || 'The comment could not be sent.')
      return
    }
    setComment('')
    onCommented()
  }

  return (
    <article style={{ background: '#fff', borderTop: '1px solid #DBDBDB', borderBottom: '1px solid #DBDBDB', marginBottom: 14 }}>
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
        <span style={{ fontWeight: 600 }}>{post.area || 'On site'}</span>
        <span style={{ color: '#8E8E8E' }}>{brisbaneTimeLabel(post.at)}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <div
          ref={strip}
          onScroll={onScroll}
          style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {post.photos.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onZoom(p.url)}
              style={{ flex: '0 0 100%', scrollSnapAlign: 'center', padding: 0, border: 'none', background: '#000', cursor: 'zoom-in', aspectRatio: '1 / 1' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
        {post.photos.length > 1 && (
          <span style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, padding: '3px 9px', borderRadius: 12 }}>
            {index + 1}/{post.photos.length}
          </span>
        )}
      </div>
      {post.photos.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '8px 0 0' }}>
          {post.photos.map((p, i) => (
            <span key={p.id} style={{ width: 6, height: 6, borderRadius: 3, background: i === index ? '#FF6B35' : '#DBDBDB' }} />
          ))}
        </div>
      )}
      <div style={{ padding: '8px 14px 12px' }}>
        {post.caption && <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{post.caption}</p>}
        {post.comments.map(c => (
          <p key={c.id} style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
            <span style={{ fontWeight: 600 }}>{c.author_kind === 'staff' ? `${c.author_name || 'Our team'} (our team)` : c.author_name || 'You'}</span>{' '}
            {c.body}
          </p>
        ))}
        <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 8, borderTop: '1px solid #EFEFEF', paddingTop: 10 }}>
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment or question…"
            maxLength={2000}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontFamily: font, background: 'transparent', color: '#111' }}
          />
          <button type="submit" disabled={busy || !comment.trim()} style={{ background: 'none', border: 'none', color: '#FF6B35', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: busy || !comment.trim() ? 0.4 : 1, fontFamily: font }}>
            Post
          </button>
        </form>
        {error && <p style={{ color: '#C0392B', fontSize: 13, margin: '6px 0 0' }}>{error}</p>}
      </div>
    </article>
  )
}
