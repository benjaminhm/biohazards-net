import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOrgId } from '@/lib/org'
import { forwardGeocodeAddress } from '@/lib/geocode'

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { address?: unknown }
    const address = typeof body.address === 'string' ? body.address.trim() : ''
    if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 })

    const hit = await forwardGeocodeAddress(address)
    if (!hit) return NextResponse.json({ lat: null, lng: null, address: null })
    return NextResponse.json(hit)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Geocode failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
