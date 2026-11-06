'use client'

/*
 * lib/jobEmbed.ts
 *
 * The Agent view shows the Classic job page in a same-origin iframe. This is
 * the bridge between the two windows.
 *
 *   workspace → job page   REFRESH       re-fetch quietly (no spinner, no lost edits)
 *   job page → workspace   REFRESH_ACK   the refresh was handled
 *   job page → workspace   CHANGED       something was saved; reload drafts and markers
 *
 * Embedded means window.self !== window.top. sessionStorage is shared with the
 * top window, so it cannot tell the two apart.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'

export const JOB_EMBED_MSG = {
  refresh: 'bh-job-embed:refresh',
  refreshAck: 'bh-job-embed:refresh-ack',
  changed: 'bh-job-embed:changed',
} as const

function readEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

const noopSubscribe = () => () => {}

/** True inside the Agent view's job panel. False on the server and on first paint. */
export function useIsEmbedded(): boolean {
  return useSyncExternalStore(noopSubscribe, readEmbedded, () => false)
}

let fetchPatched = false
let changedTimer: ReturnType<typeof setTimeout> | null = null

function notifyChanged() {
  if (changedTimer) clearTimeout(changedTimer)
  changedTimer = setTimeout(() => {
    window.parent.postMessage({ type: JOB_EMBED_MSG.changed }, window.location.origin)
  }, 600)
}

function isSameOriginApiWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method === 'GET' || method === 'HEAD') return false
  const raw = input instanceof Request ? input.url : String(input)
  try {
    const url = new URL(raw, window.location.href)
    return url.origin === window.location.origin && url.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function installSaveNotifier() {
  if (fetchPatched) return
  fetchPatched = true
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const res = await original(input, init)
    if (res.ok && isSameOriginApiWrite(input, init)) notifyChanged()
    return res
  }
}

/**
 * Wire an embedded Classic job page to the workspace. No-op when not embedded.
 * Links that would leave this job open in a new tab instead of stranding the panel.
 */
export function useJobEmbedBridge(jobId: string, onRefresh?: () => void | Promise<void>) {
  const embedded = useIsEmbedded()
  const refreshRef = useRef(onRefresh)
  useEffect(() => {
    refreshRef.current = onRefresh
  })

  useEffect(() => {
    if (!embedded) return
    installSaveNotifier()

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== window.parent) return
      if (e.data?.type !== JOB_EMBED_MSG.refresh || !refreshRef.current) return
      window.parent.postMessage({ type: JOB_EMBED_MSG.refreshAck }, window.location.origin)
      void refreshRef.current()
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === `/jobs/${jobId}` || url.pathname.startsWith(`/jobs/${jobId}/`)) return
      e.preventDefault()
      window.open(url.href, '_blank', 'noopener')
    }

    window.addEventListener('message', onMessage)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('click', onClick, true)
    }
  }, [embedded, jobId])

  return embedded
}
