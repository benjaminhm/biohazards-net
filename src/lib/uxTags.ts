/*
 * lib/uxTags.ts
 *
 * Admin UX/UI feature tagging system so the owner can mark any page, job
 * section, tab, or custom feature as:
 *
 *   - simplify : actively used — target for UX/UI & minimal-data-entry work
 *   - keep     : actively used — works well, keep as-is
 *   - ignore   : unused / archived / legacy — skip in UX audits & refactors
 *
 * Storage:
 *   - Persisted on `orgs.features` as `ux_tag:<key>` = { tag, note?, updatedAt }
 *     (same pattern as `menu_archived:<kind>:<id>` in lib/menuArchive.ts).
 *   - Anything archived via Job Manager (`menu_archived:* = true`) automatically
 *     resolves to `{ tag: 'ignore', source: 'menu_archived' }` unless explicitly
 *     overridden.
 *   - Mirrored to `docs/ux-audit-tags.json` in the repo (auto-written on
 *     localhost by POST /api/org/ux-tags, or synced from Supabase via
 *     `npm run ux-tags:sync`) so AI sessions always see your exact active vs
 *     ignored surfaces in code.
 */
import { HOME_SECTIONS } from '@/lib/jobHomeSections'
import { archivedMenuKeys } from '@/lib/menuArchive'

export const UX_TAG_PREFIX = 'ux_tag:'
export const UX_CONTEXT_EVENT = 'bh-ux-context'

export type UxTagStatus = 'simplify' | 'keep' | 'ignore'

export interface UxTagRecord {
  tag: UxTagStatus
  note?: string
  source?: 'manual' | 'menu_archived'
  updatedAt?: string
}

export interface UxCatalogItem {
  key: string
  group: 'section' | 'tab' | 'route'
  label: string
  file: string
}

export interface UxActiveContext {
  key: string
  label: string
  file?: string
}

const SECTION_FILES: Record<string, string> = {
  initial_contact: 'src/components/tabs/InitialContactTab.tsx',
  onsite_assessment: 'src/components/tabs/AssessmentTab.tsx',
  survey: 'src/components/tabs/HouseSurveyTab.tsx',
  scope_of_work: 'src/components/tabs/ScopeOfWorkTab.tsx',
  instant_quote: 'src/components/tabs/InstantQuoteTab.tsx',
  biohazard_cleaning: 'src/components/tabs/BiohazardCleaningQuoteTab.tsx',
  contents_clearance: 'src/components/tabs/ContentsClearanceQuoteTab.tsx',
  surface_area_cleaning: 'src/components/tabs/SurfaceAreaCleaningQuoteTab.tsx',
  quote: 'src/components/tabs/QuoteCaptureTab.tsx',
  legal: 'src/app/jobs/[id]/page.tsx',
  safety_compliance: 'src/app/jobs/[id]/page.tsx',
  plan: 'src/components/tabs/PreRemediationChecklistTab.tsx',
  execute: 'src/components/tabs/DisposalRecordSection.tsx',
  verify: 'src/components/tabs/PostRemediationEvaluationSection.tsx',
  company_letterhead: 'src/components/tabs/CompanyLetterheadTab.tsx',
  statement: 'src/components/tabs/StatementOfAccountsTab.tsx',
  payment_overdue: 'src/components/tabs/PaymentOverdueTab.tsx',
  review: 'src/app/jobs/[id]/page.tsx',
}

export const UX_JOB_TABS: UxCatalogItem[] = [
  { key: 'tab:dashboard', label: 'Job Dashboard', group: 'tab', file: 'src/components/tabs/JobDocsDashboardTab.tsx' },
  { key: 'tab:photos', label: 'Photos', group: 'tab', file: 'src/components/tabs/PhotosTab.tsx' },
  { key: 'tab:docs', label: 'Docs (Compose & History)', group: 'tab', file: 'src/components/tabs/DocumentsTab.tsx' },
  { key: 'tab:details', label: 'Client Details', group: 'tab', file: 'src/components/tabs/ClientDetailsTab.tsx' },
  { key: 'tab:timeline', label: 'Timeline', group: 'tab', file: 'src/components/tabs/TimelineTab.tsx' },
  { key: 'tab:messages', label: 'Messages / SMS', group: 'tab', file: 'src/components/tabs/MessagesTab.tsx' },
  { key: 'tab:case_studies', label: 'Case Studies', group: 'tab', file: 'src/app/jobs/[id]/page.tsx' },
  { key: 'tab:prestart_briefing', label: 'Pre-start Briefing', group: 'tab', file: 'src/components/tabs/PreStartBriefingTab.tsx' },
  { key: 'tab:company_letter', label: 'Company Letter', group: 'tab', file: 'src/components/tabs/CompanyLetterTab.tsx' },
]

