/*
 * GET/PATCH /api/admin/platform-document-rules
 * Platform operators only — global AI document_rules (tone, phrasing) for all orgs.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isPlatformOperator } from '@/lib/platformAdmin'
import { sanitizePlatformDocumentRulesInput } from '@/lib/platformDocumentRules'

export async function GET() {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('platform_document_rules')
    .select('document_rules, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rules = sanitizePlatformDocumentRulesInput(data?.document_rules ?? {})
  return NextResponse.json({ document_rules: rules, updated_at: data?.updated_at ?? null })
}

export async function PATCH(req: Request) {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { document_rules?: unknown }
  if (!body.document_rules || typeof body.document_rules !== 'object') {
    return NextResponse.json({ error: 'document_rules object required' }, { status: 400 })
  }

  const sanitized = sanitizePlatformDocumentRulesInput(body.document_rules)
  const supabase = createServiceClient()

  const { data: row } = await supabase.from('platform_document_rules').select('id').limit(1).maybeSingle()

  if (!row?.id) {
    const { error: insErr } = await supabase
      .from('platform_document_rules')
      .insert({ document_rules: sanitized, updated_at: new Date().toISOString() })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  } else {
    const { error: upErr } = await supabase
      .from('platform_document_rules')
      .update({ document_rules: sanitized, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, document_rules: sanitized })
}
