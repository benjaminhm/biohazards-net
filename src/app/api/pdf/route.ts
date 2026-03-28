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
