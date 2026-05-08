/*
 * Seed article: Trauma Scene Cleanup SOP
 *
 * Platform baseline procedure. Orgs can author their own SOP that supersedes
 * this one for their scenes — the renderer will show the same layout with an
 * "Org" source badge when that arrives in v2.
 */
import type { ArticleDoc } from '../types'

export const traumaSceneCleanupSop: ArticleDoc = {
  slug: 'trauma-scene-cleanup-sop',
  title: 'Trauma scene cleanup SOP',
  category: 'procedures',
  summary: 'Baseline procedure for an assault, suicide, unattended death, or other blood-involved scene. Covers arrival, PPE, containment, removal, disinfection, waste, documentation.',
  tags: ['trauma', 'suicide', 'unattended death', 'sop', 'procedure', 'cleanup'],
  lastUpdated: '2026-04-20',
  source: 'platform',
  featured: true,
  blocks: [
    {
      type: 'callout',
      variant: 'info',
      title: 'This is the platform baseline',
      text: 'Your organisation may have its own SOP that supersedes this document for specific scene types (e.g. police crime scenes, aged-care facilities). Check with your manager before relying on this one for a live job.',
    },

    { type: 'h2', id: 'pre-arrival', text: '1. Pre-arrival' },
    {
      type: 'ul',
      items: [
        'Confirm clearance — police or coronial release for the site; keys and access arrangements.',
        'Load list: PPE kits (2 per technician minimum), sharps container, biohazard bags (yellow), absorbents, pre-mixed disinfectant, ATP test kit or pH test strips, camera.',
        'Route plan and estimated job duration.',
        'Identify next-of-kin or representative contact on the file.',
      ],
    },

    { type: 'h2', id: 'arrival-assessment', text: '2. Arrival and assessment' },
    {
      type: 'ol',
      items: [
        'Park away from the property entrance — avoid public association.',
        'Meet contact if on site; confirm scope matches the quote.',
        'Walk the perimeter, then the affected area in Level D (no entry into contaminated zone yet).',
        'Photograph all affected surfaces and items, wide and close.',
        'Identify containment boundary and PPE donning zone.',
      ],
    },

    { type: 'h2', id: 'ppe-don', text: '3. Don PPE' },
    {
      type: 'p',
      text: 'Typical Level C ensemble for this work. Donning sequence: inner gloves, coverall legs, coverall torso, shoe covers, respirator (fit check), eye protection, hood up, outer gloves taped to sleeves.',
    },

    { type: 'h2', id: 'containment', text: '4. Contain and control' },
    {
      type: 'ul',
      items: [
        'Plastic sheet the containment boundary and floor path to the waste staging area.',
        'Close windows and doors to adjacent rooms where possible.',
        'Post a worker at the PPE zone if the property is occupied.',
      ],
    },

    { type: 'h2', id: 'removal', text: '5. Removal and absorption' },
    {
      type: 'ol',
      items: [
        'Sharps sweep with tongs — sharps go straight into the sharps container.',
        'Absorb pooled blood and fluid with purpose-made absorbents; bag as biohazard.',
        'Remove contaminated porous items (bedding, carpet underlay, mattresses) — cannot be disinfected; bag and tag.',
        'Wet-clean non-porous surfaces to remove visible residue before disinfection.',
      ],
    },

    { type: 'h2', id: 'disinfection', text: '6. Disinfection' },
    {
      type: 'p',
      text: 'Apply registered disinfectant at the labelled concentration and keep surfaces visibly wet for the full contact time. For blood-involved work the default is sodium hypochlorite at 1:10 (~5,000 ppm) with ≥ 10 minutes dwell. Re-wet if the surface dries before the time elapses. Work top-down, clean-to-dirty.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Verify, don\u2019t trust',
      text: 'Use an ATP meter or visual lighting check before declaring a surface clean. A surface that looks clean under warm light can still show contamination under 405 nm or ATP.',
    },

    { type: 'h2', id: 'waste', text: '7. Waste handling' },
    {
      type: 'ul',
      items: [
        'Double-bag in yellow biohazard bags; twist-tie each bag, do not tape.',
        'Label with job number, date, technician, and UN3291 where required.',
        'Transfer to licensed clinical-waste contractor — retain manifest.',
      ],
    },

    { type: 'h2', id: 'final-inspection', text: '8. Final inspection' },
    {
      type: 'ol',
      items: [
        'Remove containment sheeting last — it is contaminated.',
        'Walk the area in clean PPE for final photos.',
        'Ventilate the space before release.',
      ],
    },

    { type: 'h2', id: 'ppe-doff', text: '9. Doff PPE' },
    {
      type: 'p',
      text: 'Contaminated-first: outer gloves, gown/coverall, shoe covers, goggles, respirator, inner gloves, hand hygiene. Do not touch face at any point during doffing.',
    },

    { type: 'h2', id: 'documentation', text: '10. Documentation' },
    {
      type: 'ul',
      items: [
        'Before/after photos attached to the job file.',
        'Chemicals used, lot numbers, dilution, dwell time.',
        'Waste manifests.',
        'Any incidents or exposures logged the same day.',
      ],
    },
  ],
  related: ['bloodborne-pathogens-overview', 'ppe-levels-guide', 'sodium-hypochlorite-sds', 'decontamination-sequence-sop'],
}
