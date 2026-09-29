import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

function readLatLng(loc: unknown): { lat: number; lng: number } | null {
  if (!loc || typeof loc !== 'object') return null
  const o = loc as {
    lat?: unknown
    lng?: unknown
    latitude?: unknown
    longitude?: unknown
  }
  const latRaw = typeof o.lat === 'function' ? o.lat() : o.lat ?? o.latitude
  const lngRaw = typeof o.lng === 'function' ? o.lng() : o.lng ?? o.longitude
  const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw)
  const lng = typeof lngRaw === 'number' ? lngRaw : Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

async function viaPlaces(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const { Place } = await importLibrary('places')
    const { places } = await Place.searchByText({
      textQuery: query,
      fields: ['location', 'formattedAddress'],
      maxResultCount: 1,
    })
    return readLatLng(places[0]?.location ?? null)
  } catch {
    return null
  }
}

async function viaGeocoder(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const { Geocoder } = await importLibrary('geocoding')
    const geocoder = new Geocoder()
    const res = await geocoder.geocode({ address: query, region: 'AU' })
    return readLatLng(res.results[0]?.geometry?.location ?? null)
  } catch {
    return null
  }
}

async function viaHttp(key: string, query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', query)
    url.searchParams.set('language', 'en-AU')
    url.searchParams.set('region', 'au')
    url.searchParams.set('key', key)
    const res = await fetch(url.toString())
    if (!res.ok) return null
    const data = (await res.json()) as {
      status?: string
      results?: { geometry?: { location?: { lat?: number; lng?: number } } }[]
    }
    if (data.status !== 'OK') return null
    const loc = data.results?.[0]?.geometry?.location
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null
    return { lat: loc.lat, lng: loc.lng }
  } catch {
    return null
  }
}

export type MapWaypoint = string | { lat: number; lng: number }

function kmFromMeters(meters: number): number | null {
  if (!Number.isFinite(meters) || meters < 0) return null
  return Math.round((meters / 1000) * 10) / 10
}

async function drivingLegKm(origin: MapWaypoint, destination: MapWaypoint): Promise<number | null> {
  const { Route } = await importLibrary('routes') as {
    Route: {
      computeRoutes: (request: {
        origin: MapWaypoint
        destination: MapWaypoint
        travelMode: string
        routingPreference: string
        fields: string[]
        language: string
        region: string
      }) => Promise<{ routes?: { distanceMeters?: number }[] }>
    }
  }
  const { routes } = await Route.computeRoutes({
    origin,
    destination,
    travelMode: 'DRIVING',
    routingPreference: 'TRAFFIC_UNAWARE',
    fields: ['distanceMeters'],
    language: 'en-AU',
    region: 'AU',
  })
  const meters = routes?.[0]?.distanceMeters
  return typeof meters === 'number' ? kmFromMeters(meters) : null
}

/**
 * Driving kilometres from origin to destination and back.
 * Runs in the browser so a referrer-restricted Maps key can call Routes.
 */
export async function browserDrivingRoundTripKm(
  origin: MapWaypoint,
  destination: MapWaypoint,
): Promise<number | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  const originText = typeof origin === 'string' ? origin.trim() : 'pin'
  const destText = typeof destination === 'string' ? destination.trim() : 'pin'
  if (!key || !originText || !destText) return null
  setOptions({ key, v: 'weekly' })
  try {
    const [outKm, returnKm] = await Promise.all([
      drivingLegKm(origin, destination),
      drivingLegKm(destination, origin),
    ])
    if (outKm == null && returnKm == null) return null
    const out = outKm ?? returnKm
    const back = returnKm ?? outKm
    if (out == null || back == null) return null
    return Math.round((out + back) * 10) / 10
  } catch {
    return null
  }
}

/** Resolve an address to a pin in the browser so referrer-restricted Maps keys work. */
export async function browserGeocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  const q = address.trim()
  if (!key || !q) return null
  setOptions({ key, v: 'weekly' })
  return (await viaPlaces(q)) ?? (await viaGeocoder(q)) ?? (await viaHttp(key, q))
}
