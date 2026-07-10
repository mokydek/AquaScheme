/**
 * Conversion between local project coordinates (meters) and geographic
 * coordinates for the map. Survey data uses a local planar system; the map
 * needs lon/lat, so we pin the local origin to an anchor point.
 */

export interface GeoAnchor {
  lon: number
  lat: number
}

/** Default anchor: the Astana region. */
export const DEFAULT_ANCHOR: GeoAnchor = { lon: 71.4, lat: 51.1 }

/** Meters per degree of latitude (spherical approximation). */
const M_PER_DEG_LAT = 111320

export function localToLonLat(
  x: number,
  y: number,
  anchor: GeoAnchor = DEFAULT_ANCHOR,
): [number, number] {
  const lat = anchor.lat + y / M_PER_DEG_LAT
  const lon = anchor.lon + x / (M_PER_DEG_LAT * Math.cos((anchor.lat * Math.PI) / 180))
  return [lon, lat]
}

export function lonLatToLocal(
  lon: number,
  lat: number,
  anchor: GeoAnchor = DEFAULT_ANCHOR,
): { x: number; y: number } {
  const y = (lat - anchor.lat) * M_PER_DEG_LAT
  const x = (lon - anchor.lon) * M_PER_DEG_LAT * Math.cos((anchor.lat * Math.PI) / 180)
  return { x, y }
}
