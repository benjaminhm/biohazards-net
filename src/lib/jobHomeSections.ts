/*
 * lib/jobHomeSections.ts
 *
 * The job page's Home workflow phases, in order, and the capability that gates
 * each one. Shared by the job page's numbered drawer and the Job Manager's file
 * menu (app/jobs/queue).
 */
import type { TeamCapabilities } from '@/lib/types'

export type HomeSection =
  | 'initial_contact'
  | 'onsite_assessment'
  | 'survey'
  | 'scope_of_work'
  | 'biohazard_cleaning'
  | 'quote'
  | 'contents_clearance'
  | 'surface_area_cleaning'
  | 'legal'
  | 'safety_compliance'
  | 'plan'
  | 'execute'
  | 'verify'
  | 'company_letterhead'
  | 'statement'
  | 'payment_overdue'
  | 'review'

export const HOME_SECTIONS: { id: HomeSection; label: string }[] = [
  { id: 'initial_contact', label: 'Initial Contact' },
  { id: 'onsite_assessment', label: 'Onsite Assessment' },
  { id: 'survey', label: 'Survey' },
  { id: 'scope_of_work', label: 'Scope of Work' },
  { id: 'biohazard_cleaning', label: 'BCQ' },
  { id: 'contents_clearance', label: 'CCQ' },
  { id: 'surface_area_cleaning', label: 'SACQ' },
  { id: 'quote', label: 'Quote/Estimate (legacy)' },
  { id: 'legal', label: 'Legal' },
  { id: 'safety_compliance', label: 'Safety and Compliance' },
  { id: 'plan', label: 'Plan' },
  { id: 'execute', label: 'Contents Disposal Record' },
  { id: 'verify', label: 'Post Remediation Evaluation' },
  { id: 'company_letterhead', label: 'Company Letterhead' },
  { id: 'statement', label: 'Statement of Accounts' },
  { id: 'payment_overdue', label: 'Payment Overdue' },
  { id: 'review', label: 'Review' },
]

export const HOME_SECTION_IDS = HOME_SECTIONS.map(s => s.id) as readonly HomeSection[]

export function isHomeSection(v: unknown): v is HomeSection {
  return typeof v === 'string' && (HOME_SECTION_IDS as readonly string[]).includes(v)
}

/**
 * Maps each Home sub-tab to the capability that gates its visibility. Admins and
 * managers have all of them on via ALL_CAPABILITIES / DEFAULT_MANAGER_CAPABILITIES;
 * members start with all off and rely on the admin flipping them in the
 * team profile. See CAP_GROUPS > "Job Home — Workflow sub-tabs" in app/team/[id].
 */
export const HOME_SECTION_TO_CAP: Record<HomeSection, keyof TeamCapabilities> = {
  initial_contact:   'view_home_initial_contact',
  onsite_assessment: 'view_home_onsite_assessment',
  survey:            'view_home_onsite_assessment',
  scope_of_work:     'view_home_scope_of_work',
  biohazard_cleaning: 'view_home_quote',
  quote:             'view_home_quote',
  contents_clearance: 'view_home_quote',
  surface_area_cleaning: 'view_home_quote',
  legal:             'view_home_legal',
  safety_compliance: 'view_home_safety_compliance',
  plan:              'view_home_plan',
  execute:           'view_home_execute',
  verify:            'view_home_verify',
  company_letterhead: 'view_home_verify',
  statement:         'view_home_verify',
  payment_overdue:   'view_home_verify',
  review:            'view_home_review',
}

export function visibleHomeSections(caps: TeamCapabilities) {
  return HOME_SECTIONS.filter(s => caps[HOME_SECTION_TO_CAP[s.id]] === true)
}
