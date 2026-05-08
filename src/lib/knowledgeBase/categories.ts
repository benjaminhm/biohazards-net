/*
 * lib/knowledgeBase/categories.ts
 *
 * The four top-level sections of the Knowledge Base. Ordered intentionally:
 * biohazards first (the "what" you're dealing with), then procedures, PPE,
 * and chemicals (the "how you handle it" trio).
 */

import type { CategoryDef } from './types'

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'biohazards',
    label: 'Biohazards',
    icon: '🦠',
    description: 'Pathogens, contamination types, and exposure routes.',
    accent: '#EF4444',
  },
  {
    id: 'procedures',
    label: 'Procedures',
    icon: '📋',
    description: 'SOPs for assessment, cleanup, and decontamination.',
    accent: '#3B82F6',
  },
  {
    id: 'ppe',
    label: 'PPE',
    icon: '🛡️',
    description: 'Personal protective equipment selection and use.',
    accent: '#8B5CF6',
  },
  {
    id: 'chemicals',
    label: 'Chemicals',
    icon: '🧪',
    description: 'SDS quick-reference for disinfectants and cleaners.',
    accent: '#14B8A6',
  },
]

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORIES.find(c => c.id === id)
}
