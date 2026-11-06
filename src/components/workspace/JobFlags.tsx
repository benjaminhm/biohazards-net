'use client'

/*
 * components/workspace/JobFlags.tsx
 *
 * Open flags pinned on a job, coloured by severity, each with Resolve. Shown
 * at the top of the Classic job page and the Agent workspace right panel.
 */
import { useEffect, useState } from 'react'

interface FlagView {
  id: string
  severity: 'info' | 'warning' | 'urgent'
  message: string
  source: 'agent' | 'staff' | 'system'
  created_at: string
}

const COLOURS: Record<FlagView['severity'], { border: string; bg: string; text: string; label: string }> = {
  info: { border: 'rgba(96,165,250,0.45)', bg: 'rgba(96,165,250,0.10)', text: '#93C5FD', label: 'Info' },
  warning: { border: 'rgba(251,191,36,0.5)', bg: 'rgba(251,191,36,0.10)', text: '#FCD34D', label: 'Warning' },
  urgent: { border: 'rgba(248,113,113,0.6)', bg: 'rgba(248,113,113,0.12)', text: '#FCA5A5', label: 'Urgent' },
}

const SOURCE: Record<FlagView['source'], string> = { agent: 'File agent', staff: 'Staff', system: 'Automatic' }

export default function JobFlags({ jobId, reloadKey = 0, compact = false }: { jobId: string; reloadKey?: number; compact?: boolean }) {
  const [flags, setFlags] = useState<FlagView[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    fetch(`/api/jobs/${jobId}/flags`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live && d) setFlags(d.flags ?? []) })
      .catch(() => {})
    return () => { live = false }
  }, [jobId, reloadKey, reload])

  async function resolve(id: string) {
    setBusy(id)
    try {
      await fetch(`/api/jobs/${jobId}/flags/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve' }),
      })
    } finally {
      setBusy(null)
      setReload(n => n + 1)
    }
  }

  if (!flags.length) return null
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: compact ? 0 : 12 }} className={compact ? undefined : 'container'}>
      {flags.map(f => {
        const c = COLOURS[f.severity] ?? COLOURS.info
        return (
          <div
            key={f.id}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.bg }}
          >
            <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.text, marginRight: 8 }}>{c.label}</span>
              {f.message}
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>· {SOURCE[f.source] ?? f.source}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy === f.id}
              onClick={() => void resolve(f.id)}
              style={{ padding: '3px 10px', fontSize: 12 }}
            >
              Resolve
            </button>
          </div>
        )
      })}
    </div>
  )
}
