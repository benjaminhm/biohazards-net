/*
 * app/api/documents/[id]/route.ts
 *
 * GET    /api/documents/[id] — fetch a single document by ID (no auth required —
 *   used by the print route and GenerateModal to reload saved state)
 * PATCH  /api/documents/[id] — update document content (only the content field)
 * DELETE /api/documents/[id] — hard delete the document record
 *
 * These routes have no auth guard because documents are accessed via the
 * print route (/api/print/[docId]) which is intentionally public. In future,
 * add token-based or signed-URL access for document security.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('documents').select('*').eq('id', id).single()
    if (error) throw error
    return NextResponse.json({ document: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('documents')
      .update({ content: body.content })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ document: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createServiceClient()
    const { error } = await supabase.from('documents').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
