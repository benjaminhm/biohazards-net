import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOrgId } from '@/lib/org'
import { drivingDistanceKm } from '@/lib/geocode'

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as {
      originLat?: unknown
      originLng?: unknown
      destLat?: unknown
      destLng?: unknown
    }
    const originLat = num(body.originLat)
    const originLng = num(body.originLng)
    const destLat = num(body.destLat)
    const destLng = num(body.destLng)
    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      return NextResponse.json({ error: 'origin and destination lat/lng required' }, { status: 400 })
    }

    const km = await drivingDistanceKm(originLat, originLng, destLat, destLng)
    return NextResponse.json({ km })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Distance lookup failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
