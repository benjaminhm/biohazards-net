/*
 * GET /api/portal/documents/[documentId]
 *
 * Renders a released document as HTML for the account that owns it.
 *
 * This exists so the portal never links clients to /api/print/[docId], which is
 * public and unauthenticated. loadPortalDocument requires the document to be
 * released AND on a job linked to the caller's account, so a document id from
 * another client is a 404 here even though the public route would serve it.
 */
import { NextResponse } from 'next/server'
import { loadPortalDocument, requirePortalContext } from '@/lib/portalScope'
import { renderDocumentHtml } from '@/lib/documentRender'

function notFound() {
  return new NextResponse(
    '<h1 style="font-family:sans-serif;padding:40px">Document not available</h1>',
    { status: 404, headers: { 'Content-Type': 'text/html' } }
  )
}

export async function GET(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) {
    return new NextResponse(
      '<h1 style="font-family:sans-serif;padding:40px">Please sign in to view this document</h1>',
      { status: 401, headers: { 'Content-Type': 'text/html' } }
    )
  }

  const found = await loadPortalDocument(ctx, documentId)
  if (!found) return notFound()

  const url = new URL(req.url)

  const html = await renderDocumentHtml({
    supabase: ctx.supabase,
    doc: found.doc as { id: string; job_id: string; type: string; content: Record<string, unknown> | null },
    imagesParam: url.searchParams.get('images'),
    // Points at this route, not the public print URL: the Images toggle reloads
    // in place (the viewer page frames this URL), and Copy Link hands out a link
    // that still requires a portal session.
    viewerUrl: `${url.origin}/api/portal/documents/${documentId}`,
    includeClientContact: false,
  })

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
