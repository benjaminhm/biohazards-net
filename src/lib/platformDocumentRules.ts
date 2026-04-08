/*
 * lib/platformDocumentRules.ts
 *
 * Loads platform_document_rules from Supabase (service client). Used by
 * build-document, chat-document, and edit-document to layer platform text
 * rules between the code baseline and org company_profile.document_rules.
 */

import { createServiceClient } from '@/lib/supabase'
import type { DocType } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'

const DOC_TYPE_IDS = new Set<string>(Object.keys(DOC_TYPE_LABELS))
const TEMPLATE_JSON_SUFFIX = '_template_json'
const MAX_TEMPLATE_JSON_CHARS = 120_000

function isAllowedPlatformRuleKey(key: string): boolean {
  if (key === 'general') return true
  if (DOC_TYPE_IDS.has(key)) return true
  if (key.endsWith('_pdf')) {
    const base = key.slice(0, -'_pdf'.length)
    return DOC_TYPE_IDS.has(base)
  }
  if (key.endsWith(TEMPLATE_JSON_SUFFIX)) {
    const base = key.slice(0, -TEMPLATE_JSON_SUFFIX.length)
    return DOC_TYPE_IDS.has(base)
  }
  return false
}

function isReasonableStylePdfUrl(s: string): boolean {
  if (s.length > 2048) return false
  return /^https?:\/\//i.test(s.trim())
}

export type PlatformDocumentRulesMap = Record<string, string>

/** document_rules JSON shape: general + per DocType text, plus optional [type]_pdf URLs (not a separate JSON file — one JSONB column in Postgres). */
function sanitizeRules(raw: unknown): PlatformDocumentRulesMap {
  if (!raw || typeof raw !== 'object') return {}
  const out: PlatformDocumentRulesMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAllowedPlatformRuleKey(k)) continue
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t) continue
    if (k.endsWith('_pdf')) {
      if (!isReasonableStylePdfUrl(t)) continue
      out[k] = t
    } else if (k.endsWith(TEMPLATE_JSON_SUFFIX)) {
      if (t.length > MAX_TEMPLATE_JSON_CHARS) continue
      out[k] = t
    } else {
      out[k] = t
    }
  }
  return out
}

/** Single-row read; returns {} if missing or error. */
export async function fetchPlatformDocumentRules(): Promise<PlatformDocumentRulesMap> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('platform_document_rules')
    .select('document_rules')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data?.document_rules) return {}
  return sanitizeRules(data.document_rules)
}

export function sanitizePlatformDocumentRulesInput(raw: unknown): PlatformDocumentRulesMap {
  return sanitizeRules(raw)
}
