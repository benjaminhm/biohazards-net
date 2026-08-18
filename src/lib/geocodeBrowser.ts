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
    const lib = (await importLibrary('places')) as {
      Place?: {
        searchByText?: (req: Record<string, unknown>) => Promise<{ places?: { location?: unknown }[] }>
      }
    }
    if (!lib.Place?.searchByText) return null
    const { places } = await lib.Place.searchByText({
      textQuery: query,
      fields: ['location', 'formattedAddress'],
      maxResultCount: 1,
      includedRegionCodes: ['au'],
    })
    return readLatLng(places?.[0]?.location)
  } catch {
    return null
  }
}

async function viaGeocoder(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const lib = (await importLibrary('geocoding')) as {
      Geocoder?: new () => {
        geocode: (req: { address: string; region?: string }) => Promise<{
          results?: { geometry?: { location?: unknown } }[]
        }>
      }
    }
    if (!lib.Geocoder) return null
    const geocoder = new lib.Geocoder()
    const res = await geocoder.geocode({ address: query, region: 'AU' })
    return readLatLng(res.results?.[0]?.geometry?.location)
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

/** Resolve an address to a pin in the browser so referrer-restricted Maps keys work. */
export async function browserGeocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  const q = address.trim()
  if (!key || !q) return null
  setOptions({ key, v: 'weekly' })
  return (await viaPlaces(q)) ?? (await viaGeocoder(q)) ?? (await viaHttp(key, q))
}
