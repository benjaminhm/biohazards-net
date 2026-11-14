/*
 * lib/menuArchive.ts
 *
 * Job file menu items an admin has archived for the whole organisation. Stored
 * on orgs.features as `menu_archived:<kind>:<id>` = true, so /api/me already
 * delivers them. Archiving only hides an item from the menu; its data and
 * links are untouched.
 */

export const MENU_ARCHIVE_PREFIX = 'menu_archived:'

export type MenuItemKind = 'section' | 'tab'

const KEY_PATTERN = /^(section|tab):[a-z0-9_]{1,60}$/
const MAX_KEYS = 100

export function menuItemKey(kind: MenuItemKind, id: string): string {
  return `${kind}:${id}`
}

export function archivedMenuKeys(features: Record<string, unknown> | null | undefined): Set<string> {
  const keys = new Set<string>()
  for (const [k, v] of Object.entries(features ?? {})) {
    if (v === true && k.startsWith(MENU_ARCHIVE_PREFIX)) keys.add(k.slice(MENU_ARCHIVE_PREFIX.length))
  }
  return keys
}

export function splitArchived<T extends { id: string }>(
  items: T[],
  kind: MenuItemKind,
  archived: Set<string>,
): { shown: T[]; archived: T[] } {
  const shown: T[] = []
  const hidden: T[] = []
  for (const item of items) (archived.has(menuItemKey(kind, item.id)) ? hidden : shown).push(item)
  return { shown, archived: hidden }
}

/** Valid item keys from a request body, or null if the body is malformed. */
export function parseMenuKeys(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_KEYS) return null
  if (!v.every(k => typeof k === 'string' && KEY_PATTERN.test(k))) return null
  return [...new Set(v as string[])]
}

/** The org's features with the given items archived or restored. Other features are kept. */
export function applyMenuArchive(
  features: Record<string, unknown> | null | undefined,
  keys: string[],
  archived: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(features ?? {}) }
  for (const key of keys) {
    if (archived) next[MENU_ARCHIVE_PREFIX + key] = true
    else delete next[MENU_ARCHIVE_PREFIX + key]
  }
  return next
}
