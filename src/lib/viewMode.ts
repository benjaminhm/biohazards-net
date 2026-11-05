'use client'

/*
 * lib/viewMode.ts
 *
 * Classic vs Agent view preference, per browser. Agent view (the /workspace
 * three-panel layout) is desktop and tablet only; phones always get Classic.
 */
import { useEffect, useState } from 'react'

export type ViewMode = 'classic' | 'agent'

const KEY = 'bh_view_mode'
export const AGENT_VIEW_MIN_WIDTH = 900

export function readViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'classic'
  return window.localStorage.getItem(KEY) === 'agent' ? 'agent' : 'classic'
}

export function writeViewMode(mode: ViewMode) {
  window.localStorage.setItem(KEY, mode)
}

export function isWideScreen(): boolean {
  return typeof window !== 'undefined' && window.innerWidth >= AGENT_VIEW_MIN_WIDTH
}

/** True once mounted on a screen wide enough for Agent view. */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${AGENT_VIEW_MIN_WIDTH}px)`)
    const update = () => setWide(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return wide
}
