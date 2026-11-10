/*
 * /api/photo/bulk/session — sign in to the bulk photo loader with a photo PIN.
 *
 *   GET     who is signed in ({ person } or 401)
 *   POST    { pin } → sets the session cookie
 *   DELETE  signs out
 */
import { NextResponse } from 'next/server'
import { clientIpFromRequest } from '@/lib/portalAuth'
import { resolvePersonByPin } from '@/lib/photoPin'
import { isSecureStaffRequest } from '@/lib/staffSession'
import {
  PHOTO_BULK_COOKIE,
  clearPinFailures,
  photoBulkCookie,
  photoBulkPerson,
  pinLockoutRemaining,
  recordPinFailure,
  signPhotoBulkToken,
} from '@/lib/photoBulkSession'

export async function GET(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json({ person })
}

export async function POST(req: Request) {
  const clientKey = clientIpFromRequest(req) || 'unknown'
  const locked = pinLockoutRemaining(clientKey)
  if (locked) {
    const minutes = Math.ceil(locked / 60000)
    return NextResponse.json(
      { error: `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown }
  const pin = typeof body.pin === 'string' ? body.pin : ''
  const person = await resolvePersonByPin(pin)
  if (!person) {
    recordPinFailure(clientKey)
    return NextResponse.json({ error: 'That PIN is not recognised.' }, { status: 401 })
  }

  clearPinFailures(clientKey)
  const res = NextResponse.json({ person })
  res.cookies.set(photoBulkCookie(await signPhotoBulkToken(person), isSecureStaffRequest(req)))
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: PHOTO_BULK_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}
