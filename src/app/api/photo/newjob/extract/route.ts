/*
 * POST /api/photo/newjob/extract — Smart Fill for the phone new-job form,
 * signed in with a photo PIN. { text } → { extracted }.
 *
 * /api/extract does the same for the staff app but sits behind the staff
 * session; /api/photo is public in the proxy, so this route checks the PIN
 * session itself.
 */
import { NextResponse } from 'next/server'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import { extractIntakeFields } from '@/lib/smartFillExtract'
import { INTAKE_SMART_FILL_MAX_CHARS } from '@/lib/newJobIntake'

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  if (text.length > INTAKE_SMART_FILL_MAX_CHARS) {
    return NextResponse.json({ error: 'That is too much text to read at once.' }, { status: 400 })
  }

  try {
    const extracted = await extractIntakeFields(text)
    if (!extracted) return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })
    return NextResponse.json({ extracted })
  } catch (err) {
    console.error('[newjob] smart fill failed', err)
    return NextResponse.json({ error: 'Could not read that text.' }, { status: 502 })
  }
}
