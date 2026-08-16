import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOrgId } from '@/lib/org'
import { reverseGeocodeLatLng } from '@/lib/geocode'

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { lat?: unknown; lng?: unknown }
    const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat)
    const lng = typeof body.lng === 'number' ? body.lng : Number(body.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
    }

    const address = await reverseGeocodeLatLng(lat, lng)
    if (!address) return NextResponse.json({ address: null })
    return NextResponse.json({ address })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Geocode failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
