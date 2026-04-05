/*
 * components/PreviewBanner.tsx
 *
 * A fixed top banner that appears when an admin has activated preview mode
 * (simulating a team member's capability set). Renders null when not previewing.
 *
 * The banner serves two purposes:
 *   1. Reminds the admin that they are in preview mode (purple strip + person name).
 *   2. Provides a quick "Exit Preview" button to restore admin capabilities.
 *
 * preview_name is stored in localStorage alongside preview_caps in userContext.tsx.
 * The spacer div below the fixed strip prevents the page's own content from
 * being partially hidden underneath the banner.
 */
'use client'

import { useUser } from '@/lib/userContext'

function getPreviewName(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('preview_name')
}

export default function PreviewBanner() {
  const { previewMode, exitPreview, impersonating } = useUser()
  if (!previewMode) return null

  const name = getPreviewName()
  const label = name ? `👁 Previewing as ${name}` : '👁 Previewing as Team Member'
  const top = impersonating ? 40 : 0

  return (
    <>
      <div style={{
        position: 'fixed', top, left: 0, right: 0, zIndex: 9999,
        background: '#7C3AED', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: '8px 16px', fontSize: 12, fontWeight: 600, flexWrap: 'wrap',
      }}>
        <span>{label}</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>|</span>
        <span style={{ opacity: 0.75, fontWeight: 400 }}>You are still an Administrator</span>
        <button
          onClick={exitPreview}
          style={{
            marginLeft: 4, padding: '3px 10px', borderRadius: 6,
            background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
            color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer',
          }}
        >
          Exit Preview
        </button>
      </div>
      {/* Spacer so page content isn't hidden under the fixed banner */}
      <div style={{ height: 37 + top }} />
    </>
  )
}
