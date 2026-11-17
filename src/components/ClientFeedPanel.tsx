/*
 * components/ClientFeedPanel.tsx
 *
 * "Client view" on the Photos tab: the job's photo feed at
 * tracking.<brand>.com.au, as the client sees it.
 *
 * Admins and managers turn the feed on, choose who can sign in, and reply to
 * client comments. Anyone with the job file can show or hide a photo and write
 * the caption under a post. Every word the client reads here is typed by staff.
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { emailMessageHandoff, handoffFitsQr, handoffQrSvg, textMessageHandoff } from '@/lib/phoneHandoff'
import { brisbaneDayLabel, brisbaneTimeLabel } from '@/lib/tracking/feed'
import { displayMobile } from '@/lib/tracking/identity'

interface StaffPhoto {
  id: string
  url: string
  area: string
  category: string
  at: string
  visible: boolean
  overridden: boolean
  defaultVisible: boolean
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
  photos: StaffPhoto[]
  comments: Comment[]
}

interface Viewer {
  id: string
  name: string
  mobile: string
  email: string
  added_by_name: string
  last_seen_at: string | null
}

interface Suggestion {
  name: string
  mobile: string
  email: string
  source: string
}

interface FeedState {
  enabled: boolean
  canManage: boolean
  trackingUrl: string
  viewers: Viewer[]
  suggestions: Suggestion[]
  posts: Post[]
  hidden: StaffPhoto[]
}

const HINT: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }
const SMALL_BTN: React.CSSProperties = { fontSize: 12, padding: '5px 10px' }

export default function ClientFeedPanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<FeedState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [handoffFor, setHandoffFor] = useState<Viewer | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/client-feed`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Could not load the client view')
      return
    }
    setError('')
    setState(data as FeedState)
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        window.alert(data.error || 'That did not work')
        return false
      }
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  const setVisible = (photoId: string, visible: boolean | null) =>
    call(`/api/jobs/${jobId}/client-feed/photos`, 'PATCH', { photoId, visible })

  if (error) return <div className="card" style={{ color: '#F87171', fontSize: 13 }}>{error}</div>
  if (!state) return <div style={{ ...HINT, padding: 20 }}>Loading client view…</div>

  const host = state.trackingUrl.replace(/^https?:\/\//, '')
  const shownCount = state.posts.reduce((n, p) => n + p.photos.length, 0)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              {state.enabled ? 'The client can see this job\u2019s photos' : 'Photos are not shown to the client'}
            </div>
            <div style={HINT}>
              {state.enabled
                ? `People below sign in at ${host} with a code texted to their mobile. ${shownCount} photo${shownCount === 1 ? '' : 's'} showing.`
                : `Turn it on and the people below can sign in at ${host}. During and after photos show; hide any you don\u2019t want seen first.`}
            </div>
          </div>
          {state.canManage && (
            <button
              type="button"
              className={state.enabled ? 'btn btn-secondary' : 'btn btn-primary'}
              disabled={busy}
              onClick={() => call(`/api/jobs/${jobId}/client-feed`, 'PATCH', { enabled: !state.enabled })}
            >
              {state.enabled ? 'Stop showing photos' : 'Show photos to the client'}
            </button>
          )}
        </div>
      </div>

      <Viewers
        jobId={jobId}
        state={state}
        busy={busy}
        call={call}
        onText={setHandoffFor}
      />
      {handoffFor && (
        <SignInHandoff viewer={handoffFor} trackingUrl={state.trackingUrl} enabled={state.enabled} onClose={() => setHandoffFor(null)} />
      )}

      <div>
        <div style={{ fontWeight: 800, fontSize: 14, margin: '4px 0 10px' }}>What the client sees</div>
        {state.posts.length === 0 ? (
          <div className="card" style={HINT}>No photos are showing. Show photos from the list below.</div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {state.posts.map(post => (
              <StaffPost key={`${post.id}:${post.caption}`} jobId={jobId} post={post} canManage={state.canManage} busy={busy} call={call} onHide={id => setVisible(id, false)} />
            ))}
          </div>
        )}
      </div>

      {state.hidden.length > 0 && (
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, margin: '4px 0 4px' }}>Not shown to the client ({state.hidden.length})</div>
          <div style={{ ...HINT, marginBottom: 10 }}>Assessment, untagged and disposal photos stay hidden unless you show them.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {state.hidden.map(p => (
              <div key={p.id} className="card" style={{ padding: 6 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6, display: 'block', opacity: 0.7 }} />
                <div style={{ ...HINT, margin: '6px 2px' }}>
                  {p.area || 'No area'} · {p.overridden ? 'hidden by staff' : p.category || 'untagged'}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ ...SMALL_BTN, width: '100%' }}
                  disabled={busy}
                  onClick={() => setVisible(p.id, p.defaultVisible ? null : true)}
                >
                  Show to client
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Viewers({
  jobId,
  state,
  busy,
  call,
  onText,
}: {
  jobId: string
  state: FeedState
  busy: boolean
  call: (url: string, method: string, body?: unknown) => Promise<boolean>
  onText: (v: Viewer) => void
}) {
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const base = `/api/jobs/${jobId}/client-feed/viewers`

  async function add(v: { name: string; mobile: string; email: string }) {
    if (await call(base, 'POST', v)) {
      setName('')
      setMobile('')
      setEmail('')
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>Who can view</div>
      {state.viewers.length === 0 && <div style={HINT}>Nobody yet.</div>}
      {state.viewers.map(v => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{v.name || 'No name'}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              {[v.mobile && displayMobile(v.mobile), v.email].filter(Boolean).join(' · ')}
            </span>
            <div style={HINT}>{v.last_seen_at ? `Last looked ${brisbaneDayLabel(v.last_seen_at)}, ${brisbaneTimeLabel(v.last_seen_at)}` : 'Has not looked yet'}</div>
          </div>
          {state.canManage && (
            <>
              <button type="button" className="btn btn-secondary" style={SMALL_BTN} onClick={() => onText(v)}>
                {v.mobile ? 'Text sign-in link' : 'Email sign-in link'}
              </button>
              <button type="button" className="btn" style={SMALL_BTN} disabled={busy} onClick={() => call(`${base}?viewerId=${v.id}`, 'DELETE')}>
                Remove
              </button>
            </>
          )}
        </div>
      ))}
      {state.canManage && state.suggestions.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {state.suggestions.map(s => (
            <div key={`${s.mobile}${s.email}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
              <div style={{ flex: 1, minWidth: 200, color: 'var(--text-muted)' }}>
                {s.name || 'No name'} · {[s.mobile && displayMobile(s.mobile), s.email].filter(Boolean).join(' · ')} <span style={HINT}>({s.source})</span>
              </div>
              <button type="button" className="btn btn-secondary" style={SMALL_BTN} disabled={busy} onClick={() => add(s)}>Add</button>
            </div>
          ))}
        </div>
      )}
      {state.canManage && (
        <form
          onSubmit={e => { e.preventDefault(); void add({ name, mobile, email }) }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" style={{ flex: '1 1 140px' }} />
          <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Mobile 04…" inputMode="tel" style={{ flex: '1 1 140px' }} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (if no mobile)" type="email" style={{ flex: '1 1 180px' }} />
          <button type="submit" className="btn btn-secondary" disabled={busy || (!mobile.trim() && !email.trim())}>Add</button>
        </form>
      )}
    </div>
  )
}

function SignInHandoff({ viewer, trackingUrl, enabled, onClose }: { viewer: Viewer; trackingUrl: string; enabled: boolean; onClose: () => void }) {
  const first = viewer.name.trim().split(/\s+/)[0] || 'there'
  const [message, setMessage] = useState(
    `Hi ${first}, you can follow the photos of your job here: ${trackingUrl}\nSign in with ${viewer.mobile ? 'this mobile number' : 'this email address'} and we will send you a code.`
  )
  const text = viewer.mobile ? textMessageHandoff(viewer.mobile, message) : null
  const mail = text ? null : emailMessageHandoff(viewer.email, 'Photos of your job', message)
  const handoff = text ?? mail
  const qr = useMemo(
    () => (handoff && message.trim() && handoffFitsQr(handoff.url) ? `data:image/svg+xml;utf8,${encodeURIComponent(handoffQrSvg(handoff.url))}` : ''),
    [handoff, message]
  )

  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 10, borderColor: 'var(--accent)' }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Send {viewer.name || 'them'} the address. Nothing has been sent.</div>
      {!enabled && <div style={{ ...HINT, color: '#F59E0B' }}>Photos are not being shown yet: they will see an empty page until you turn it on.</div>}
      {qr && handoff ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for the message" width={200} height={200} style={{ borderRadius: 8, background: '#fff' }} />
          <div style={{ flex: '1 1 200px', fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700 }}>Scan with your phone camera.</div>
            <div style={{ color: 'var(--text-muted)' }}>
              {text ? 'Messages' : 'Mail'} opens to {handoff.to} with the message filled in. Tap send on the phone.
            </div>
            <a className="btn btn-secondary" href={handoff.url} style={{ display: 'inline-block', marginTop: 8, textDecoration: 'none', fontSize: 13 }}>
              On this phone: open in {text ? 'Messages' : 'Mail'}
            </a>
          </div>
        </div>
      ) : (
        <div style={HINT}>{!message.trim() ? 'The message is empty.' : 'Copy the message and send it yourself.'}</div>
      )}
      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} aria-label="Message to send" />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(message)}>Copy message</button>
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

function StaffPost({
  jobId,
  post,
  canManage,
  busy,
  call,
  onHide,
}: {
  jobId: string
  post: Post
  canManage: boolean
  busy: boolean
  call: (url: string, method: string, body?: unknown) => Promise<boolean>
  onHide: (photoId: string) => void
}) {
  const [caption, setCaption] = useState(post.caption)
  const [reply, setReply] = useState('')
  const commentsUrl = `/api/jobs/${jobId}/client-feed/comments`

  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <strong>{post.area || 'On site'}</strong>
        <span style={{ color: 'var(--text-muted)' }}>{brisbaneDayLabel(post.at)}, {brisbaneTimeLabel(post.at)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {post.photos.map(p => (
          <div key={p.id} style={{ flex: '0 0 150px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" loading="lazy" style={{ width: 150, height: 150, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
            <button type="button" className="btn" style={{ ...SMALL_BTN, marginTop: 6, width: '100%' }} disabled={busy} onClick={() => onHide(p.id)}>
              Hide from client
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Caption the client reads (optional)" maxLength={1000} style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || caption.trim() === post.caption}
          onClick={() => call(`/api/jobs/${jobId}/client-feed/photos`, 'PATCH', { photoIds: post.photos.map(p => p.id), caption })}
        >
          Save
        </button>
      </div>
      {post.comments.length > 0 && (
        <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {post.comments.map(c => (
            <div key={c.id} style={{ fontSize: 13, lineHeight: 1.45, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
                <strong style={{ color: c.author_kind === 'client' ? 'var(--accent)' : 'var(--text)' }}>
                  {c.author_kind === 'client' ? `${c.author_name || 'Client'} (client)` : c.author_name || 'Staff'}
                </strong>{' '}
                {c.body}
                <span style={{ ...HINT, marginLeft: 6 }}>{brisbaneTimeLabel(c.created_at)}</span>
              </div>
              {canManage && (
                <button type="button" className="btn" style={{ ...SMALL_BTN, padding: '2px 8px' }} disabled={busy} onClick={() => call(`${commentsUrl}?commentId=${c.id}`, 'DELETE')} aria-label="Remove comment">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canManage ? (
        <form
          onSubmit={async e => {
            e.preventDefault()
            if (await call(commentsUrl, 'POST', { postId: post.id, body: reply })) setReply('')
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply to the client…" maxLength={2000} style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary" disabled={busy || !reply.trim()}>Reply</button>
        </form>
      ) : (
        post.comments.length > 0 && <div style={HINT}>Admins reply to client comments.</div>
      )}
    </div>
  )
}
