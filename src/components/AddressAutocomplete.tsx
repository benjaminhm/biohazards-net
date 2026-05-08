/*
 * components/AddressAutocomplete.tsx
 *
 * Shared address input backed by Google Places API (New) via the
 * `PlaceAutocompleteElement` web component.
 *
 * Design choices:
 *   - Authoritative value is still the formatted address string; sidecars
 *     (placeId, lat, lng) ride alongside but every downstream consumer keeps
 *     reading `site_address` as a plain string.
 *   - Free-text fallback is first-class: if the user types an unusual
 *     address (rural, informal, "behind the shed at ...") and blurs without
 *     picking a suggestion, we accept their typed text verbatim and clear
 *     the structured sidecars.
 *   - Graceful no-key fallback: when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is
 *     unset (local dev without billing, preview envs, etc.) the component
 *     collapses to a plain <input> so nothing breaks.
 *   - Country bias defaults to AU to match the phone normaliser but can be
 *     overridden.
 *
 * Accepts a change handler that receives the full structured payload so
 * callers can persist the sidecars. Consumers that only care about the
 * formatted string can ignore the extra fields.
 */
'use client'

import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { useEffect, useId, useRef, useState } from 'react'

export interface AddressChange {
  address: string
  placeId: string
  lat: number | null
  lng: number | null
}

interface Props {
  value: string
  placeId?: string
  lat?: number | null
  lng?: number | null
  onChange: (next: AddressChange) => void
  placeholder?: string
  disabled?: boolean
  /** ISO-3166-1 alpha-2 codes (lowercase). Defaults to ['au']. Pass [] to disable bias. */
  includedRegionCodes?: string[]
  style?: React.CSSProperties
  /** Extra class forwarded to the underlying wrapper for integration-specific styling. */
  className?: string
}

const defaultStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 15,
  outline: 'none',
  fontFamily: 'inherit',
}

// Singleton so multiple <AddressAutocomplete> instances share one script tag
// and one in-flight library promise. setOptions() is a no-op after the first
// call so repeated component mounts are safe.
let placesLibPromise: Promise<unknown> | null = null
let optionsSet = false

function loadPlaces(apiKey: string): Promise<unknown> {
  if (!optionsSet) {
    setOptions({ key: apiKey, v: 'weekly' })
    optionsSet = true
  }
  if (placesLibPromise) return placesLibPromise
  placesLibPromise = importLibrary('places')
  return placesLibPromise
}

// Narrow the `place` payload we actually care about, typed loosely because
// the new API surface is not fully covered by @types/google.maps yet.
type PlaceLike = {
  id?: string
  formattedAddress?: string
  location?: { lat: () => number; lng: () => number } | null
  fetchFields?: (opts: { fields: string[] }) => Promise<unknown>
}

type PlacePrediction = { toPlace: () => PlaceLike }
type PlaceSelectEvent = Event & { placePrediction?: PlacePrediction }

