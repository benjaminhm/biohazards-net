/*
 * Seed article: PPE Levels Guide
 *
 * Summary of the US-EPA/OSHA Level A–D framework, which the industry still
 * uses as common vocabulary even in other jurisdictions. Intended as an
 * orientation piece — not a substitute for a site-specific risk assessment.
 */
import type { ArticleDoc } from '../types'

export const ppeLevelsGuide: ArticleDoc = {
  slug: 'ppe-levels-guide',
  title: 'PPE levels guide',
  category: 'ppe',
  summary: 'Levels A–D PPE at a glance: what each level protects against, what it consists of, and when to step up or down.',
  tags: ['ppe', 'level a', 'level b', 'level c', 'level d', 'respirator', 'gloves', 'gown'],
  lastUpdated: '2026-04-20',
  source: 'platform',
  featured: true,
  blocks: [
    {
      type: 'p',
      text: 'The Level A–D classification is a shorthand for how much protection a PPE ensemble provides. It is driven primarily by the respiratory hazard and secondarily by the skin/body hazard. For biohazard cleanup most work sits in Level C or Level D; Level B shows up for bioaerosols in enclosed spaces; Level A is rare outside hazmat response.',
    },

    { type: 'h2', id: 'level-a', text: 'Level A — highest protection' },
    {
      type: 'ul',
      items: [
        'Fully-encapsulating vapour-tight suit.',
        'Supplied-air (SCBA) or supplied-air respirator.',
        'Inner and outer chemical-resistant gloves.',
        'Use when: unknown atmospheres, confined spaces with toxic vapour, or the hazard requires gas-tight integrity.',
      ],
    },

    { type: 'h2', id: 'level-b', text: 'Level B — high respiratory, splash skin' },
    {
      type: 'ul',
      items: [
        'Hooded chemical-splash suit (not vapour-tight).',
        'Supplied-air or full-face SCBA respirator.',
        'Chemical-resistant outer and inner gloves.',
        'Use when: known respiratory hazard above APF of a tight-fitting air-purifying respirator, or oxygen-deficient atmospheres.',
      ],
    },

    { type: 'h2', id: 'level-c', text: 'Level C — respiratory hazard known and filterable' },
    {
      type: 'ul',
      items: [
        'Chemical-resistant coverall (Type 4/5/6 as appropriate).',
        'Air-purifying respirator — half or full face, P2/P3 or equivalent cartridge.',
        'Nitrile gloves, often doubled, with tape to cuff.',
        'Shoe covers or dedicated boots.',
        'Use when: contaminants identified and concentrations known; atmosphere has ≥ 19.5% O₂.',
      ],
    },

    { type: 'h2', id: 'level-d', text: 'Level D — work uniform with minimal hazard' },
    {
      type: 'ul',
      items: [
        'Coveralls or standard work uniform.',
        'Safety glasses or goggles.',
        'Gloves appropriate to the task.',
        'Safety footwear.',
        'Use when: no respiratory hazard, only incidental skin exposure possible.',
      ],
    },

    { type: 'h2', id: 'choosing', text: 'Choosing the level' },
    {
      type: 'p',
      text: 'Start from the hazard, not the habit. A large dried-blood cleanup in a well-ventilated residence is typically Level C with N95/P2, double nitrile, gown, shoe covers, and eye protection. Add a P100 or half-face cartridge if you suspect aerosol generation (e.g. wet vacuuming contaminated water). Step up to Level B if the scene is enclosed and respiratory protection limits are being approached.',
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'Fit test every tight-fitting respirator',
      text: 'An elastomeric half-mask without a current fit test is not PPE. Schedule fit testing annually and retest when the face shape changes (weight, facial hair, scars).',
    },

    { type: 'h2', id: 'doff-sequence', text: 'Doff sequence (contaminated-first)' },
    {
      type: 'ol',
      items: [
        'Outer gloves — pinch and peel, turning inside-out; bag immediately.',
        'Gown or coverall — break front, roll away from body, bag.',
        'Shoe covers — peel from toe to heel, bag.',
        'Goggles or face shield — by the arms only, disinfect or bag.',
        'Respirator — by the straps only, do not touch the front.',
        'Inner gloves — peel last; hand hygiene immediately afterwards.',
      ],
    },
  ],
  related: ['bloodborne-pathogens-overview', 'trauma-scene-cleanup-sop', 'decontamination-sequence-sop'],
}
