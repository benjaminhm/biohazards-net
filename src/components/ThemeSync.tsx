'use client'

/*
 * components/ThemeSync.tsx
 *
 * Mounts once in the root layout to keep <html data-theme> and the .tablet-app
 * class synced across tabs, the JobPanel iframe, and the Android WebView shell.
 */
import { useEffect } from 'react'
import { applyTheme, resolveTheme, THEME_EVENT, THEME_STORAGE_KEY } from '@/lib/theme'
import { isTabletApp, type AppTheme } from '@/lib/tabletApp'

export default function ThemeSync() {
  useEffect(() => {
    if (isTabletApp()) {
      document.documentElement.classList.add('tablet-app')
    }
    applyTheme(resolveTheme(), false)

    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return
      if (e.newValue === 'light' || e.newValue === 'dark') {
        applyTheme(e.newValue, false)
      }
    }

    const onCustom = (e: Event) => {
      const next = (e as CustomEvent<AppTheme>).detail
      if (next === 'light' || next === 'dark') {
        applyTheme(next, false)
      }
    }

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'bh-theme:sync' && (e.data.theme === 'light' || e.data.theme === 'dark')) {
        applyTheme(e.data.theme, false)
      }
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener(THEME_EVENT, onCustom)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(THEME_EVENT, onCustom)
      window.removeEventListener('message', onMessage)
    }
  }, [])

  return null
}
