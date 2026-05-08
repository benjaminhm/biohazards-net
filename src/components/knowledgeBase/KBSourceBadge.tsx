/*
 * components/knowledgeBase/KBSourceBadge.tsx
 *
 * Small pill that labels an article as platform-authored or org-authored.
 * v1 only ever shows "Platform" because all seed content is platform layer,
 * but the component takes the source prop so the org path is already wired
 * for v2 when we add org-authored SOPs.
 */
'use client'

import type { ArticleSource } from '@/lib/knowledgeBase/types'
import type { CSSProperties } from 'react'

export function KBSourceBadge({ source }: { source: ArticleSource }) {
  const isPlatform = source === 'platform'
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    border: `1px solid ${isPlatform ? 'rgba(255,107,53,0.35)' : 'rgba(34,197,94,0.35)'}`,
    background: isPlatform ? 'rgba(255,107,53,0.10)' : 'rgba(34,197,94,0.10)',
    color: isPlatform ? 'var(--accent)' : '#4ADE80',
  }
  return (
    <span style={style} title={isPlatform ? 'Maintained by biohazards.net' : 'Authored by your organisation'}>
      <span aria-hidden style={{ fontSize: 10 }}>{isPlatform ? '◆' : '●'}</span>
      {isPlatform ? 'Platform' : 'Your org'}
    </span>
  )
}
