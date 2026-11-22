'use client'

/*
 * components/ThemeSync.tsx
 *
 * Mounts once in the root layout to:
 *   1. Keep <html data-theme> and .tablet-app synced across tabs, the JobPanel
 *      iframe, and the Android WebView shell.
 *   2. Check /api/version whenever the app wakes/focuses so a fresh Vercel
 *      deploy is picked up immediately without force-stopping the tablet APK.
 */
import { useEffect, useRef, useState } from 'react'
import { applyTheme, resolveTheme, THEME_EVENT, THEME_STORAGE_KEY } from '@/lib/theme'
import { isTabletApp, nativeHardReload, triggerNativeHaptic, type AppTheme } from '@/lib/tabletApp'

const VERSION_CHECK_INTERVAL_MS = 60_000

function isEditingText(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

export default function ThemeSync() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const initialBuildRef = useRef<string | null>(null)
  const lastCheckedRef = useRef(0)

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

  // Only poll for live deploy updates in the top-level window (not inside the JobPanel iframe).
  useEffect(() => {
    let isTop = true
    try {
      isTop = window.self === window.top
    } catch {
      isTop = false
    }
    if (!isTop) return

    async function checkVersion(force = false) {
      const now = Date.now()
      if (!force && now - lastCheckedRef.current < VERSION_CHECK_INTERVAL_MS) return
      lastCheckedRef.current = now
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { build?: string }
        const build = data.build
        if (!build || build === 'local') return
        if (!initialBuildRef.current) {
          initialBuildRef.current = build
          return
        }
        if (build !== initialBuildRef.current) {
          if (!isEditingText() && !window.location.pathname.startsWith('/jobs/')) {
            if (!nativeHardReload()) window.location.reload()
          } else {
            setUpdateAvailable(true)
          }
        }
      } catch {
        /* offline */
      }
    }

    void checkVersion(true)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVersion(false)
    }
    const onFocus = () => void checkVersion(false)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkVersion(false)
    }, VERSION_CHECK_INTERVAL_MS * 3)

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 12,
        background: 'var(--rail-bg)',
        color: 'var(--rail-text)',
        border: '1px solid var(--accent-border)',
        boxShadow: '0 8px 24px rgba(2,6,23,0.38)',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 99, background: '#34D399' }} />
      <span>New update ready</span>
      <button
        type="button"
        className="btn btn-primary"
        style={{ padding: '5px 12px', fontSize: 12, minHeight: 32 }}
        onClick={() => {
          triggerNativeHaptic('confirm')
          if (!nativeHardReload()) window.location.reload()
        }}
      >
        Refresh
      </button>
    </div>
  )
}
