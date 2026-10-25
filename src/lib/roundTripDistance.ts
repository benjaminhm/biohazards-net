/**
 * Return driving distance between two places, for quotes that charge travel.
 * Tries the browser Maps service first, then the server geocode and distance routes.
 */
import { browserDrivingRoundTripKm, browserGeocodeAddress, type MapWaypoint } from '@/lib/geocodeBrowser'

export type LatLng = { lat: number; lng: number }

export async function pinFor(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address: string,
): Promise<LatLng | null> {
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng }
  }
  const fromBrowser = await browserGeocodeAddress(address)
  if (fromBrowser) return fromBrowser
  try {
    const res = await fetch('/api/geocode/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    const data = (await res.json()) as { lat?: number | null; lng?: number | null }
    if (typeof data.lat === 'number' && typeof data.lng === 'number' && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
      return { lat: data.lat, lng: data.lng }
    }
  } catch {
    /* server geocode is the fallback */
  }
  return null
}

export async function serverRoundTripKm(origin: LatLng, dest: LatLng): Promise<number | null> {
  try {
    const res = await fetch('/api/geocode/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originLat: origin.lat,
        originLng: origin.lng,
        destLat: dest.lat,
        destLng: dest.lng,
      }),
    })
    const data = (await res.json()) as { km?: number | null }
    if (!res.ok) return null
    return typeof data.km === 'number' && Number.isFinite(data.km) && data.km >= 0 ? data.km : null
  } catch {
    return null
  }
}

/** Return trip in km, with the pins that were used. Null km when no route was found. */
export async function roundTripKm(
  origin: { address: string; pin: LatLng | null },
  dest: { address: string; pin: LatLng | null },
): Promise<{ km: number | null; origin: LatLng | null; dest: LatLng | null }> {
  const from: MapWaypoint = origin.pin ?? origin.address
  const to: MapWaypoint = dest.pin ?? dest.address
  const direct = await browserDrivingRoundTripKm(from, to)
  if (direct != null) return { km: direct, origin: origin.pin, dest: dest.pin }
  const originPin = origin.pin ?? await pinFor(null, null, origin.address)
  const destPin = dest.pin ?? await pinFor(null, null, dest.address)
  if (!originPin || !destPin) return { km: null, origin: originPin, dest: destPin }
  const km = await browserDrivingRoundTripKm(originPin, destPin) ?? await serverRoundTripKm(originPin, destPin)
  return { km, origin: originPin, dest: destPin }
}
