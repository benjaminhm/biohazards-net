/*
 * app/api/print/[docId]/route.ts
 *
 * GET /api/print/[docId] — renders a document as a full HTML page.
 *
 * Publicly accessible — the URL is shared with clients via email/SMS.
 * On screen, an action bar provides Print/Save PDF, Email, Text Link, and
 * Copy Link buttons. In print media, the action bar is hidden via CSS.
 *
 * Rendering lives in lib/documentRender.ts, shared with the commercial accounts
 * portal (/api/portal/documents/[id]) so both surfaces produce identical output
 * and only differ in authorisation.
 *
 * Cache-Control: no-store prevents proxies from caching stale document versions.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { renderDocumentHtml } from '@/lib/documentRender'

export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params
  const imagesParam = new URL(req.url).searchParams.get('images')
  const supabase = createServiceClient()

  const { data: doc, error: docErr } = await supabase
    .from('documents').select('*').eq('id', docId).single()

  if (docErr || !doc) {
    return new NextResponse('<h1 style="font-family:sans-serif;padding:40px">Document not found</h1>', {
      status: 404, headers: { 'Content-Type': 'text/html' },
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'

  const html = await renderDocumentHtml({
    supabase,
    doc,
    imagesParam,
    viewerUrl: `${appUrl}/api/print/${docId}`,
    includeClientContact: true,
  })

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
