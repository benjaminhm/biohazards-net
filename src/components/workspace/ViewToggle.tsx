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
import { triggerNativeHaptic } from '@/lib/tabletApp'

export default function ViewToggle({
  current,
  jobId,
  variant = 'surface',
}: {
  current: ViewMode
  jobId?: string | null
  variant?: 'surface' | 'rail'
}) {
  const router = useRouter()
  const { isAdmin, isManager, loading } = useUser()
  const wide = useWideScreen()
  if (loading || !wide || !(isAdmin || isManager)) return null

  function go(mode: ViewMode) {
    writeViewMode(mode)
    if (mode === current) return
    triggerNativeHaptic('light')
    if (mode === 'agent') router.push(jobId ? `/workspace?job=${jobId}` : '/workspace')
    else router.push(jobId ? `/jobs/${jobId}` : '/')
  }

  const isRail = variant === 'rail'
  const wrapBg = isRail ? 'var(--rail-surface)' : 'var(--surface)'
  const wrapBorder = isRail ? 'var(--rail-border)' : 'var(--border)'
  const mutedColor = isRail ? 'var(--rail-muted)' : 'var(--text-muted)'

  const btn = (mode: ViewMode, label: string) => (
    <button
      type="button"
      onClick={() => go(mode)}
      aria-pressed={current === mode}
      style={{
        padding: '5px 11px',
        fontSize: 12,
        fontWeight: 600,
        border: current === mode ? '1px solid var(--accent-border)' : '1px solid transparent',
        borderRadius: 7,
        cursor: 'pointer',
        background: current === mode ? 'var(--accent-dim)' : 'transparent',
        color: current === mode ? 'var(--accent-strong)' : mutedColor,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      role="group"
      aria-label="View"
      style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, border: `1px solid ${wrapBorder}`, background: wrapBg }}
    >
      {btn('classic', 'Classic')}
      {btn('agent', 'Agent')}
    </div>
  )
}
