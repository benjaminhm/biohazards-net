/*
 * lib/knowledgeBase/articles/index.ts
 *
 * Single source of truth for every platform-authored article. Add new
 * articles by dropping a file in this folder and importing it here.
 *
 * ARTICLES is intentionally a const array so the types, search, and page
 * routing can all derive from the same list. Slugs must be unique — a
 * dev-time assertion below fails noisily if two articles collide.
 */

import type { ArticleDoc } from '../types'
import { bloodbornePathogensOverview } from './bloodborne-pathogens-overview'
import { hepatitisBVirusHbv } from './hepatitis-b-virus-hbv'
import { sodiumHypochloriteSds } from './sodium-hypochlorite-sds'
import { ppeLevelsGuide } from './ppe-levels-guide'
import { traumaSceneCleanupSop } from './trauma-scene-cleanup-sop'
import { decontaminationSequenceSop } from './decontamination-sequence-sop'

export const ARTICLES: ArticleDoc[] = [
  bloodbornePathogensOverview,
  hepatitisBVirusHbv,
  sodiumHypochloriteSds,
  ppeLevelsGuide,
  traumaSceneCleanupSop,
  decontaminationSequenceSop,
]

// Dev-time sanity check — dedupe slugs at module load, not at search time.
{
  const seen = new Set<string>()
  for (const a of ARTICLES) {
    if (seen.has(a.slug)) {
      throw new Error(`Knowledge Base: duplicate article slug "${a.slug}"`)
    }
    seen.add(a.slug)
  }
}

export function getArticle(slug: string): ArticleDoc | undefined {
  return ARTICLES.find(a => a.slug === slug)
}

export function getArticlesByCategory(categoryId: string): ArticleDoc[] {
  return ARTICLES.filter(a => a.category === categoryId)
}

export function getFeaturedArticles(limit = 4): ArticleDoc[] {
  return ARTICLES.filter(a => a.featured === true).slice(0, limit)
}

export function getRelated(article: ArticleDoc): ArticleDoc[] {
  if (!article.related || article.related.length === 0) return []
  return article.related
    .map(slug => getArticle(slug))
    .filter((a): a is ArticleDoc => a !== undefined)
}
