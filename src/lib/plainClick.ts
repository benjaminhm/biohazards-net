import type { MouseEvent } from 'react'

/**
 * A left click with no modifier keys. Links that handle a click in place (select
 * in a side panel, switch tab) should only take over these, so Cmd/Ctrl/Shift
 * clicks still open the href in a new tab or window.
 */
export function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
