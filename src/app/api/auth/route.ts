import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'bh_session'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const correct = process.env.APP_PASSWORD

  if (!correct) {
    return NextResponse.json({ error: 'APP_PASSWORD not configured on server.' }, { status: 500 })
  }

  if (password !== correct) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, correct, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('bh_session')
  return res
}
