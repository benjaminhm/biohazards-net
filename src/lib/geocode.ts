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

async function drivingKmViaMatrix(
  key: string,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<number | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
  url.searchParams.set('origins', `${originLat},${originLng}`)
  url.searchParams.set('destinations', `${destLat},${destLng}`)
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
  const el = data.rows?.[0]?.elements?.[0]
  if (data.status !== 'OK' || el?.status !== 'OK') return null
  const meters = el.distance?.value
  return typeof meters === 'number' ? kmFromMeters(meters) : null
}

/** Road km between two points. Null if the key is missing or Google returns no route. */
export async function drivingDistanceKm(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<number | null> {
  const key = mapsKey()
  if (!key) return null
  if (!isLatLng(originLat, originLng) || !isLatLng(destLat, destLng)) return null

  return (
    (await drivingKmViaRoutes(key, originLat, originLng, destLat, destLng)) ??
    (await drivingKmViaMatrix(key, originLat, originLng, destLat, destLng))
  )
}
