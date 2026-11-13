/*
 * app/api/extract/route.ts
 *
 * POST /api/extract — SmartFill extraction for the new-job creation form.
 * Accepts freeform text (email, SMS, voicemail transcript) and returns
 * structured job fields via Claude.
 *
 * Used by the SmartFill component on /jobs/new.
 * For extraction within an existing job's Details tab, see
 * /api/jobs/[id]/extract. This route's prompt lives in lib/smartFillExtract.ts,
 * shared with the phone new-job form (/api/photo/newjob/extract).
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractIntakeFields } from '@/lib/smartFillExtract'

export async function POST(req: NextRequest) {
  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  const extracted = await extractIntakeFields(text)
  if (!extracted) return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })
  return NextResponse.json({ extracted })
}
