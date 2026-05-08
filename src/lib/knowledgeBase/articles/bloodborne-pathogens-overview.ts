/*
 * Seed article: Bloodborne Pathogens Overview
 *
 * Platform-authored reference. Concise, non-clinical. Technical detail should
 * link out to the pathogen-specific articles (HBV, HCV, HIV). Avoid specific
 * clinical-care claims; route those through a medical source.
 */
import type { ArticleDoc } from '../types'

export const bloodbornePathogensOverview: ArticleDoc = {
  slug: 'bloodborne-pathogens-overview',
  title: 'Bloodborne pathogens: overview',
  category: 'biohazards',
  summary: 'What bloodborne pathogens are, how they transmit, and the baseline precautions that apply to every blood-involved scene.',
  tags: ['bbp', 'blood', 'bodily fluids', 'universal precautions', 'hbv', 'hcv', 'hiv'],
  lastUpdated: '2026-04-20',
  source: 'platform',
  featured: true,
  blocks: [
    {
      type: 'p',
      text: 'Bloodborne pathogens (BBPs) are micro-organisms in human blood and other potentially infectious materials (OPIM) that can cause disease. In biohazard cleanup you assume every scene involving blood is infectious and apply universal precautions — you do not rely on knowing the patient history.',
    },

    { type: 'h2', id: 'primary-pathogens', text: 'Primary pathogens of concern' },
    {
      type: 'ul',
      items: [
        'Hepatitis B virus (HBV) — most persistent on dry surfaces; highest occupational risk.',
        'Hepatitis C virus (HCV) — bloodborne, less environmentally stable than HBV.',
        'Human immunodeficiency virus (HIV) — fragile outside the body; risk from needlesticks and direct mucosal contact.',
        'Other OPIM: semen, vaginal secretions, CSF, synovial, pleural, peritoneal, pericardial, amniotic fluid; any body fluid visibly contaminated with blood.',
      ],
    },

    { type: 'h2', id: 'transmission', text: 'How transmission happens' },
    {
      type: 'p',
      text: 'On a job, the realistic exposure routes are percutaneous (needlestick or sharp), mucocutaneous (splash to eye, nose, or mouth), and contact with non-intact skin. Intact skin is a strong barrier. The standard controls — PPE, engineering controls, and safe work practices — target these routes directly.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Sharps are the dominant hazard',
      text: 'Assume every scene may contain concealed sharps. Do a visual sharps sweep before you start wet work. Never handle sharps with gloved hands alone — use tongs or a sharps pick-up tool.',
    },

    { type: 'h2', id: 'controls', text: 'Baseline controls' },
    {
      type: 'ol',
      items: [
        'PPE before you touch anything: at minimum fluid-resistant gown, double nitrile gloves, eye protection, N95 or better respirator, shoe covers.',
        'Contain the area — block off the scene and control movement in and out.',
        'Remove gross contamination with absorbents before disinfecting. Wet cleaning first, then disinfectant dwell.',
        'Bag and label waste as biohazardous (yellow bag, UN3291 where applicable) for licensed disposal.',
        'Decontaminate reusable tools; dispose of single-use items.',
        'Doff PPE in sequence (contaminated-first) in a clean area. Hand hygiene after every step.',
      ],
    },

    { type: 'h2', id: 'documentation', text: 'What the file needs' },
    {
      type: 'p',
      text: 'Photos before and after, PPE and disinfectant used, dwell times observed, waste manifests, and any exposure incidents. The job file is the record of your compliance.',
    },

    { type: 'h2', id: 'when-to-escalate', text: 'When to escalate' },
    {
      type: 'ul',
      items: [
        'Needlestick or mucosal exposure — stop work, decontaminate the exposed site, begin incident reporting immediately.',
        'Scene scope larger than the quote assumed — stop, reassess, re-quote.',
        'Evidence of criminal activity — do not proceed until clearance from investigating authority.',
      ],
    },
  ],
  related: ['hepatitis-b-virus-hbv', 'ppe-levels-guide', 'trauma-scene-cleanup-sop', 'sodium-hypochlorite-sds'],
}
