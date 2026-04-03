/*
 * app/api/pdf/route.ts
 *
 * POST /api/pdf — renders a document as a downloadable PDF binary via
 * @react-pdf/renderer.
 *
 * This is an alternative to the HTML print route — produces a true PDF file
 * rather than relying on browser print-to-PDF. Supports quote, sow, and
 * report document types via PDFDocument.tsx (JobPDFDocument component).
 *
 * runtime = 'nodejs' is required because @react-pdf/renderer uses Node.js
 * APIs incompatible with the Edge runtime.
 *
 * The renderer is imported via require() rather than import because it uses
 * CommonJS exports that cause issues with Next.js ESM bundling.
 */
import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToBuffer } = require('@react-pdf/renderer')
import { createElement } from 'react'
import { JobPDFDocument } from '@/components/PDFDocument'
import type { DocType } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { type, content, jobId } = await req.json() as {
      type: DocType
      content: object
      jobId: string
    }

    if (!type || !content) {
      return NextResponse.json({ error: 'Missing type or content' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = await renderToBuffer(createElement(JobPDFDocument as any, { type, content } as any))

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${type}-${jobId?.slice(0, 8) ?? 'doc'}.pdf"`,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
