/*
 * components/DevToggle.tsx
 *
 * A persistent "DEV" button fixed to the bottom-right of the screen that
 * toggles developer overlay mode. The button turns orange when dev mode is
 * active to make the current state obvious at a glance.
 *
 * This is the only entry point for enabling DevOverlay — both components
 * share the same devMode context from lib/devMode.tsx so toggling here
 * immediately shows/hides all data-devid badges in DevOverlay.
 *
 * Positioned above the mobile nav bar (bottom: 72) so it doesn't overlap it.
 */
'use client'
import { useDevMode } from '@/lib/devMode'

export default function DevToggle() {
  const { devMode, toggle } = useDevMode()

  return (
    <button
      onClick={toggle}
      style={{
        position: 'fixed',
        bottom: 72,
        right: 16,
        zIndex: 99999,
        background: devMode ? '#FF6B35' : 'rgba(0,0,0,0.6)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'monospace',
      }}
    >
      {devMode ? '🔧 ON' : '🔧 DEV'}
    </button>
  )
}
