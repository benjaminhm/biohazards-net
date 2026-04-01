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
