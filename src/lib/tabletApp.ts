'use client'

/*
 * lib/tabletApp.ts
 *
 * Detection + typed native bridge for the Android tablet APK
 * (net.biohazards.data / BiohazardsDataEntry).
 *
 * Works both in the top window and inside the same-origin JobPanel iframe.
 */
import { useSyncExternalStore } from 'react'

export type NativeHapticKind = 'light' | 'confirm' | 'warning'
export type AppTheme = 'light' | 'dark'

export interface NativeVoiceEventDetail {
  type: 'start' | 'partial' | 'final' | 'end' | 'error'
  text?: string
  error?: string
}

export interface BiohazardsNativeBridge {
  setTheme?: (mode: AppTheme) => void
  setKeepScreenOn?: (enabled: boolean) => void
  isKeepScreenOn?: () => boolean
  haptic?: (kind: NativeHapticKind) => void
  hasVoice?: () => boolean
  startVoice?: (lang?: string) => void
  stopVoice?: () => void
  speak?: (text: string) => void
  stopSpeaking?: () => void
  isOnline?: () => boolean
}

declare global {
  interface Window {
    __bhDataEntry?: boolean
    BiohazardsNative?: BiohazardsNativeBridge
  }
}

/** Tabs kept off the tablet APK (cloud PDF generation, letters, signing). */
export const TABLET_HIDDEN_TABS = new Set<string>(['docs', 'company_letter'])

/** Home workflow sections kept off the tablet APK (office/accounts PDFs). */
export const TABLET_HIDDEN_HOME_SECTIONS = new Set<string>([
  'company_letterhead',
  'statement',
  'payment_overdue',
])

/** Dashboard tiles kept off the tablet APK (office/admin-only surfaces). */
export const TABLET_HIDDEN_DASHBOARD_HREFS = new Set<string>([
  '/records',
  '/accounts',
])

export function getNativeBridge(): BiohazardsNativeBridge | null {
  if (typeof window === 'undefined') return null
  if (window.BiohazardsNative) return window.BiohazardsNative
  try {
    if (window.top && window.top !== window && window.top.BiohazardsNative) {
      return window.top.BiohazardsNative
    }
  } catch {
    /* cross-origin guard */
  }
  return null
}

export function isTabletApp(): boolean {
  if (typeof window === 'undefined') return false
  if (window.__bhDataEntry || window.BiohazardsNative) return true
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('BiohazardsDataEntry')) {
    return true
  }
  try {
    if (window.top && window.top !== window && (window.top.__bhDataEntry || window.top.BiohazardsNative)) {
      return true
    }
  } catch {
    /* cross-origin guard */
  }
  return false
}

const noopSubscribe = () => () => {}

/** Hydration-safe hook: false during SSR, true inside the Android tablet APK. */
export function useIsTabletApp(): boolean {
  return useSyncExternalStore(noopSubscribe, isTabletApp, () => false)
}

export function syncNativeTheme(mode: AppTheme) {
  try {
    getNativeBridge()?.setTheme?.(mode)
  } catch {
    /* ignore */
  }
}

export function triggerNativeHaptic(kind: NativeHapticKind = 'light') {
  try {
    getNativeBridge()?.haptic?.(kind)
  } catch {
    /* ignore */
  }
}

export function setNativeKeepScreenOn(enabled: boolean) {
  try {
    getNativeBridge()?.setKeepScreenOn?.(enabled)
  } catch {
    /* ignore */
  }
}

export function readNativeKeepScreenOn(): boolean {
  try {
    return Boolean(getNativeBridge()?.isKeepScreenOn?.())
  } catch {
    return false
  }
}

export function hasNativeVoice(): boolean {
  try {
    return Boolean(getNativeBridge()?.hasVoice?.())
  } catch {
    return false
  }
}

export function startNativeVoice(lang = 'en-AU') {
  try {
    getNativeBridge()?.startVoice?.(lang)
  } catch {
    /* ignore */
  }
}

export function stopNativeVoice() {
  try {
    getNativeBridge()?.stopVoice?.()
  } catch {
    /* ignore */
  }
}

export function nativeSpeak(text: string): boolean {
  const bridge = getNativeBridge()
  if (!bridge?.speak) return false
  try {
    bridge.speak(text)
    return true
  } catch {
    return false
  }
}

export function nativeStopSpeaking(): boolean {
  const bridge = getNativeBridge()
  if (!bridge?.stopSpeaking) return false
  try {
    bridge.stopSpeaking()
    return true
  } catch {
    return false
  }
}

function readOnline(): boolean {
  if (typeof window === 'undefined') return true
  const bridge = getNativeBridge()
  if (bridge?.isOnline) {
    try {
      return Boolean(bridge.isOnline())
    } catch {
      /* fall through */
    }
  }
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

function subscribeOnline(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onNative = () => cb()
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  window.addEventListener('bh-native-connectivity', onNative)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
    window.removeEventListener('bh-native-connectivity', onNative)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, () => true)
}
