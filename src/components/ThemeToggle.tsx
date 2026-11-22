'use client'

/*
 * components/ThemeToggle.tsx
 *
 * Compact Light / Dark mode switcher styled for both dark-slate RankPulse bars
 * (variant="rail") and standard content headers (variant="surface").
 */
import { useAppTheme } from '@/lib/theme'
import { triggerNativeHaptic } from '@/lib/tabletApp'

export default function ThemeToggle({ variant = 'surface' }: { variant?: 'surface' | 'rail' }) {
  const [theme, setTheme] = useAppTheme()

  function pick(next: 'light' | 'dark') {
    if (next === theme) return
    triggerNativeHaptic('light')
    setTheme(next)
  }

  const isRail = variant === 'rail'
  const wrapBg = isRail ? 'var(--rail-surface)' : 'var(--surface)'
  const wrapBorder = isRail ? 'var(--rail-border)' : 'var(--border)'
  const mutedColor = isRail ? 'var(--rail-muted)' : 'var(--text-muted)'

  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    border: active ? '1px solid var(--accent-border)' : '1px solid transparent',
    borderRadius: 7,
    cursor: 'pointer',
    background: active ? 'var(--accent-dim)' : 'transparent',
    color: active ? 'var(--accent-strong)' : mutedColor,
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap',
  })

  return (
    <div
      role="group"
      aria-label="Theme"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 2,
        borderRadius: 9,
        border: `1px solid ${wrapBorder}`,
        background: wrapBg,
      }}
    >
      <button
        type="button"
        onClick={() => pick('light')}
        aria-pressed={theme === 'light'}
        title="Light mode"
        style={btnStyle(theme === 'light')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <span>Light</span>
      </button>
      <button
        type="button"
        onClick={() => pick('dark')}
        aria-pressed={theme === 'dark'}
        title="Dark mode"
        style={btnStyle(theme === 'dark')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
        <span>Dark</span>
      </button>
    </div>
  )
}
