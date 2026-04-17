/*
 * lib/orgVocabularyLoader.ts
 *
 * Server-only loader that builds an org's vocabulary for a given set of kinds
 * by scanning the N most-recent jobs and merging in the current
 * equipment/chemicals catalogues (so catalogue-ticked rows can resolve to a
 * real name/category).
 *
 * Usage (inside an API route):
 *
 *   const supabase = createServiceClient()
 *   const vocab = await loadOrgVocabulary(supabase, orgId, { kinds: ['risk'] })
 *   const block = orgVocabularyBlock('risk', vocab.risk)
 *
 * PERFORMANCE NOTE: v1 fetches assessment_data for the last 100 jobs per call.
 * That's typically 1–5 MB and fine for a service-client → Postgres link, but if
 * an org grows large we'll want either a cached `org_vocabulary_cache` JSONB
 * column on `company_profile`, or a SQL-side aggregation. Tracked as future
 * optimisation — see docs/ai-product-principles.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssessmentData,
  ChemicalCatalogueItem,
  CompanyProfile,
  EquipmentCatalogueItem,
} from '@/lib/types'
import {
  emptyVocabulary,
  extractOrgVocabulary,
  type OrgVocabularyByKind,
  type OrgVocabularyKind,
} from '@/lib/orgVocabulary'

export interface LoadOrgVocabularyOptions {
  /** Restrict loading/extraction to the kinds a given endpoint cares about.
   *  Today extraction still scans the full blob (cheap), but this lets callers
   *  signal intent and keeps the door open for kind-specific short-circuits. */
  kinds?: OrgVocabularyKind[]
  /** How many recent jobs to sample. Default 100. */
  jobLimit?: number
  /** Entries to return per kind (most used first). Default 30. */
  perKindCap?: number
}

/**
 * Loads org-level vocabulary from recent jobs + company catalogues.
 * Returns an empty vocabulary on any database error (we do not want a suggest
 * endpoint to fall over because historical mining failed).
 */
export async function loadOrgVocabulary(
  supabase: SupabaseClient,
  orgId: string,
  opts: LoadOrgVocabularyOptions = {},
): Promise<OrgVocabularyByKind> {
  try {
    const jobLimit = opts.jobLimit ?? 100
    const perKindCap = opts.perKindCap ?? 30

    const [jobsRes, companyRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, created_at, updated_at, assessment_data')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(jobLimit),
      supabase
        .from('company_profile')
        .select('equipment_catalogue, chemicals_catalogue')
        .eq('org_id', orgId)
        .maybeSingle(),
    ])

    if (jobsRes.error) return emptyVocabulary()
    const rows = (jobsRes.data ?? []) as Array<{
      id: string
      created_at: string | null
      updated_at: string | null
      assessment_data: AssessmentData | null
    }>

    const company = (companyRes.data ?? null) as Pick<
      CompanyProfile,
      'equipment_catalogue' | 'chemicals_catalogue'
    > | null

    return extractOrgVocabulary(rows, {
      equipmentCatalogue: (company?.equipment_catalogue as EquipmentCatalogueItem[] | undefined) ?? null,
      chemicalsCatalogue: (company?.chemicals_catalogue as ChemicalCatalogueItem[] | undefined) ?? null,
      perKindCap,
    })
  } catch {
    return emptyVocabulary()
  }
}