export const UX_ROUTES: UxCatalogItem[] = [
  { key: 'route:/', label: 'Home Dashboard', group: 'route', file: 'src/app/page.tsx' },
  { key: 'route:/workspace', label: 'Agent Workspace', group: 'route', file: 'src/app/workspace/page.tsx' },
  { key: 'route:/jobs/queue', label: 'Job Manager', group: 'route', file: 'src/app/jobs/queue/page.tsx' },
  { key: 'route:/jobs/new', label: 'New Job Form', group: 'route', file: 'src/app/jobs/new/page.tsx' },
  { key: 'route:/accounts', label: 'Trade Accounts', group: 'route', file: 'src/app/accounts/page.tsx' },
  { key: 'route:/records', label: 'Job Records', group: 'route', file: 'src/app/records/page.tsx' },
  { key: 'route:/inventory', label: 'Inventory Manager', group: 'route', file: 'src/app/inventory/page.tsx' },
  { key: 'route:/calls', label: 'Calls', group: 'route', file: 'src/app/calls/page.tsx' },
  { key: 'route:/consultation', label: 'Consultation', group: 'route', file: 'src/app/consultation/page.tsx' },
  { key: 'route:/brain-dump', label: 'Brain Dump', group: 'route', file: 'src/app/brain-dump/page.tsx' },
  { key: 'route:/knowledge-base', label: 'Knowledge Base', group: 'route', file: 'src/app/knowledge-base/page.tsx' },
  { key: 'route:/settings', label: 'Settings', group: 'route', file: 'src/app/settings/page.tsx' },
]

export const UX_SECTIONS: UxCatalogItem[] = HOME_SECTIONS.map(s => ({
  key: `section:${s.id}`,
  group: 'section',
  label: s.label,
  file: SECTION_FILES[s.id] ?? 'src/app/jobs/[id]/page.tsx',
}))

export const UX_CATALOG: UxCatalogItem[] = [
  ...UX_SECTIONS,
  ...UX_JOB_TABS,
  ...UX_ROUTES,
]

const CATALOG_BY_KEY = new Map(UX_CATALOG.map(item => [item.key, item]))

const VALID_TAGS = new Set<UxTagStatus>(['simplify', 'keep', 'ignore'])
const KEY_RE = /^(section:[a-z0-9_]{1,60}|tab:[a-z0-9_]{1,60}|route:\/[a-z0-9/_-]{0,100}|feature:[a-z0-9_-]{1,80})$/

export function isUxTagStatus(v: unknown): v is UxTagStatus {
  return typeof v === 'string' && VALID_TAGS.has(v as UxTagStatus)
}

export function parseUxTagKey(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return KEY_RE.test(trimmed) ? trimmed : null
}

/** Normalize a freeform feature name into a valid `feature:<slug>` key. */
export function makeFeatureTagKey(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
  return slug ? `feature:${slug}` : null
}

export function catalogItemForKey(key: string): UxCatalogItem | null {
  return CATALOG_BY_KEY.get(key) ?? null
}

/** Map a browser pathname to the closest route catalog item. */
export function routeContextFromPathname(pathname: string | null | undefined): UxActiveContext {
  const clean = (pathname ?? '/').replace(/\/+$/, '') || '/'
  const exact = CATALOG_BY_KEY.get(`route:${clean}`)
  if (exact) return { key: exact.key, label: exact.label, file: exact.file }
  if (clean.startsWith('/jobs/') && clean.includes('/docs/')) {
    return { key: 'tab:docs', label: 'Doc Editor', file: 'src/app/jobs/[id]/docs/[type]/page.tsx' }
  }
  if (clean.startsWith('/records/')) {
    return { key: 'route:/records', label: 'Job Records', file: 'src/app/records/page.tsx' }
  }
  if (clean.startsWith('/accounts/')) {
    return { key: 'route:/accounts', label: 'Trade Accounts', file: 'src/app/accounts/[id]/page.tsx' }
  }
  if (clean.startsWith('/knowledge-base/')) {
    return { key: 'route:/knowledge-base', label: 'Knowledge Base', file: 'src/app/knowledge-base/page.tsx' }
  }
  const normalized = clean.toLowerCase().replace(/[^a-z0-9/_-]/g, '')
  return { key: `route:${normalized || '/'}`, label: clean }
}

