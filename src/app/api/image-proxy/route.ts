/*
 * app/api/image-proxy/route.ts
 *
 * GET /api/image-proxy?url=... — proxies an external image through the server.
 *
 * Used when @react-pdf/renderer needs to embed photos that are behind CORS
 * restrictions (Supabase Storage). The proxy fetches the image server-side
 * and re-serves it with permissive CORS headers + 24h cache.
 *
 * Only used in the PDF generation path — HTML documents use URLs directly.
 */
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('No URL provided', { status: 400 })

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)

    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') || 'image/jpeg'

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : 'Failed to fetch image',
      { status: 500 }
    )
  }
}
