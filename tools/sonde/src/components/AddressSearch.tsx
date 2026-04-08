import type { Map as MapboxMap } from 'mapbox-gl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SiteLocation } from '../types'

type Feature = {
  id: string
  place_name: string
  text: string
  center: [number, number]
}

export function AddressSearch({
  map,
  onSite,
}: {
  map: MapboxMap | null
  onSite: (s: SiteLocation) => void
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
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (f: Feature) => {
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
  }

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
      {loading ? <span className="sonde-search-hint">Searching…</span> : null}
      {open && results.length > 0 ? (
        <ul className="sonde-search-results" role="listbox">
          {results.map((f) => (
            <li key={f.id}>
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
