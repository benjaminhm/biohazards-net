import type {
  PreflightCheckItem,
  PreflightCriticalControlId,
  PreflightOperationalId,
  PreRemediationPreflightChecklist,
} from '@/lib/types'

export const PREFLIGHT_CRITICAL_IDS: PreflightCriticalControlId[] = [
  'scope_confirmed',
  'swms_jsa_current_and_briefed',
  'isolation_containment_plan',
  'ppe_rpe_fit_test_met',
  'waste_chain_disposal_confirmed',
  'authority_to_proceed_documented',
  'emergency_escalation_contacts',
]

export const PREFLIGHT_OPERATIONAL_IDS: PreflightOperationalId[] = [
  'equipment_staged_tested',
  'materials_consumables_available',
  'access_keys_induction',
  'utilities_ventilation_isolation_points',
  'site_conditions_acceptable',
  'stakeholder_issues_mitigated',
]

export const PREFLIGHT_CRITICAL_LABELS: Record<PreflightCriticalControlId, string> = {
  scope_confirmed: 'Scope, exclusions, and deliverables confirmed',
  swms_jsa_current_and_briefed: 'SWMS/JSA current, signed, and team briefed',
  isolation_containment_plan: 'Isolation / containment plan in place',
  ppe_rpe_fit_test_met: 'PPE / RPE / fit-test requirements met',
  waste_chain_disposal_confirmed: 'Waste chain of custody / disposal route confirmed',
  authority_to_proceed_documented: 'Authority to proceed / permits documented',
  emergency_escalation_contacts: 'Emergency and escalation contacts confirmed',
}

export const PREFLIGHT_OPERATIONAL_LABELS: Record<PreflightOperationalId, string> = {
  equipment_staged_tested: 'Equipment staged and serviceable',
  materials_consumables_available: 'Materials and consumables available',
  access_keys_induction: 'Access, keys, and site induction complete',
  utilities_ventilation_isolation_points: 'Utilities, ventilation, and isolation points confirmed',
  site_conditions_acceptable: 'Site conditions acceptable for work',
  stakeholder_issues_mitigated: 'Traffic / neighbor / stakeholder issues mitigated',
}

function emptyCheckItem(): PreflightCheckItem {
  return { checked: false, notes: '', not_applicable: false }
}

function buildCritical(): Record<PreflightCriticalControlId, PreflightCheckItem> {
  return {
    scope_confirmed: emptyCheckItem(),
    swms_jsa_current_and_briefed: emptyCheckItem(),
    isolation_containment_plan: emptyCheckItem(),
    ppe_rpe_fit_test_met: emptyCheckItem(),
    waste_chain_disposal_confirmed: emptyCheckItem(),
    authority_to_proceed_documented: emptyCheckItem(),
    emergency_escalation_contacts: emptyCheckItem(),
  }
}

function buildOperational(): Record<PreflightOperationalId, PreflightCheckItem> {
  return {
    equipment_staged_tested: emptyCheckItem(),
    materials_consumables_available: emptyCheckItem(),
    access_keys_induction: emptyCheckItem(),
    utilities_ventilation_isolation_points: emptyCheckItem(),
    site_conditions_acceptable: emptyCheckItem(),
    stakeholder_issues_mitigated: emptyCheckItem(),
  }
}

export function createEmptyPreRemediationPreflightChecklist(seed: {
  job_id: string
  site_address?: string
  client_contact?: string
  supervisor_name?: string
}): PreRemediationPreflightChecklist {
  const now = new Date().toISOString()
  return {
    schema_version: 1,
    header: {
      job_id: seed.job_id,
      site_address: seed.site_address ?? '',
      client_contact: seed.client_contact ?? '',
      preflight_datetime: now,
      supervisor_name: seed.supervisor_name ?? '',
    },
    sections: {
      critical: buildCritical(),
      operational: buildOperational(),
    },
    outcome: {
      result: null,
      critical_failure_ids: [],
      conditions_notes: '',
      approved_by_name: '',
      approved_at: null,
    },
    updated_at: now,
  }
}

export const PRE_REMEDIATION_PREFLIGHT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://biohazards.net/schemas/pre_remediation_preflight_checklist.v1.json',
  title: 'PreRemediationPreflightChecklist',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'header', 'sections', 'outcome', 'updated_at'],
  properties: {
    schema_version: { const: 1 },
    updated_at: { type: 'string', format: 'date-time' },
    header: {
      type: 'object',
      additionalProperties: false,
      required: ['job_id', 'site_address', 'client_contact', 'preflight_datetime', 'supervisor_name'],
      properties: {
        job_id: { type: 'string', minLength: 1 },
        site_address: { type: 'string' },
        client_contact: { type: 'string' },
        preflight_datetime: { type: 'string', format: 'date-time' },
        supervisor_name: { type: 'string' },
      },
    },
    sections: {
      type: 'object',
      additionalProperties: false,
      required: ['critical', 'operational'],
      properties: {
        critical: {
          type: 'object',
          additionalProperties: false,
          required: PREFLIGHT_CRITICAL_IDS,
          properties: {
            scope_confirmed: { $ref: '#/$defs/preflightCheckItem' },
            swms_jsa_current_and_briefed: { $ref: '#/$defs/preflightCheckItem' },
            isolation_containment_plan: { $ref: '#/$defs/preflightCheckItem' },
            ppe_rpe_fit_test_met: { $ref: '#/$defs/preflightCheckItem' },
            waste_chain_disposal_confirmed: { $ref: '#/$defs/preflightCheckItem' },
            authority_to_proceed_documented: { $ref: '#/$defs/preflightCheckItem' },
            emergency_escalation_contacts: { $ref: '#/$defs/preflightCheckItem' },
          },
        },
        operational: {
          type: 'object',
          additionalProperties: false,
          required: PREFLIGHT_OPERATIONAL_IDS,
          properties: {
            equipment_staged_tested: { $ref: '#/$defs/preflightCheckItem' },
            materials_consumables_available: { $ref: '#/$defs/preflightCheckItem' },
            access_keys_induction: { $ref: '#/$defs/preflightCheckItem' },
            utilities_ventilation_isolation_points: { $ref: '#/$defs/preflightCheckItem' },
            site_conditions_acceptable: { $ref: '#/$defs/preflightCheckItem' },
            stakeholder_issues_mitigated: { $ref: '#/$defs/preflightCheckItem' },
          },
        },
      },
    },
    outcome: {
      type: 'object',
      additionalProperties: false,
      required: ['result', 'critical_failure_ids', 'conditions_notes', 'approved_by_name', 'approved_at'],
      properties: {
        result: {
          oneOf: [
            { type: 'null' },
            { type: 'string', enum: ['go', 'go_with_conditions', 'no_go'] },
          ],
        },
        critical_failure_ids: {
          type: 'array',
          items: {
            type: 'string',
            enum: PREFLIGHT_CRITICAL_IDS,
          },
          uniqueItems: true,
        },
        conditions_notes: { type: 'string' },
        approved_by_name: { type: 'string' },
        approved_at: {
          oneOf: [
            { type: 'null' },
            { type: 'string', format: 'date-time' },
          ],
        },
      },
    },
  },
  $defs: {
    preflightCheckItem: {
      type: 'object',
      additionalProperties: false,
      required: ['checked'],
      properties: {
        checked: { type: 'boolean' },
        notes: { type: 'string' },
        not_applicable: { type: 'boolean' },
      },
    },
  },
}
