/*
 * app/api/org/ux-tags/route.ts
 *
 * Admin-only API for tagging pages, job sections, tabs, and custom features as
 * `simplify`, `keep`, or `ignore` (see lib/uxTags.ts).
 *
 *   GET  -> current resolved tags + manifest from orgs.features
 *   POST { key, tag, note? } -> saves tag to orgs.features; in local dev
 *          (`NODE_ENV === 'development'`) also writes `docs/ux-audit-tags.json`
 *          directly so AI assistants see tags immediately in the codebase.
 *   POST { syncOnly: true }  -> writes `docs/ux-audit-tags.json` in local dev
 *          without changing any tags.
 */
import { NextResponse } from 'next/server'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import {
  applyUxTag,
  buildUxAuditManifest,
  isUxTagStatus,
  parseUxTagKey,
  resolveUxTags,
} from '@/lib/uxTags'

const MANIFEST_PATH = path.join(process.cwd(), 'docs', 'ux-audit-tags.json')

async function tryWriteRepoManifest(features: Record<string, unknown> | null) {
  const manifest = buildUxAuditManifest(features)
  if (process.env.NODE_ENV !== 'development') {
    return { manifest, wroteRepoFile: false }
  }
  try {
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return { manifest, wroteRepoFile: true }
  } catch {
    return { manifest, wroteRepoFile: false }
  }
}

export async function GET(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { orgId, supabase } = gate

  const { data: org, error } = await supabase.from('orgs').select('features').eq('id', orgId).single()
  if (error || !org) {
    return NextResponse.json({ error: error?.message ?? 'Organisation not found' }, { status: 500 })
  }

  const features = (org.features as Record<string, unknown> | null) ?? {}
  return NextResponse.json({
    features,
    tags: resolveUxTags(features),
    manifest: buildUxAuditManifest(features),
    canWriteRepoFile: process.env.NODE_ENV === 'development',
  })
}

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { orgId, supabase } = gate

  const body = (await req.json().catch(() => null)) as {
    key?: unknown
    tag?: unknown
    note?: unknown
    syncOnly?: unknown
  } | null

  const { data: org, error: readError } = await supabase
    .from('orgs')
    .select('features')
    .eq('id', orgId)
    .single()
  if (readError || !org) {
    return NextResponse.json({ error: readError?.message ?? 'Organisation not found' }, { status: 500 })
  }

  const currentFeatures = (org.features as Record<string, unknown> | null) ?? {}

  if (body?.syncOnly === true) {
    const { manifest, wroteRepoFile } = await tryWriteRepoManifest(currentFeatures)
    return NextResponse.json({
      features: currentFeatures,
      tags: resolveUxTags(currentFeatures),
      manifest,
      wroteRepoFile,
    })
  }

  const key = parseUxTagKey(body?.key)
  if (!key) {
    return NextResponse.json(
      { error: 'Invalid key. Use section:<id>, tab:<id>, route:/<path>, or feature:<slug>.' },
      { status: 400 },
    )
  }

  const tag = body?.tag === null ? null : isUxTagStatus(body?.tag) ? body.tag : undefined
  if (tag === undefined) {
    return NextResponse.json(
      { error: 'Tag must be "simplify", "keep", "ignore", or null to clear.' },
      { status: 400 },
    )
  }

  const note = typeof body?.note === 'string' ? body.note : null
  const features = applyUxTag(currentFeatures, key, tag, note)

  const { error: writeError } = await supabase
    .from('orgs')
    .update({ features })
    .eq('id', orgId)
  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 })
  }

  const { manifest, wroteRepoFile } = await tryWriteRepoManifest(features)
  return NextResponse.json({
    features,
    tags: resolveUxTags(features),
    manifest,
    wroteRepoFile,
  })
}
