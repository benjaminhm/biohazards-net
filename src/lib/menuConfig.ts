/*
 * lib/menuConfig.ts
 *
 * Org-wide job file menu customisation (ordering, custom labels, and hiding).
 * Stored on orgs.features so /api/me delivers it everywhere without an extra
 * round trip:
 *   - menu_section_order: string[]            (HomeSection IDs in display order)
 *   - menu_tab_order:     string[]            (Job tab IDs in display order)
 *   - menu_labels:        Record<string, string>  ('section:<id>' | 'tab:<id>' → label)
 *   - menu_archived:<kind>:<id>: true         (see lib/menuArchive.ts)
 */
import { MENU_ARCHIVE_PREFIX, type MenuItemKind, menuItemKey } from './menuArchive'
import { UX_TAG_PREFIX } from './uxTags'

export const MENU_SECTION_ORDER_KEY = 'menu_section_order'
export const MENU_TAB_ORDER_KEY = 'menu_tab_order'
export const MENU_LABELS_KEY = 'menu_labels'
export const ORG_FEATURES_UPDATED_EVENT = 'bh-org-features-updated'

const ID_PATTERN = /^[a-z0-9_]{1,60}$/
const KEY_PATTERN = /^(section|tab):[a-z0-9_]{1,60}$/
const MAX_IDS = 100
const MAX_LABEL_LEN = 60

export interface MenuConfig {
  sectionOrder: string[]
  tabOrder: string[]
  labels: Record<string, string>
}

export interface MenuConfigPatch {
  sectionOrder?: string[]
  tabOrder?: string[]
  /** Map of `<kind>:<id>` → custom label. Empty string clears the override. */
  labels?: Record<string, string>
  /** Keys (`<kind>:<id>`) to archive/hide. */
  archivedKeys?: string[]
  /** Keys (`<kind>:<id>`) to restore/show (also clears ux_tag ignore if set). */
  restoredKeys?: string[]
  /** When true, resets custom order and custom labels back to defaults. */
  reset?: boolean
}

export function readMenuConfig(features: Record<string, unknown> | null | undefined): MenuConfig {
  const f = features ?? {}
  const rawSec = f[MENU_SECTION_ORDER_KEY]
  const rawTab = f[MENU_TAB_ORDER_KEY]
  const rawLabels = f[MENU_LABELS_KEY]

  const sectionOrder = Array.isArray(rawSec)
    ? rawSec.filter((v): v is string => typeof v === 'string' && ID_PATTERN.test(v))
    : []
  const tabOrder = Array.isArray(rawTab)
    ? rawTab.filter((v): v is string => typeof v === 'string' && ID_PATTERN.test(v))
    : []

  const labels: Record<string, string> = {}
  if (rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)) {
    for (const [k, v] of Object.entries(rawLabels as Record<string, unknown>)) {
      if (KEY_PATTERN.test(k) && typeof v === 'string') {
        const trimmed = v.trim().slice(0, MAX_LABEL_LEN)
        if (trimmed) labels[k] = trimmed
      }
    }
  }

  return { sectionOrder, tabOrder, labels }
}

export function customMenuLabel(
  kind: MenuItemKind,
  id: string,
  fallback: string,
  config: MenuConfig,
): string {
  const custom = config.labels[menuItemKey(kind, id)]
  return custom && custom.trim() ? custom.trim() : fallback
}

export function orderMenuItems<T extends { id: string }>(
  items: T[],
  order: string[],
): T[] {
  if (!order.length) return items
  const rank = new Map<string, number>()
  order.forEach((id, idx) => {
    if (!rank.has(id)) rank.set(id, idx)
  })
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return 0
  })
}

export function applyOrderAndLabels<T extends { id: string; label: string }>(
  items: T[],
  kind: MenuItemKind,
  config: MenuConfig,
): T[] {
  const order = kind === 'section' ? config.sectionOrder : config.tabOrder
  return orderMenuItems(items, order).map(item => {
    const custom = config.labels[menuItemKey(kind, item.id)]
    return custom ? { ...item, label: custom } : item
  })
}

