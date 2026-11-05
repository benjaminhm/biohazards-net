'use client'

/*
 * components/workspace/ViewToggle.tsx
 *
 * Classic | Agent switch. Keeps the same job when switching: /jobs/<id> and
 * /workspace?job=<id>. Only for admins and managers, and only on wide screens.
 */
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/userContext'
import { useWideScreen, writeViewMode, type ViewMode } from '@/lib/viewMode'

export default function ViewToggle({ current, jobId }: { current: ViewMode; jobId?: string | null }) {
  const router = useRouter()
  const { isAdmin, isManager, loading } = useUser()
  const wide = useWideScreen()
  if (loading || !wide || !(isAdmin || isManager)) return null

  function go(mode: ViewMode) {
    writeViewMode(mode)
    if (mode === current) return
    if (mode === 'agent') router.push(jobId ? `/workspace?job=${jobId}` : '/workspace')
    else router.push(jobId ? `/jobs/${jobId}` : '/')
  }

  const btn = (mode: ViewMode, label: string) => (
    <button
      type="button"
      onClick={() => go(mode)}
      aria-pressed={current === mode}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 700,
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        background: current === mode ? 'var(--accent)' : 'transparent',
        color: current === mode ? '#000' : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      role="group"
      aria-label="View"
      style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      {btn('classic', 'Classic')}
      {btn('agent', 'Agent')}
    </div>
  )
}
