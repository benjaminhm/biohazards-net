/*
 * Seed article: Sodium Hypochlorite (SDS quick reference)
 *
 * This is a field reference, not a substitute for the manufacturer's SDS.
 * Any dilution, concentration, or compatibility claim must defer to the
 * specific product SDS on the job.
 */
import type { ArticleDoc } from '../types'

export const sodiumHypochloriteSds: ArticleDoc = {
  slug: 'sodium-hypochlorite-sds',
  title: 'Sodium hypochlorite — SDS quick reference',
  category: 'chemicals',
  summary: 'The workhorse bleach disinfectant. Hazards, first aid, storage, incompatibilities, and practical dilutions for biohazard use.',
  tags: ['bleach', 'naocl', 'sodium hypochlorite', 'sds', 'disinfectant', 'chlorine'],
  lastUpdated: '2026-04-20',
  source: 'platform',
  featured: true,
  blocks: [
    {
      type: 'callout',
      variant: 'info',
      title: 'Defer to the product SDS',
      text: 'This is a quick-reference summary of typical household-strength sodium hypochlorite. The SDS supplied with the specific product on your job is the authoritative document — ratios, classifications, and first-aid guidance vary by concentration and manufacturer.',
    },

    { type: 'h2', id: 'identification', text: 'Identification' },
    {
      type: 'table',
      headers: ['Field', 'Value'],
      rows: [
        ['Chemical name', 'Sodium hypochlorite solution'],
        ['Synonyms', 'Bleach, liquid chlorine, hypochlorite'],
        ['Formula', 'NaOCl (aq.)'],
        ['CAS', '7681-52-9'],
        ['UN number', 'UN1791 (hypochlorite solution)'],
        ['Typical household strength', '4–6% available chlorine'],
      ],
    },

    { type: 'h2', id: 'hazards', text: 'Hazards' },
    {
      type: 'ul',
      items: [
        'Causes severe skin burns and eye damage at higher concentrations.',
        'May release toxic chlorine gas on contact with acids or ammonia.',
        'Harmful to aquatic life — avoid drain disposal of concentrate.',
        'Decomposes on exposure to heat and light; bottles can pressurise.',
      ],
    },

    { type: 'h2', id: 'first-aid', text: 'First aid' },
    {
      type: 'ul',
      items: [
        'Eye contact — rinse with clean water for at least 15 minutes, eyelids held open. Seek medical attention.',
        'Skin contact — remove contaminated clothing, wash with soap and water for 15 minutes.',
        'Inhalation of fumes — move to fresh air, keep at rest, seek medical advice if breathing is affected.',
        'Ingestion — do not induce vomiting. Rinse mouth. Seek immediate medical attention.',
      ],
    },

    { type: 'h2', id: 'incompatibilities', text: 'Do not mix with' },
    {
      type: 'callout',
      variant: 'danger',
      title: 'Mixing bleach can produce toxic gas',
      text: 'Never combine sodium hypochlorite with ammonia-based cleaners (produces chloramine vapours), with acids including vinegar or toilet-bowl cleaner (produces chlorine gas), or with hydrogen peroxide. Always clean residues of other products off surfaces before applying bleach.',
    },

    { type: 'h2', id: 'storage-handling', text: 'Storage and handling' },
    {
      type: 'ul',
      items: [
        'Store upright in original container, cool and shaded, away from acids, ammonia, and metals.',
        'Loosen cap periodically to relieve pressure from gradual decomposition.',
        'Label all decant containers — never use unmarked bottles.',
        'Ventilate the work area when diluting or applying.',
      ],
    },

    { type: 'h2', id: 'ppe', text: 'PPE for use' },
    {
      type: 'ul',
      items: [
        'Chemical-resistant nitrile or neoprene gloves.',
        'Splash goggles or a full face shield when mixing or applying overhead.',
        'Fluid-resistant gown or apron.',
        'P2/N95 respirator if ventilation is poor or the area is enclosed.',
      ],
    },

    { type: 'h2', id: 'dilutions', text: 'Practical dilutions (from 5% stock)' },
    {
      type: 'table',
      headers: ['Use', 'Ratio', '≈ Available chlorine', 'Contact time'],
      rows: [
        ['General surface disinfection', '1 : 100', '500 ppm', '≥ 10 min'],
        ['Blood and OPIM (non-porous surfaces)', '1 : 10', '~5,000 ppm', '≥ 10 min'],
        ['Large blood spill after absorbent removal', '1 : 10', '~5,000 ppm', '≥ 10 min'],
      ],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Clean first, disinfect second',
      text: 'Organic matter (blood, food, biofilm) neutralises free chlorine. Remove gross contamination and wet-clean the surface before the disinfectant dwell, or the dwell time is wasted.',
    },

    { type: 'h2', id: 'shelf-life', text: 'Shelf life and freshness' },
    {
      type: 'p',
      text: 'Bleach loses potency over months in storage — up to 20% per year under household conditions, faster if warm or light-exposed. For disinfection work, use stock within 12 months of manufacture and mix working solutions fresh each shift.',
    },
  ],
  related: ['hepatitis-b-virus-hbv', 'bloodborne-pathogens-overview', 'decontamination-sequence-sop', 'ppe-levels-guide'],
}
