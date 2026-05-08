/*
 * lib/knowledgeBase/search.ts
 *
 * Client-side search over the article catalogue. Intentionally simple for v1:
 *   - Query tokenised by whitespace, lowercase, punctuation stripped.
 *   - Per-article score = weighted sum of token hits in title/tags/summary/body.
 *   - Results sorted by score desc, capped by `limit`.
 *   - Each result includes a short `snippet` extracted from the first body
 *     block containing any query token.
 *
 * This is a deliberately small surface area. Postgres FTS with ts_rank_cd,
 * pg_trgm, and snippet generation (`ts_headline`) is the v2 upgrade path when
 * content volume grows beyond ~100 articles.
 */

import type { ArticleDoc, Block, CategoryId } from './types'

export interface SearchResult {
  article: ArticleDoc
  score: number
  /** Plain-text snippet (<= 160 chars) with the matched phrase near the centre. */
  snippet: string
  /** Which block types contributed hits — useful for debugging, ignored in UI for now. */
  hitIn: Array<'title' | 'tags' | 'summary' | 'body'>
}

export interface SearchOpts {
  limit?: number
  /** Restrict to a single category. Omit for "all categories". */
  category?: CategoryId
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'at', 'by', 'it', 'this', 'that', 'from',
])

function tokenise(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
}

/**
 * Walks a Block and returns its plain-text content for indexing/snippeting.
 * Keeps headings inline so a search for "dwell time" matches "Dwell time
 * matters more than concentration" even when the phrase lives in a callout.
 */
function blockText(block: Block): string {
  switch (block.type) {
    case 'p': return block.text
    case 'h2':
    case 'h3': return block.text
    case 'ul':
    case 'ol': return block.items.join(' ')
    case 'callout': return [block.title ?? '', block.text].filter(Boolean).join(' ')
    case 'table': return [block.headers.join(' '), ...block.rows.map(r => r.join(' '))].join(' ')
    case 'code': return block.text
  }
}

/** All body text concatenated — used both for scoring and snippet extraction. */
function flatBody(article: ArticleDoc): string {
  return article.blocks.map(blockText).join('\n')
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++
    i += needle.length
  }
  return count
}

function makeSnippet(body: string, firstToken: string): string {
  const needle = firstToken.toLowerCase()
  const idx = body.toLowerCase().indexOf(needle)
  if (idx === -1) {
    return body.slice(0, 160).trim() + (body.length > 160 ? '…' : '')
  }
  const radius = 70
  const start = Math.max(0, idx - radius)
  const end = Math.min(body.length, idx + needle.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  return (prefix + body.slice(start, end).replace(/\s+/g, ' ').trim() + suffix)
}

const W_TITLE = 10
const W_TAG = 6
const W_SUMMARY = 3
const W_BODY = 1

export function searchArticles(
  query: string,
  articles: ArticleDoc[],
  opts: SearchOpts = {}
): SearchResult[] {
  const { limit = 20, category } = opts
  const tokens = tokenise(query)
  if (tokens.length === 0) return []

  const pool = category ? articles.filter(a => a.category === category) : articles
  const results: SearchResult[] = []

  for (const article of pool) {
    const titleLc = article.title.toLowerCase()
    const summaryLc = article.summary.toLowerCase()
    const tagsLc = article.tags.map(t => t.toLowerCase())
    const body = flatBody(article)
    const bodyLc = body.toLowerCase()

    let score = 0
    const hitIn: SearchResult['hitIn'] = []

    for (const t of tokens) {
      const tHits = countOccurrences(titleLc, t)
      if (tHits > 0) { score += tHits * W_TITLE; if (!hitIn.includes('title')) hitIn.push('title') }

      const tagHits = tagsLc.filter(tg => tg.includes(t)).length
      if (tagHits > 0) { score += tagHits * W_TAG; if (!hitIn.includes('tags')) hitIn.push('tags') }

      const summaryHits = countOccurrences(summaryLc, t)
      if (summaryHits > 0) { score += summaryHits * W_SUMMARY; if (!hitIn.includes('summary')) hitIn.push('summary') }

      const bodyHits = countOccurrences(bodyLc, t)
      if (bodyHits > 0) { score += Math.min(bodyHits, 8) * W_BODY; if (!hitIn.includes('body')) hitIn.push('body') }
    }

    // Exact phrase bonus — reward contiguous matches.
    const phrase = tokens.join(' ')
    if (titleLc.includes(phrase)) score += W_TITLE * 2
    else if (bodyLc.includes(phrase)) score += W_BODY * 5

    if (score > 0) {
      results.push({
        article,
        score,
        snippet: makeSnippet(body, tokens[0]),
        hitIn,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}
