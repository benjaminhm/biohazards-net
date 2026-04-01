'use client'
import { useEffect, useState } from 'react'
import { useDevMode } from '@/lib/devMode'

interface Badge {
  id: string
  top: number
  left: number
}

const PAGE_REGISTRY: { id: string; label: string }[] = [
  { id: 'P1', label: 'Dashboard' },
  { id: 'P2', label: 'Job Detail' },
  { id: 'P3', label: 'Doc Editor' },
  { id: 'P4', label: 'Settings' },
  { id: 'P5', label: 'New Job' },
  { id: 'P6', label: 'Platform Admin' },
  { id: 'P7', label: 'New Client' },
]

export default function DevOverlay() {
  const { devMode } = useDevMode()
  const [badges, setBadges] = useState<Badge[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!devMode) {
      setBadges([])
      return
    }

    function scan() {
      const elements = document.querySelectorAll<HTMLElement>('[data-devid]')
      const next: Badge[] = []
      elements.forEach(el => {
        const id = el.getAttribute('data-devid')
        if (!id) return
        const rect = el.getBoundingClientRect()
        next.push({
          id,
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
        })
      })
      setBadges(next)
    }

    scan()
    const interval = setInterval(scan, 300)
    return () => clearInterval(interval)
  }, [devMode])

  async function handleCopy(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  if (!devMode) return null

  return (
    <>
      {/* Legend panel */}
      <div
        style={{
          position: 'fixed',
          top: 60,
          left: 10,
          zIndex: 99999,
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          padding: '8px 10px',
          borderRadius: 6,
          fontSize: 10,
          fontFamily: 'monospace',
          lineHeight: 1.6,
          pointerEvents: 'none',
        }}
      >
        {PAGE_REGISTRY.map(p => (
          <div key={p.id}>{p.id} = {p.label}</div>
        ))}
      </div>

      {/* Badges */}
      {badges.map(badge => (
        <button
          key={badge.id}
          onClick={() => handleCopy(badge.id)}
          style={{
            position: 'absolute',
            top: badge.top,
            left: badge.left,
            zIndex: 99999,
            background: '#FF6B35',
            color: '#fff',
            fontSize: 10,
            fontFamily: 'monospace',
            padding: '2px 5px',
            borderRadius: 4,
            border: 'none',
            cursor: 'pointer',
            transform: 'translate(-2px, -2px)',
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
          }}
        >
          {copied === badge.id ? 'Copied!' : badge.id}
        </button>
      ))}
    </>
  )
}
