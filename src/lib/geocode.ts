/**
 * Server-side Google Geocoding (reverse: lat/lng → address) and driving distance.
 * Uses GOOGLE_GEOCODING_API_KEY, falling back to the browser Maps key.
 */

function mapsKey(): string {
  return process.env.GOOGLE_GEOCODING_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
}

function isLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function kmFromMeters(meters: number): number | null {
  if (!Number.isFinite(meters) || meters < 0) return null
  return Math.round((meters / 1000) * 10) / 10
}

export async function reverseGeocodeLatLng(lat: number, lng: number): Promise<string | null> {
  const key = mapsKey()
  if (!key) return null
  if (!isLatLng(lat, lng)) return null

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('latlng', `${lat},${lng}`)
  url.searchParams.set('language', 'en-AU')
  url.searchParams.set('region', 'au')
  url.searchParams.set('key', key)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json()) as {
    status?: string
    results?: { formatted_address?: string }[]
  }
  if (data.status !== 'OK' || !data.results?.length) return null
  const address = data.results[0]?.formatted_address?.trim()
  return address || null
}

async function drivingKmViaRoutes(
  key: string,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<number | null> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
      destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { routes?: { distanceMeters?: number }[] }
  const meters = data.routes?.[0]?.distanceMeters
  return typeof meters === 'number' ? kmFromMeters(meters) : null
}

export type DrivingRoundTripKm = {
  outKm: number | null
  returnKm: number | null
  km: number | null
}

function combineRoundTrip(outKm: number | null, returnKm: number | null): DrivingRoundTripKm | null {
  if (outKm == null && returnKm == null) return null
  const out = outKm ?? returnKm
  const ret = returnKm ?? outKm
  if (out == null || ret == null) return null
  return { outKm: out, returnKm: ret, km: Math.round((out + ret) * 10) / 10 }
}

async function roundTripViaMatrix(
  key: string,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<DrivingRoundTripKm | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
  url.searchParams.set('origins', `${originLat},${originLng}|${destLat},${destLng}`)
  url.searchParams.set('destinations', `${originLat},${originLng}|${destLat},${destLng}`)
  url.searchParams.set('mode', 'driving')
  url.searchParams.set('units', 'metric')
  url.searchParams.set('region', 'au')
  url.searchParams.set('key', key)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json()) as {
    status?: string
    rows?: { elements?: { status?: string; distance?: { value?: number } }[] }[]
  }
  if (data.status !== 'OK') return null
  const outMeters = data.rows?.[0]?.elements?.[1]
  const returnMeters = data.rows?.[1]?.elements?.[0]
  const outKm = outMeters?.status === 'OK' && typeof outMeters.distance?.value === 'number'
    ? kmFromMeters(outMeters.distance.value)
    : null
  const returnKm = returnMeters?.status === 'OK' && typeof returnMeters.distance?.value === 'number'
    ? kmFromMeters(returnMeters.distance.value)
    : null
  return combineRoundTrip(outKm, returnKm)
}

async function roundTripViaRoutes(
  key: string,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<DrivingRoundTripKm | null> {
  const [outKm, returnKm] = await Promise.all([
    drivingKmViaRoutes(key, originLat, originLng, destLat, destLng),
    drivingKmViaRoutes(key, destLat, destLng, originLat, originLng),
  ])
  return combineRoundTrip(outKm, returnKm)
}

/** Pickup → facility and facility → pickup. `km` is the billed round trip. */
export async function drivingRoundTripKm(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<DrivingRoundTripKm> {
  const empty: DrivingRoundTripKm = { outKm: null, returnKm: null, km: null }
  const key = mapsKey()
  if (!key) return empty
  if (!isLatLng(originLat, originLng) || !isLatLng(destLat, destLng)) return empty

  return (
    (await roundTripViaMatrix(key, originLat, originLng, destLat, destLng)) ??
    (await roundTripViaRoutes(key, originLat, originLng, destLat, destLng)) ??
    empty
  )
}

export async function forwardGeocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number; address: string } | null> {
  const key = mapsKey()
  const q = address.trim()
  if (!key || !q) return null

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', q)
  url.searchParams.set('language', 'en-AU')
  url.searchParams.set('region', 'au')
  url.searchParams.set('key', key)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json()) as {
    status?: string
    results?: {
      formatted_address?: string
      geometry?: { location?: { lat?: number; lng?: number } }
    }[]
  }
  if (data.status !== 'OK' || !data.results?.length) return null
  const hit = data.results[0]
  const lat = hit?.geometry?.location?.lat
  const lng = hit?.geometry?.location?.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isLatLng(lat, lng)) return null
  return { lat, lng, address: hit.formatted_address?.trim() || q }
}
