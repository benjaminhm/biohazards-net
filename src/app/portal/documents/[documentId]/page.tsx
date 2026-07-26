/*
 * app/portal/documents/[documentId]/page.tsx
 *
 * Guarded document viewer.
 *
 * Frames /api/portal/documents/[id], which checks the portal session and that the
 * document is released to this account. Print / Save PDF and the images toggle
 * live in the framed document's own action bar, so nothing is duplicated here.
 */
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { LINE, eyebrow, meta } from '@/components/portal/portalUi'

export default function PortalDocumentPage() {
  const { documentId } = useParams<{ documentId: string }>()

  return (
    <div>
      <Link href="/portal" style={{ ...eyebrow, textDecoration: 'none' }}>
        ← Back to overview
      </Link>

      <div
        style={{
          marginTop: 14,
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#FFFFFF',
        }}
      >
        <iframe
          src={`/api/portal/documents/${documentId}`}
          title="Document"
          style={{ display: 'block', width: '100%', height: '82vh', border: 'none' }}
        />
      </div>

      <p style={{ ...meta, marginTop: 12 }}>
        Use Print / Save PDF inside the document to keep a copy.
      </p>
    </div>
  )
}
