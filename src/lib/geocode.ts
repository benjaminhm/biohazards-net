/**
 * Server-side Google Geocoding (reverse: lat/lng → address).
 * Uses GOOGLE_GEOCODING_API_KEY, falling back to the browser Maps key.
 */

export async function reverseGeocodeLatLng(lat: number, lng: number): Promise<string | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  if (!key) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

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