/**
 * Extract resolved UX tags from `orgs.features`.
 * Explicit `ux_tag:*` records take precedence; `menu_archived:*` entries default
 * to `{ tag: 'ignore', source: 'menu_archived' }`.
 */
export function resolveUxTags(
  features: Record<string, unknown> | null | undefined,
): Record<string, UxTagRecord> {
  const out: Record<string, UxTagRecord> = {}

  // 1. Seed archived menu items as ignore
  const archived = archivedMenuKeys(features)
  for (const key of archived) {
    out[key] = { tag: 'ignore', source: 'menu_archived' }
  }

  // 2. Apply explicit manual tags
  for (const [k, raw] of Object.entries(features ?? {})) {
    if (!k.startsWith(UX_TAG_PREFIX)) continue
    const key = parseUxTagKey(k.slice(UX_TAG_PREFIX.length))
    if (!key || !raw || typeof raw !== 'object') continue
    const rec = raw as { tag?: unknown; note?: unknown; updatedAt?: unknown }
    if (!isUxTagStatus(rec.tag)) continue
    out[key] = {
      tag: rec.tag,
      note: typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim() : undefined,
      source: 'manual',
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : undefined,
    }
  }

  return out
}

/** Return updated `orgs.features` with one tag set or cleared (`tag === null`). */
export function applyUxTag(
  features: Record<string, unknown> | null | undefined,
  key: string,
  tag: UxTagStatus | null,
  note?: string | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(features ?? {}) }
  const featureKey = `${UX_TAG_PREFIX}${key}`
  if (tag === null) {
    delete next[featureKey]
  } else {
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 280) : ''
    next[featureKey] = {
      tag,
      ...(cleanNote ? { note: cleanNote } : {}),
      updatedAt: new Date().toISOString(),
    }
  }
  return next
}

export interface UxAuditManifestEntry {
  key: string
  label: string
  file?: string
  note?: string
  source?: 'manual' | 'menu_archived'
  updatedAt?: string
}

export interface UxAuditManifest {
  $comment: string
  updatedAt: string
  simplify: UxAuditManifestEntry[]
  keep: UxAuditManifestEntry[]
  ignore: UxAuditManifestEntry[]
  untagged: UxAuditManifestEntry[]
}

/**
 * Build the structured repo manifest (`docs/ux-audit-tags.json`) that AI
 * assistants read directly in code.
 */
export function buildUxAuditManifest(
  features: Record<string, unknown> | null | undefined,
): UxAuditManifest {
  const resolved = resolveUxTags(features)
  const simplify: UxAuditManifestEntry[] = []
  const keep: UxAuditManifestEntry[] = []
  const ignore: UxAuditManifestEntry[] = []
  const untagged: UxAuditManifestEntry[] = []

  const seen = new Set<string>()

  const pushEntry = (key: string, label: string, file?: string) => {
    seen.add(key)
    const rec = resolved[key]
    const entry: UxAuditManifestEntry = {
      key,
      label,
      ...(file ? { file } : {}),
      ...(rec?.note ? { note: rec.note } : {}),
      ...(rec?.source ? { source: rec.source } : {}),
      ...(rec?.updatedAt ? { updatedAt: rec.updatedAt } : {}),
    }
    if (!rec) untagged.push(entry)
    else if (rec.tag === 'simplify') simplify.push(entry)
    else if (rec.tag === 'keep') keep.push(entry)
    else ignore.push(entry)
  }

  for (const item of UX_CATALOG) {
    pushEntry(item.key, item.label, item.file)
  }

  // Include any custom `feature:*` or unlisted `route:*` tags at the end
  for (const [key, rec] of Object.entries(resolved)) {
    if (seen.has(key)) continue
    const label = key.startsWith('feature:')
      ? key.slice('feature:'.length).replace(/-/g, ' ')
      : key
    const entry: UxAuditManifestEntry = {
      key,
      label,
      ...(rec.note ? { note: rec.note } : {}),
      ...(rec.source ? { source: rec.source } : {}),
      ...(rec.updatedAt ? { updatedAt: rec.updatedAt } : {}),
    }
    if (rec.tag === 'simplify') simplify.push(entry)
    else if (rec.tag === 'keep') keep.push(entry)
    else ignore.push(entry)
  }

  return {
    $comment:
      'Generated by the in-app UX Feature Tagger (src/components/UxTagger.tsx) and synced from orgs.features. AI assistants: IGNORE everything in `ignore`, focus UX/UI simplification on `simplify`, and preserve `keep`.',
    updatedAt: new Date().toISOString(),
    simplify,
    keep,
    ignore,
    untagged,
  }
}
