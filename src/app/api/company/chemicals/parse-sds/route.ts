/*
 * POST /api/company/chemicals/parse-sds
 *
 * Accepts a multipart/form-data upload with a single PDF "file" (an SDS — Safety
 * Data Sheet). The route:
 *   1. Validates the file is a PDF ≤ 10 MB.
 *   2. Uploads the PDF to Supabase storage at
 *        company-assets/sds/<orgId>/<timestamp>-<uuid>-<safeName>.pdf
 *   3. Sends the PDF bytes to Claude as a DocumentBlockParam (base64) and asks it
 *      to extract a structured SdsParsed JSON payload (product name, manufacturer,
 *      hazard classes, signal word, PPE, first-aid summary, handling precautions).
 *   4. Returns { sds_path, sds_filename, sds_public_url, sds_parsed } so the
 *      client can pre-fill the catalogue form and then POST to
 *      /api/company/chemicals to actually persist the row.
 *
 * This split (parse vs persist) keeps the catalogue endpoint idempotent and lets
 * the user tweak parsed fields before committing anything to the org catalogue.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import type { ChemicalHazardClass, SdsParsed } from '@/lib/types'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const HAZARD_CLASSES: ChemicalHazardClass[] = [
  'corrosive', 'flammable', 'toxic', 'oxidiser', 'biohazard',
  'irritant', 'health_hazard', 'environmental', 'compressed_gas', 'other',
]

const SYSTEM_SDS = `You extract structured data from chemical Safety Data Sheets (SDS) for use by biohazard remediation technicians in Australia.

The attached PDF is an SDS. Extract the following fields and respond ONLY with valid JSON (no markdown fences):

{
  "product_name": "Trade / product name (Section 1)",
  "manufacturer": "Supplier / manufacturer (Section 1) or null",
  "active_ingredient": "Primary active ingredient or hazardous component (Section 3) or null",
  "hazard_classes": ["array of zero or more of: corrosive, flammable, toxic, oxidiser, biohazard, irritant, health_hazard, environmental, compressed_gas, other"],
  "signal_word": "danger" | "warning" | null,
  "ppe_required": ["short strings from Section 8 — one PPE item per string, e.g. 'Nitrile gloves', 'Chemical splash goggles', 'Half-face respirator with vapour cartridge'"],
  "first_aid_summary": "One short paragraph (≤ 500 chars) summarising Section 4 first-aid measures. Cover eye, skin, inhalation, ingestion where present.",
  "handling_precautions": "One short paragraph (≤ 500 chars) summarising Section 7 safe handling guidance."
}

RULES:
- Map GHS hazard pictograms / H-phrases to the hazard_classes enum above. Example mappings:
    Acute Tox. → toxic; Skin Corr. → corrosive; Flam. Liq. → flammable; Ox. Liq. → oxidiser;
    Eye Irrit. / Skin Irrit. → irritant; STOT / Carc. → health_hazard; Aquatic → environmental.
- If a field is not present in the SDS, use null (or empty array). Never invent.
- Keep every string ≤ 120 chars except first_aid_summary and handling_precautions (≤ 500 chars).
- Respond with JSON only. No commentary, no markdown.`

function sanitizeHazardClasses(raw: unknown): ChemicalHazardClass[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<ChemicalHazardClass>()
  for (const r of raw) {
    const c = String(r).toLowerCase() as ChemicalHazardClass
    if (HAZARD_CLASSES.includes(c)) out.add(c)
  }
  return Array.from(out)
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 403 })

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local (see .env.local.example), then restart the dev server.',
        },
        { status: 503 },
      )
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'PDF file is required (field name: file)' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `SDS PDF too large (max ${MAX_BYTES / (1024 * 1024)} MB)` }, { status: 413 })
    }
    const filename =
      form.get('filename') && typeof form.get('filename') === 'string'
        ? (form.get('filename') as string).slice(0, 120)
        : ((file as File).name || 'sds.pdf')
    const mime = file.type || 'application/pdf'
    if (mime !== 'application/pdf' && !filename.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // 1. Upload to storage
    const supabase = createServiceClient()
    const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
    const sds_path = `sds/${orgId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}`
    const { error: upErr } = await supabase.storage
      .from('company-assets')
      .upload(sds_path, bytes, { contentType: 'application/pdf', upsert: false })
    if (upErr) {
      return NextResponse.json(
        { error: upErr.message || 'SDS upload failed — check company-assets bucket exists' },
        { status: 500 },
      )
    }
    const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(sds_path)
    const sds_public_url = urlData.publicUrl

    // 2. Send PDF to Claude as a document block
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_SDS,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: bytes.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Extract the SDS fields per the schema. JSON only.',
            },
          ],
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json(
        {
          error: 'Could not parse AI response',
          sds_path,
          sds_filename: filename,
          sds_public_url,
        },
        { status: 502 },
      )
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON from AI', sds_path, sds_filename: filename, sds_public_url },
        { status: 502 },
      )
    }

    const sds_parsed: SdsParsed = {
      product_name: typeof parsed.product_name === 'string' ? parsed.product_name.trim().slice(0, 120) : '',
      manufacturer: typeof parsed.manufacturer === 'string' ? parsed.manufacturer.trim().slice(0, 120) : undefined,
      active_ingredient:
        typeof parsed.active_ingredient === 'string'
          ? parsed.active_ingredient.trim().slice(0, 120)
          : undefined,
      hazard_classes: sanitizeHazardClasses(parsed.hazard_classes),
      signal_word:
        parsed.signal_word === 'danger' || parsed.signal_word === 'warning' ? parsed.signal_word : null,
      ppe_required: Array.isArray(parsed.ppe_required)
        ? parsed.ppe_required
            .map(x => String(x).trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 20)
        : [],
      first_aid_summary:
        typeof parsed.first_aid_summary === 'string'
          ? parsed.first_aid_summary.trim().slice(0, 600)
          : undefined,
      handling_precautions:
        typeof parsed.handling_precautions === 'string'
          ? parsed.handling_precautions.trim().slice(0, 600)
          : undefined,
      parsed_at: new Date().toISOString(),
      source_filename: filename,
    }

    return NextResponse.json({
      sds_path,
      sds_filename: filename,
      sds_public_url,
      sds_parsed,
    })
  } catch (e: unknown) {
    console.error('[parse-sds]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'SDS parse failed' },
      { status: 500 },
    )
  }
}
