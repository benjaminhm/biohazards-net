/*
 * /api/version — lightweight build fingerprint so the tablet WebView and open
 * browser tabs can detect a fresh Vercel deployment immediately on resume.
 */
import { NextResponse } from 'next/server'

const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  'local'

export async function GET() {
  return NextResponse.json(
    { build: BUILD_ID },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
