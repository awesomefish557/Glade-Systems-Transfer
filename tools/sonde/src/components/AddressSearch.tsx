import type { Map as MapboxMap } from 'mapbox-gl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SiteLocation } from '../types'

/** Mapbox Geocoding API feature (id may be string or number). */
type Feature = {
  id: string | number
  place_name: string
  text: string
  center: [number, number]
}

export function AddressSearch({
  map,
  onSite,
  syncAddress,
}: {
  map: MapboxMap | null
  onSite: (s: SiteLocation) => void
  /** When site is set from URL/share, mirror into the search field */
  syncAddress?: string | null
}) {
  const token = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Feature[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const runSearch = useCallback(
    (query: string) => {
      if (!token || query.trim().length < 2) {
        setResults([])
        return
      }
      setLoading(true)
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      )
      url.searchParams.set('access_token', token)
      url.searchParams.set('limit', '6')
      url.searchParams.set('types', 'address,place,poi,locality,neighborhood,region,country')
      fetch(url.toString())
        .then((r) => r.json())
        .then((j) => {
          setResults((j.features as Feature[]) ?? [])
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    },
    [token]
  )

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => runSearch(q), 320)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q, runSearch])

  useEffect(() => {
    if (syncAddress) setQ(syncAddress)
  }, [syncAddress])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (!rootRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = useCallback(
    (f: Feature) => {
      const [lng, lat] = f.center
      const site: SiteLocation = {
        lat,
        lng,
        address: f.place_name,
        name: f.text || f.place_name,
      }
      onSite(site)
      setQ(f.place_name)
      setOpen(false)
      if (map) {
        map.flyTo({ center: [lng, lat], zoom: 16, essential: true })
      }
    },
    [map, onSite]
  )

  const useMyLocation = useCallback(() => {
    if (!token) return
    if (!navigator.geolocation) {
      alert('Geolocation not supported in this browser.')
      return
    }
    setLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        try {
          const url = new URL(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`
          )
          url.searchParams.set('access_token', token)
          url.searchParams.set('limit', '1')
          const r = await fetch(url.toString())
          const j = (await r.json()) as { features?: Feature[] }
          const f = j.features?.[0]
          if (f) {
            pick(f)
          } else {
            const site: SiteLocation = {
              lat,
              lng,
              address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              name: 'My location',
            }
            onSite(site)
            setQ(site.address)
            map?.flyTo({ center: [lng, lat], zoom: 16, essential: true })
          }
        } catch {
          alert('Reverse geocode failed.')
        } finally {
          setLoading(false)
        }
      },
      () => {
        setLoading(false)
        alert('Could not read your location (permission denied or unavailable).')
      },
      { enableHighAccuracy: true, timeout: 12_000 }
    )
  }, [token, map, onSite, pick])

  if (!token) {
    return (
      <div className="sonde-search sonde-search--disabled">
        <input
          className="sonde-input"
          disabled
          placeholder="Set VITE_MAPBOX_TOKEN for search"
          aria-label="Address search disabled"
        />
      </div>
    )
  }

  return (
    <div className="sonde-search" ref={rootRef}>
      <div className="sonde-search-row">
        <input
          className="sonde-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search address or place…"
          aria-label="Address search"
          autoComplete="off"
        />
        <button
          type="button"
          className="sonde-btn sonde-btn--ghost sonde-locate-btn"
          onClick={useMyLocation}
          title="Use my location"
          aria-label="Use my location"
        >
          Loc
        </button>
      </div>
      {loading ? <span className="sonde-search-hint">Searching…</span> : null}
      {open && results.length > 0 ? (
        <ul className="sonde-search-results" role="listbox">
          {results.map((f) => (
            <li key={String(f.id)}>
              <button type="button" className="sonde-search-hit" onClick={() => pick(f)}>
                <span className="sonde-search-hit-title">{f.text}</span>
                <span className="sonde-search-hit-sub">{f.place_name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
