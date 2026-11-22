'use client'

/*
 * lib/theme.ts
 *
 * Light / Dark theme preference shared across all pages, the workspace iframe,
 * and the Android tablet WebView shell.
 *
 * Defaults to Light (RankPulse daylight contrast) inside the Android tablet
 * APK, and Dark on desktop browsers until toggled.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { isTabletApp, syncNativeTheme, type AppTheme } from '@/lib/tabletApp'

export const THEME_STORAGE_KEY = 'bh_theme'
export const THEME_EVENT = 'bh-theme-change'

export function readStoredTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return null
}

export function resolveTheme(): AppTheme {
  const stored = readStoredTheme()
  if (stored) return stored
  return isTabletApp() ? 'light' : 'dark'
}

export function applyTheme(theme: AppTheme, persist = false) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
  if (isTabletApp()) {
    document.documentElement.classList.add('tablet-app')
  }
  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent<AppTheme>(THEME_EVENT, { detail: theme }))
  }
  syncNativeTheme(theme)
}

function subscribeTheme(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) cb()
  }
  window.addEventListener(THEME_EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(THEME_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAppTheme(): [AppTheme, (next: AppTheme) => void] {
  const theme = useSyncExternalStore<AppTheme>(subscribeTheme, resolveTheme, () => 'dark')

  useEffect(() => {
    applyTheme(theme, false)
  }, [theme])

  function setTheme(next: AppTheme) {
    applyTheme(next, true)
  }

  return [theme, setTheme]
}