export default function AddressAutocomplete({
  value,
  placeId,
  lat,
  lng,
  onChange,
  placeholder = 'Start typing an address…',
  disabled = false,
  includedRegionCodes = ['au'],
  style,
  className,
}: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  const hostRef = useRef<HTMLDivElement | null>(null)
  const elRef = useRef<HTMLElement | null>(null)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState<string>(value) // mirrors typed text
  const [loadError, setLoadError] = useState<string | null>(null)
  const reactId = useId()

  // Keep the fallback text input in sync when parent value changes (e.g. after
  // Smart Fill applies a new address, or after the user selects a suggestion).
  useEffect(() => {
    setFallback(value)
  }, [value])

  // Track the most recent committed value so blur-without-select can compare.
  const lastCommittedRef = useRef<string>(value)
  useEffect(() => {
    lastCommittedRef.current = value
  }, [value])

  // Mount the <gmp-place-autocomplete> element when key + host are ready.
  useEffect(() => {
    if (!apiKey) return
    if (!hostRef.current) return

    let cancelled = false
    let el: HTMLElement | null = null
    let onSelect: ((ev: PlaceSelectEvent) => void) | null = null
    let onInputEvt: (() => void) | null = null
    let onBlurEvt: (() => void) | null = null

    loadPlaces(apiKey)
      .then((placesLib) => {
        if (cancelled || !hostRef.current) return

        // PlaceAutocompleteElement is the 2024+ Places API (New) primitive.
        // Typed as unknown because the element is not in @types/google.maps.
        const Ctor = (placesLib as {
          PlaceAutocompleteElement: new (opts?: Record<string, unknown>) => HTMLElement
        }).PlaceAutocompleteElement

        el = new Ctor({
          includedRegionCodes: includedRegionCodes.length > 0 ? includedRegionCodes : undefined,
        })
        el.id = `addr-ac-${reactId}`
        el.style.width = '100%'
        // Seed with current value where supported (API accepts `value` prop).
        try {
          ;(el as unknown as { value?: string }).value = value ?? ''
        } catch {
          /* older builds may not accept .value; ignore */
        }

        onSelect = async (ev: PlaceSelectEvent) => {
          const prediction = ev.placePrediction
          if (!prediction) return
          const place = prediction.toPlace()
          try {
            await place.fetchFields?.({ fields: ['formattedAddress', 'id', 'location'] })
          } catch {
            /* still emit what we have */
          }
          const address = place.formattedAddress ?? ''
          const nextLat = place.location ? place.location.lat() : null
          const nextLng = place.location ? place.location.lng() : null
          lastCommittedRef.current = address
          setFallback(address)
          onChange({
            address,
            placeId: place.id ?? '',
            lat: nextLat,
            lng: nextLng,
          })
        }

        onInputEvt = () => {
          const typed = (el as unknown as { value?: string }).value ?? ''
          setFallback(typed)
        }

        onBlurEvt = () => {
          const typed = ((el as unknown as { value?: string }).value ?? '').trim()
          // User typed something new and blurred without picking → accept as free text.
          if (typed && typed !== (lastCommittedRef.current ?? '').trim()) {
            lastCommittedRef.current = typed
            onChange({ address: typed, placeId: '', lat: null, lng: null })
          }
        }

        el.addEventListener('gmp-select', onSelect as EventListener)
        el.addEventListener('input', onInputEvt)
        el.addEventListener('blur', onBlurEvt, true)

        hostRef.current.appendChild(el)
        elRef.current = el
        setReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load Google Places')
      })

    return () => {
      cancelled = true
      if (el) {
        if (onSelect) el.removeEventListener('gmp-select', onSelect as EventListener)
        if (onInputEvt) el.removeEventListener('input', onInputEvt)
        if (onBlurEvt) el.removeEventListener('blur', onBlurEvt, true)
        el.remove()
      }
      elRef.current = null
      setReady(false)
    }
    // Only re-mount if the API key or region codes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, includedRegionCodes.join(','), reactId])

  // Push external value updates into the element after it's mounted.
  useEffect(() => {
    if (!ready || !elRef.current) return
    try {
      const el = elRef.current as unknown as { value?: string }
      if (el.value !== value) el.value = value ?? ''
    } catch {
      /* ignore */
    }
  }, [value, ready])

  // Reflect disabled state onto the element when supported.
  useEffect(() => {
    if (!elRef.current) return
    try {
      ;(elRef.current as unknown as { disabled?: boolean }).disabled = disabled
    } catch {
      /* ignore */
    }
  }, [disabled])

  // Fallback input — used when no API key is configured or the library
  // failed to load. Also displayed if the element hasn't mounted yet.
  const showPlain = !apiKey || !!loadError

  if (showPlain) {
    return (
      <div className={className}>
        <input
          type="text"
          value={fallback}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => setFallback(e.target.value)}
          onBlur={() => {
            const typed = fallback.trim()
            if (typed !== (lastCommittedRef.current ?? '').trim()) {
              lastCommittedRef.current = typed
              // Preserve existing sidecars only if the string is unchanged.
              onChange({
                address: typed,
                placeId: typed === (value ?? '').trim() ? (placeId ?? '') : '',
                lat: typed === (value ?? '').trim() ? (lat ?? null) : null,
                lng: typed === (value ?? '').trim() ? (lng ?? null) : null,
              })
            }
          }}
          style={{ ...defaultStyle, ...style }}
        />
        {loadError && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Address suggestions unavailable ({loadError}). You can still type the address.
          </div>
        )}
      </div>
    )
  }

  // Host div receives the <gmp-place-autocomplete> element imperatively.
  // Google's element owns its own styling; we wrap it so the outer layout
  // matches sibling inputs.
  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        // Keep parity with plain inputs — the element renders its own input
        // chrome, but the host needs to take up the same horizontal space.
        width: '100%',
        ...(style ?? {}),
      }}
    />
  )
}