export function hasCustomMenuConfig(config: MenuConfig): boolean {
  return (
    config.sectionOrder.length > 0 ||
    config.tabOrder.length > 0 ||
    Object.keys(config.labels).length > 0
  )
}

function parseIdList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_IDS) return null
  if (!v.every(x => typeof x === 'string' && ID_PATTERN.test(x))) return null
  return [...new Set(v as string[])]
}

function parseKeyList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_IDS) return null
  if (!v.every(x => typeof x === 'string' && KEY_PATTERN.test(x))) return null
  return [...new Set(v as string[])]
}

/** Validate POST /api/org/menu-config payload. Returns null if malformed. */
export function parseMenuConfigPatch(raw: unknown): MenuConfigPatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  const patch: MenuConfigPatch = {}

  if (body.reset !== undefined) {
    if (typeof body.reset !== 'boolean') return null
    patch.reset = body.reset
  }

  if (body.sectionOrder !== undefined) {
    const parsed = parseIdList(body.sectionOrder)
    if (!parsed) return null
    patch.sectionOrder = parsed
  }

  if (body.tabOrder !== undefined) {
    const parsed = parseIdList(body.tabOrder)
    if (!parsed) return null
    patch.tabOrder = parsed
  }

  if (body.labels !== undefined) {
    if (!body.labels || typeof body.labels !== 'object' || Array.isArray(body.labels)) return null
    const entries = Object.entries(body.labels as Record<string, unknown>)
    if (entries.length > MAX_IDS) return null
    const labels: Record<string, string> = {}
    for (const [k, v] of entries) {
      if (!KEY_PATTERN.test(k) || typeof v !== 'string') return null
      labels[k] = v.trim().slice(0, MAX_LABEL_LEN)
    }
    patch.labels = labels
  }

  if (body.archivedKeys !== undefined) {
    const parsed = parseKeyList(body.archivedKeys)
    if (!parsed) return null
    patch.archivedKeys = parsed
  }

  if (body.restoredKeys !== undefined) {
    const parsed = parseKeyList(body.restoredKeys)
    if (!parsed) return null
    patch.restoredKeys = parsed
  }

  return patch
}

export function applyMenuConfig(
  features: Record<string, unknown> | null | undefined,
  patch: MenuConfigPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(features ?? {}) }

  if (patch.reset) {
    delete next[MENU_SECTION_ORDER_KEY]
    delete next[MENU_TAB_ORDER_KEY]
    delete next[MENU_LABELS_KEY]
  }

  if (patch.sectionOrder !== undefined) {
    if (patch.sectionOrder.length > 0) next[MENU_SECTION_ORDER_KEY] = patch.sectionOrder
    else delete next[MENU_SECTION_ORDER_KEY]
  }

  if (patch.tabOrder !== undefined) {
    if (patch.tabOrder.length > 0) next[MENU_TAB_ORDER_KEY] = patch.tabOrder
    else delete next[MENU_TAB_ORDER_KEY]
  }

  if (patch.labels !== undefined) {
    const existing = readMenuConfig(next).labels
    const merged: Record<string, string> = { ...existing }
    for (const [k, v] of Object.entries(patch.labels)) {
      const trimmed = v.trim().slice(0, MAX_LABEL_LEN)
      if (trimmed) merged[k] = trimmed
      else delete merged[k]
    }
    if (Object.keys(merged).length > 0) next[MENU_LABELS_KEY] = merged
    else delete next[MENU_LABELS_KEY]
  }

  if (patch.archivedKeys) {
    for (const key of patch.archivedKeys) {
      next[MENU_ARCHIVE_PREFIX + key] = true
    }
  }

  if (patch.restoredKeys) {
    for (const key of patch.restoredKeys) {
      delete next[MENU_ARCHIVE_PREFIX + key]
      // If an item was hidden via ux_tag:ignore, un-ignore it so Restore takes effect.
      if (next[UX_TAG_PREFIX + key] === 'ignore') {
        next[UX_TAG_PREFIX + key] = 'keep'
      }
    }
  }

  return next
}

/** Notify other components in the same window that org.features changed. */
export function broadcastOrgFeatures(features: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ORG_FEATURES_UPDATED_EVENT, { detail: features }))
}
