/*
 * lib/knowledgeBase/types.ts
 *
 * Data model for the Knowledge Base.
 *
 * Articles are authored as typed data (not markdown) so v1 has zero parser
 * deps, strong compile-time safety, and trivially-searchable plain text per
 * block. A v2 could swap `ArticleDoc` for DB rows without touching the
 * renderer — the renderer only reads `Block[]`.
 *
 * Block IDs: h2/h3 blocks carry their own `id` so the renderer can anchor
 * them (deep-link to `#section-id`) and the TOC can build a stable outline.
 * Authors pick kebab-case IDs that won't collide within an article.
 */

export type CategoryId = 'biohazards' | 'chemicals' | 'ppe' | 'procedures'

/**
 * Source layer for an article. v1 ships platform-only content; the
 * `org` variant is reserved so future org-authored SOPs render with the
 * same pipeline and carry a visible badge that distinguishes them.
 */
export type ArticleSource = 'platform' | 'org'

/** Inline callouts — keep the variants few and named for meaning, not colour. */
export type CalloutVariant = 'info' | 'warning' | 'danger' | 'tip'

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h2'; id: string; text: string }
  | { type: 'h3'; id: string; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'callout'; variant: CalloutVariant; title?: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; text: string }

export interface ArticleDoc {
  /** URL slug; must be unique across the catalogue. */
  slug: string
  title: string
  category: CategoryId
  /** One-line summary used in search results and category listings. */
  summary: string
  /** Free-form keywords that boost search ranking without polluting prose. */
  tags: string[]
  /** ISO date (YYYY-MM-DD) — renders as "Updated <date>" in the article header. */
  lastUpdated: string
  source: ArticleSource
  /** The article body. Order matters; renderer walks top-to-bottom. */
  blocks: Block[]
  /** Slugs of related articles shown at the bottom of the reader. */
  related?: string[]
  /**
   * If true, article is surfaced on the landing page under "Featured".
   * Keep this list short (< 6) — it's a curation signal, not a flag dump.
   */
  featured?: boolean
}

export interface CategoryDef {
  id: CategoryId
  label: string
  /** Single emoji used in tiles and the sidebar. */
  icon: string
  /** Short sentence shown under the label on the category tile. */
  description: string
  /** Accent colour for category tiles (uses --blue/--red/etc. from globals). */
  accent: string
}
