/*
 * lib/documentRules.ts
 *
 * Layering (first → last in prompt; later sections refine earlier ones):
 *   1. Code baseline (PLATFORM_DOCUMENT_RULES_BASELINE) — not editable in UI
 *   2. platform_document_rules from DB — Platform → AI doc rules tab in /admin
 *   3. company_profile.document_rules — org Settings / job doc Instructions
 */

import type { CompanyProfile, DocType } from '@/lib/types'
import type { PlatformDocumentRulesMap } from '@/lib/platformDocumentRules'

/**
 * Always prepended to DOCUMENT RULES for build-document, chat-document, and edit-document.
 * Org admins extend via Settings → Document Rules; platform operators extend via /admin → AI doc rules.
 */
export const PLATFORM_DOCUMENT_RULES_BASELINE = `Platform policy (applies to every document on biohazards.net, in addition to organisation instructions below):

- These outputs are staff drafts for review; a human must approve anything client-facing (see product AI principles).
- Keep the exact JSON shape for this document type: use only the expected keys; do not add or remove top-level keys.
- Ground statements in the job context, assessment data, and photos supplied; do not invent site facts, dates, or incidents.
- Use clear, professional language suitable for Australian biohazard remediation; avoid marketing filler.
- Cite standards or legislation only when accurate and relevant to the described work.`

export function mergeDocumentRuleSections(
  ...sections: (string | undefined | null | false)[]
): string {
  return sections
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

export type DocumentRulesWrapVariant = 'generate' | 'edit'

export function wrapDocumentRulesBlock(
  mergedBody: string,
  variant: DocumentRulesWrapVariant = 'generate'
): string {
  const body = mergedBody.trim()
  if (!body) return ''
  const label =
    variant === 'edit'
      ? 'DOCUMENT RULES (biohazards.md — follow these strictly when rewriting content):'
      : 'DOCUMENT RULES (biohazards.md — follow these strictly):'
  return `\n${label}\n${body}\n`
}

/** Rules block for POST /api/build-document. */
export function getDocumentRulesForBuild(
  type: DocType,
  company: CompanyProfile | null,
  platformDbRules: PlatformDocumentRulesMap | null
): string {
  const org = company?.document_rules ?? {}
  const plat = platformDbRules ?? {}
  const body = mergeDocumentRuleSections(
    PLATFORM_DOCUMENT_RULES_BASELINE,
    plat.general,
    plat[type],
    org.general,
    org[type]
  )
  return wrapDocumentRulesBlock(body, 'generate')
}

/** Rules block for POST /api/chat-document (client sends merged org general + type text). */
export function getDocumentRulesForChat(
  type: DocType,
  orgRulesFromClient: string | undefined,
  platformDbRules: PlatformDocumentRulesMap | null
): string {
  const plat = platformDbRules ?? {}
  const body = mergeDocumentRuleSections(
    PLATFORM_DOCUMENT_RULES_BASELINE,
    plat.general,
    plat[type],
    orgRulesFromClient
  )
  return wrapDocumentRulesBlock(body, 'edit')
}

/** Plain text block for POST /api/edit-document (legacy modal). */
export function getDocumentRulesPlainForEdit(
  type: string,
  platformDbRules: PlatformDocumentRulesMap | null
): string {
  const plat = platformDbRules ?? {}
  return mergeDocumentRuleSections(
    PLATFORM_DOCUMENT_RULES_BASELINE,
    plat.general,
    plat[type]
  )
}
