/*
 * Seed article: Decontamination Sequence SOP
 *
 * Platform baseline for the "how do I actually clean this thing" question.
 * Intentionally generic so it applies to trauma, infectious-disease, and
 * hoarding work.
 */
import type { ArticleDoc } from '../types'

export const decontaminationSequenceSop: ArticleDoc = {
  slug: 'decontamination-sequence-sop',
  title: 'Decontamination sequence SOP',
  category: 'procedures',
  summary: 'The three-step sequence — clean, disinfect, verify — and why each step fails when the order is wrong.',
  tags: ['decontamination', 'cleaning', 'disinfection', 'dwell time', 'atp', 'sop'],
  lastUpdated: '2026-04-20',
  source: 'platform',
  blocks: [
    {
      type: 'p',
      text: 'Disinfection is not cleaning. Cleaning removes organic matter; disinfection kills what remains. Skipping step one wastes step two — free chlorine and most quaternary compounds are neutralised by protein. Use this SOP as the mental model on every scene.',
    },

    { type: 'h2', id: 'step-1-clean', text: '1. Clean (remove)' },
    {
      type: 'ul',
      items: [
        'Wet-clean with a detergent solution and disposable wipes or microfibre.',
        'Work clean-to-dirty, top-down, small sections.',
        'Change cloths between areas — do not re-dip a contaminated cloth into clean solution.',
        'The surface is "clean" when it looks and feels like the surface, not like the contamination that was on it.',
      ],
    },

    { type: 'h2', id: 'step-2-disinfect', text: '2. Disinfect (kill)' },
    {
      type: 'p',
      text: 'Apply a registered disinfectant that is effective against your target pathogen at the labelled concentration. The two variables that determine success are concentration and contact time. Both must match the product label — shortening either reduces efficacy non-linearly.',
    },
    {
      type: 'table',
      headers: ['Disinfectant', 'Typical use', 'Contact time (label, verify)'],
      rows: [
        ['Sodium hypochlorite 1:10', 'Blood and OPIM on non-porous surfaces', '≥ 10 min'],
        ['Quaternary ammonium (Quat)', 'General environmental', '~ 5–10 min'],
        ['Accelerated hydrogen peroxide', 'General, with shorter dwell', '~ 1–5 min'],
        ['70% isopropyl alcohol', 'Small surfaces, electronics', '~ 30 sec, enveloped only'],
      ],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Dwell time is wall-clock time',
      text: 'If the product dries before the listed contact time, re-wet it. Dry surface = no disinfection. Use the actual label for the actual product — this table is a memory aid, not an authority.',
    },

    { type: 'h2', id: 'step-3-verify', text: '3. Verify' },
    {
      type: 'ul',
      items: [
        'Visual — 405 nm or other inspection lighting for residual biologic material.',
        'ATP — swab high-touch and cleaned surfaces; record RLU readings in the job file.',
        'Organoleptic — no lingering odour after ventilation.',
        'Photograph the verified area before release.',
      ],
    },

    { type: 'h2', id: 'tools-waste', text: 'Tools and waste' },
    {
      type: 'ul',
      items: [
        'Single-use tools (wipes, absorbents) — bag as biohazard.',
        'Reusable tools (scrapers, HEPA vacuum hose) — decontaminate on a plastic tray with the same disinfectant and dwell time as the scene.',
        'Vehicle transfer — all waste and contaminated tools in a sealed bin, never loose in the cab.',
      ],
    },

    { type: 'h2', id: 'common-mistakes', text: 'Common mistakes' },
    {
      type: 'ul',
      items: [
        'Spraying disinfectant onto visible blood (it just dilutes the contamination).',
        'Applying disinfectant with a contaminated cloth that was used for cleaning.',
        'Walking clean-to-dirty instead of dirty-to-clean.',
        'Letting the disinfectant dry before the contact time elapses.',
        'Using an expired or heat-damaged bleach stock.',
      ],
    },
  ],
  related: ['sodium-hypochlorite-sds', 'trauma-scene-cleanup-sop', 'ppe-levels-guide'],
}
