/*
 * Seed article: Hepatitis B Virus (HBV)
 *
 * HBV gets its own article because it is the BBP with the highest
 * environmental persistence and the most specific disinfectant guidance.
 */
import type { ArticleDoc } from '../types'

export const hepatitisBVirusHbv: ArticleDoc = {
  slug: 'hepatitis-b-virus-hbv',
  title: 'Hepatitis B virus (HBV)',
  category: 'biohazards',
  summary: 'Environmentally stable bloodborne virus — survives on dry surfaces for at least a week. Dictates disinfectant choice and contact time on blood-involved jobs.',
  tags: ['hbv', 'hepatitis b', 'bloodborne', 'persistence', 'bleach', 'vaccination'],
  lastUpdated: '2026-04-20',
  source: 'platform',
  blocks: [
    {
      type: 'p',
      text: 'HBV is a DNA virus that infects liver cells. For cleanup purposes its defining trait is environmental persistence: viable HBV has been recovered from dried blood on surfaces after seven days or more. That single fact drives most of the disinfectant and dwell-time decisions on a bloody scene.',
    },

    { type: 'h2', id: 'transmission', text: 'Occupational transmission' },
    {
      type: 'ul',
      items: [
        'Needlestick from contaminated sharp — highest-risk route for workers.',
        'Blood or OPIM contacting non-intact skin or mucous membranes.',
        'Surface-to-hand-to-face contact where dried blood is present — possible but reduced by PPE and hand hygiene.',
      ],
    },

    { type: 'h2', id: 'vaccination', text: 'Vaccination status' },
    {
      type: 'p',
      text: 'HBV vaccination is the primary occupational defence. Every technician who can foreseeably contact blood should have a documented vaccination series and post-vaccination anti-HBs titre on file. This is an administrative control — it does not replace PPE.',
    },

    { type: 'h2', id: 'disinfection', text: 'Disinfection on surfaces' },
    {
      type: 'p',
      text: 'HBV is susceptible to a short list of registered disinfectants. The most common field choice is sodium hypochlorite (household bleach) at 1:10 dilution (~5,000 ppm available chlorine) with at least 10 minutes of wet contact time on cleaned surfaces. Pre-clean visible organic matter first — organic load neutralises chlorine.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Contact time matters more than concentration',
      text: 'A surface that looks wet for thirty seconds and dries is not disinfected. Keep surfaces visibly wet for the full contact time listed on the product label — re-wet if needed.',
    },

    { type: 'h2', id: 'post-exposure', text: 'Post-exposure: what happens now' },
    {
      type: 'ol',
      items: [
        'Stop work. Remove the exposed PPE carefully, contaminated-first.',
        'Wash the exposed site with soap and water; flush mucous membranes with saline or clean water.',
        'Report the exposure to your supervisor and log it in the incident record.',
        'Seek medical assessment the same day — post-exposure prophylaxis (PEP) window is time-sensitive.',
      ],
    },
    {
      type: 'callout',
      variant: 'info',
      text: 'This article is a reference for planning and documentation. Post-exposure medical decisions are made by a clinician, not by the cleanup team.',
    },
  ],
  related: ['bloodborne-pathogens-overview', 'sodium-hypochlorite-sds', 'ppe-levels-guide'],
}
