import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { localToLonLat, lonLatToLocal } from '@aquascheme/engine'
import type { SurveyPoint } from '@aquascheme/engine'
import type { TerrainGeo } from '@aquascheme/engine/terrain'
import type { Feature, FeatureCollection } from 'geojson'
import type { BuildingRow } from '../../shared/datasets'

export interface SourceData {
  x: number
  y: number
  groundElevation?: number
  availableHead?: number
}

type Mode = 'view' | 'addBuilding' | 'moveSource'

interface Props {
  points: SurveyPoint[]
  buildings: BuildingRow[]
  source: SourceData | null
  networkLines: FeatureCollection
  networkJunctions: FeatureCollection
  fittings: FeatureCollection
  problems: FeatureCollection
  parcels?: FeatureCollection
  existingLines?: FeatureCollection
  draftPolygon?: Array<{ x: number; y: number }>
  violationPipeIds?: string[]
  pressureByBuilding: Record<string, { pressureM: number; ok: boolean; requiredPressureM: number | null }>
  hasResults: boolean
  placementActive?: boolean
  drawingActive?: boolean
  onAddBuilding: (x: number, y: number) => Promise<void>
  onMoveSource: (x: number, y: number) => Promise<void>
  onDeleteBuilding: (id: string) => Promise<void>
  onPlaceObject?: (x: number, y: number) => void
  onDrawVertex?: (x: number, y: number) => void
}

const VELOCITY_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'velocity'], 0],
  0,
  '#b7bfcc',
  0.7,
  '#9bb0ea',
  1.5,
  '#0033cc',
  2.5,
  '#001a66',
]

const PRESSURE_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'pressure'], 0],
  0,
  '#e2e7f9',
  30,
  '#7189e2',
  60,
  '#0033cc',
]

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const MODES: Mode[] = ['view', 'addBuilding', 'moveSource']

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function num(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : String(value ?? '')
}

/** Build a compact key/value block for a map popup. */
function kvBlock(rows: Array<[string, string]>): HTMLDivElement {
  const block = document.createElement('div')
  block.className = 'map-popup-kv'
  for (const [key, value] of rows) {
    const k = document.createElement('span')
    k.className = 'map-popup-k'
    k.textContent = key
    const v = document.createElement('span')
    v.className = 'map-popup-v'
    v.textContent = value
    block.append(k, v)
  }
  return block
}

/** Axis aligned rectangle around a local point, in geographic coordinates. */
function rectFeature(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  properties: Record<string, unknown>,
): Feature {
  const ring = [
    localToLonLat(x - halfW, y - halfH),
    localToLonLat(x + halfW, y - halfH),
    localToLonLat(x + halfW, y + halfH),
    localToLonLat(x - halfW, y + halfH),
    localToLonLat(x - halfW, y - halfH),
  ]
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } }
}

export function ProjectMap({
  points,
  buildings,
  source,
  networkLines,
  networkJunctions,
  fittings,
  problems,
  parcels,
  existingLines,
  draftPolygon,
  violationPipeIds,
  pressureByBuilding,
  hasResults,
  placementActive = false,
  drawingActive = false,
  onAddBuilding,
  onMoveSource,
  onDeleteBuilding,
  onPlaceObject,
  onDrawVertex,
}: Props) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const modeRef = useRef<Mode>('view')
  const fittedRef = useRef(false)
  const terrainKeyRef = useRef('')
  const [mode, setMode] = useState<Mode>('view')
  const [basemap, setBasemap] = useState<'osm' | 'blank'>('osm')
  const [ready, setReady] = useState(false)

  const toggleBasemap = () => {
    const next = basemap === 'osm' ? 'blank' : 'osm'
    setBasemap(next)
    const map = mapRef.current
    if (map && ready) {
      map.setLayoutProperty('osm', 'visibility', next === 'osm' ? 'visible' : 'none')
    }
  }

  // Keep the latest callbacks and popup labels visible to map handlers.
  const callbacksRef = useRef({ onAddBuilding, onMoveSource, onDeleteBuilding, onPlaceObject, onDrawVertex })
  callbacksRef.current = { onAddBuilding, onMoveSource, onDeleteBuilding, onPlaceObject, onDrawVertex }
  const placementRef = useRef(placementActive)
  placementRef.current = placementActive
  const drawingRef = useRef(drawingActive)
  drawingRef.current = drawingActive
  const labelsRef = useRef<Record<string, string>>({})
  labelsRef.current = {
    floors: t('project.map.floors'),
    residents: t('project.map.residents'),
    remove: t('project.map.delete'),
    pressure: t('project.map.pop.pressure'),
    required: t('project.map.pop.required'),
    head: t('project.map.pop.head'),
    elevation: t('project.map.pop.elevation'),
    diameter: t('project.map.pop.diameter'),
    length: t('project.map.pop.length'),
    flow: t('project.map.pop.flow'),
    velocity: t('project.map.pop.velocity'),
    headloss: t('project.map.pop.headloss'),
    well: t('project.map.pop.well'),
    fittings: t('project.map.pop.fittings'),
  }

  useEffect(() => {
    modeRef.current = mode
    const map = mapRef.current
    if (map) {
      map.getCanvas().style.cursor =
        mode === 'view' && !placementActive && !drawingActive ? '' : 'crosshair'
    }
  }, [mode, placementActive, drawingActive])

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            paint: { 'raster-saturation': -1, 'raster-opacity': 0.55 },
          },
        ],
      },
      center: localToLonLat(330, 225),
      zoom: 14,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource('tin', { type: 'geojson', data: EMPTY_FC })
      map.addSource('contours', { type: 'geojson', data: EMPTY_FC })
      map.addSource('buildings', { type: 'geojson', data: EMPTY_FC })
      map.addSource('source-point', { type: 'geojson', data: EMPTY_FC })

      map.addLayer({
        id: 'tin',
        type: 'line',
        source: 'tin',
        paint: { 'line-color': '#d9d9d9', 'line-width': 0.4, 'line-opacity': 0.6 },
      })
      map.addLayer({
        id: 'contours',
        type: 'line',
        source: 'contours',
        paint: { 'line-color': '#a3a3a3', 'line-width': 0.9 },
      })
      map.addLayer({
        id: 'contour-labels',
        type: 'symbol',
        source: 'contours',
        layout: {
          'symbol-placement': 'line',
          'text-field': ['to-string', ['get', 'z']],
          'text-size': 10,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': '#7a7a7a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      })
      map.addSource('parcels', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        paint: {
          'fill-color': ['case', ['==', ['get', 'kind'], 'right_of_way'], '#0033cc', '#8a8a8a'],
          'fill-opacity': 0.05,
        },
      })
      map.addLayer({
        id: 'parcels-outline',
        type: 'line',
        source: 'parcels',
        paint: {
          'line-color': ['case', ['==', ['get', 'kind'], 'right_of_way'], '#0033cc', '#8a8a8a'],
          'line-width': 1,
          'line-dasharray': ['case', ['==', ['get', 'kind'], 'right_of_way'], ['literal', [4, 3]], ['literal', [1, 0]]],
        },
      })
      // Existing network (reconstruction): thin lines, dashed by decision.
      map.addSource('existing', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'existing-lines',
        type: 'line',
        source: 'existing',
        paint: {
          'line-color': '#6a6a6a',
          'line-width': 1,
          'line-dasharray': [
            'case',
            ['==', ['get', 'decision'], 'replace'],
            ['literal', [1, 2]],
            ['==', ['get', 'decision'], 'rehabilitate'],
            ['literal', [4, 3]],
            ['literal', [1, 0]],
          ],
        },
      })
      map.addSource('net-lines', { type: 'geojson', data: EMPTY_FC })
      map.addSource('net-junctions', { type: 'geojson', data: EMPTY_FC })
      map.addSource('problems', { type: 'geojson', data: EMPTY_FC })
      map.addSource('parcel-draft', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'pipes-service',
        type: 'line',
        source: 'net-lines',
        filter: ['==', ['get', 'kind'], 'service'],
        paint: {
          'line-color': '#0033cc',
          'line-width': 1,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        },
      })
      map.addLayer({
        id: 'pipes-main',
        type: 'line',
        source: 'net-lines',
        filter: ['!=', ['get', 'kind'], 'service'],
        paint: { 'line-color': '#0033cc', 'line-width': 2 },
      })
      // Foreign parcel crossings: bold dashed black overlay.
      map.addLayer({
        id: 'pipes-violation',
        type: 'line',
        source: 'net-lines',
        filter: ['in', ['get', 'engineId'], ['literal', []]],
        paint: { 'line-color': '#0a0a0a', 'line-width': 3, 'line-dasharray': [2, 2] },
      })
      // Transparent wide hit target so thin pipes are clickable.
      map.addLayer({
        id: 'pipes-hit',
        type: 'line',
        source: 'net-lines',
        paint: { 'line-color': '#000000', 'line-width': 12, 'line-opacity': 0 },
      })
      map.addLayer({
        id: 'net-junctions',
        type: 'circle',
        source: 'net-junctions',
        paint: {
          'circle-radius': 3,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#0033cc',
          'circle-stroke-width': 1.25,
        },
      })
      map.addSource('fittings', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'fittings-labels',
        type: 'symbol',
        source: 'fittings',
        layout: {
          'text-field': ['get', 'marks'],
          'text-size': 9,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom',
        },
        paint: {
          'text-color': '#0033cc',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      })
      map.addLayer({
        id: 'buildings-fill',
        type: 'fill',
        source: 'buildings',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.9 },
      })
      map.addLayer({
        id: 'buildings-outline',
        type: 'line',
        source: 'buildings',
        paint: { 'line-color': '#0a0a0a', 'line-width': 1.2 },
      })
      map.addLayer({
        id: 'building-labels',
        type: 'symbol',
        source: 'buildings',
        layout: {
          'text-field': ['get', 'title'],
          'text-size': 10,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#0a0a0a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      })
      map.addLayer({
        id: 'source-fill',
        type: 'fill',
        source: 'source-point',
        paint: { 'fill-color': '#0033cc' },
      })
      // Problem nodes: a bold ring drawn on top of everything.
      map.addLayer({
        id: 'problem-rings',
        type: 'circle',
        source: 'problems',
        paint: {
          'circle-radius': 9,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#0a0a0a',
          'circle-stroke-width': 1.6,
        },
      })
      // Parcel being drawn.
      map.addLayer({
        id: 'parcel-draft-line',
        type: 'line',
        source: 'parcel-draft',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#0033cc', 'line-width': 1.5, 'line-dasharray': [3, 2] },
      })
      map.addLayer({
        id: 'parcel-draft-points',
        type: 'circle',
        source: 'parcel-draft',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 3, 'circle-color': '#0033cc' },
      })
      setReady(true)
    })

    map.on('click', (e) => {
      const { x, y } = lonLatToLocal(e.lngLat.lng, e.lngLat.lat)
      if (drawingRef.current) {
        callbacksRef.current.onDrawVertex?.(round2(x), round2(y))
        return
      }
      if (placementRef.current) {
        callbacksRef.current.onPlaceObject?.(round2(x), round2(y))
        return
      }
      const current = modeRef.current
      if (current === 'view') return
      if (current === 'addBuilding') {
        void callbacksRef.current.onAddBuilding(round2(x), round2(y))
      } else {
        void callbacksRef.current.onMoveSource(round2(x), round2(y))
      }
    })

    map.on('click', 'buildings-fill', (e) => {
      if (modeRef.current !== 'view' || placementRef.current) return
      const feature = e.features?.[0]
      if (!feature) return
      const props = feature.properties as {
        id: string
        title: string
        floors: number
        residents: number
        pressure?: number | null
        required?: number | null
      }
      const labels = labelsRef.current
      const content = document.createElement('div')
      content.className = 'map-popup'
      const title = document.createElement('p')
      title.className = 'map-popup-title'
      title.textContent = props.title || '—'
      content.append(title)
      const rows: Array<[string, string]> = [
        [labels.floors, String(props.floors)],
        [labels.residents, String(props.residents)],
      ]
      if (props.pressure !== undefined && props.pressure !== null) {
        const required = props.required != null ? ` / ${Number(props.required).toFixed(0)}` : ''
        rows.push([labels.pressure, `${Number(props.pressure).toFixed(1)}${required}`])
      }
      content.append(kvBlock(rows))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'link-btn'
      remove.textContent = labels.remove
      const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setDOMContent(content)
        .addTo(map)
      remove.addEventListener('click', () => {
        popup.remove()
        void callbacksRef.current.onDeleteBuilding(props.id)
      })
      content.append(remove)
    })

    map.on('click', 'pipes-hit', (e) => {
      if (modeRef.current !== 'view' || placementRef.current) return
      const feature = e.features?.[0]
      if (!feature) return
      const p = feature.properties as Record<string, unknown>
      const labels = labelsRef.current
      const content = document.createElement('div')
      content.className = 'map-popup'
      const title = document.createElement('p')
      title.className = 'map-popup-title'
      title.textContent = String(p.title ?? p.engineId ?? '')
      content.append(title)
      const rows: Array<[string, string]> = [[labels.length, `${num(p.length)} м`]]
      if (p.diameter != null) rows.push([labels.diameter, `${num(p.diameter)}`])
      if (p.flow != null) rows.push([labels.flow, `${num(p.flow)}`])
      if (p.velocity != null) rows.push([labels.velocity, `${num(p.velocity)}`])
      if (p.headloss != null) rows.push([labels.headloss, `${num(p.headloss)}`])
      content.append(kvBlock(rows))
      new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setDOMContent(content)
        .addTo(map)
    })

    map.on('click', 'net-junctions', (e) => {
      if (modeRef.current !== 'view' || placementRef.current) return
      const feature = e.features?.[0]
      if (!feature) return
      const p = feature.properties as Record<string, unknown>
      const labels = labelsRef.current
      const content = document.createElement('div')
      content.className = 'map-popup'
      const title = document.createElement('p')
      title.className = 'map-popup-title'
      const well = p.well ? `${p.well} · ` : ''
      title.textContent = `${well}${p.label ?? ''}`
      content.append(title)
      const rows: Array<[string, string]> = []
      if (p.elevation != null) rows.push([labels.elevation, num(p.elevation)])
      if (p.head != null) rows.push([labels.head, num(p.head)])
      if (p.pressure != null) rows.push([labels.pressure, num(p.pressure)])
      if (p.marks) rows.push([labels.fittings, String(p.marks)])
      if (rows.length > 0) content.append(kvBlock(rows))
      new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setDOMContent(content)
        .addTo(map)
    })

    for (const layer of ['buildings-fill', 'pipes-hit', 'net-junctions']) {
      map.on('mouseenter', layer, () => {
        if (modeRef.current === 'view') map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        if (modeRef.current === 'view') map.getCanvas().style.cursor = ''
      })
    }

    mapRef.current = map
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Terrain: recompute in a worker when survey points actually change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || points.length < 3) return
    const first = points[0]
    const last = points[points.length - 1]
    const key = `${points.length}:${first.x}:${first.y}:${first.z}:${last.z}`
    if (key === terrainKeyRef.current) return
    terrainKeyRef.current = key

    workerRef.current?.terminate()
    const worker = new Worker(new URL('../../workers/terrain.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<TerrainGeo>) => {
      const { tin, contours, bbox } = event.data
      const current = mapRef.current
      if (current) {
        ;(current.getSource('tin') as maplibregl.GeoJSONSource).setData(tin)
        ;(current.getSource('contours') as maplibregl.GeoJSONSource).setData(contours)
        if (!fittedRef.current) {
          fittedRef.current = true
          current.fitBounds(
            [
              [bbox[0], bbox[1]],
              [bbox[2], bbox[3]],
            ],
            { padding: 48, duration: 0 },
          )
        }
      }
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    worker.postMessage({ points })
  }, [ready, points])

  // Buildings and source markers.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const buildingsFc: FeatureCollection = {
      type: 'FeatureCollection',
      features: buildings.map((b) => {
        const p = pressureByBuilding[b.id]
        return rectFeature(b.x, b.y, 7, 5, {
          id: b.id,
          title: b.label ?? '',
          floors: b.floors,
          residents: b.residents ?? 0,
          pressure: p ? p.pressureM : null,
          required: p ? p.requiredPressureM : null,
        })
      }),
    }
    ;(map.getSource('buildings') as maplibregl.GeoJSONSource).setData(buildingsFc)
    map.setPaintProperty('buildings-fill', 'fill-color', hasResults ? PRESSURE_COLOR : '#ffffff')
    map.setPaintProperty('buildings-fill', 'fill-opacity', hasResults ? 0.85 : 0.9)
    const sourceFc: FeatureCollection = {
      type: 'FeatureCollection',
      features: source ? [rectFeature(source.x, source.y, 8, 8, {})] : [],
    }
    ;(map.getSource('source-point') as maplibregl.GeoJSONSource).setData(sourceFc)
  }, [ready, buildings, source, pressureByBuilding, hasResults])

  // Traced network: pipes, junction nodes, fittings and problem rings.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('net-lines') as maplibregl.GeoJSONSource).setData(networkLines)
    ;(map.getSource('net-junctions') as maplibregl.GeoJSONSource).setData(networkJunctions)
    ;(map.getSource('fittings') as maplibregl.GeoJSONSource).setData(fittings)
    ;(map.getSource('problems') as maplibregl.GeoJSONSource).setData(problems)
    map.setPaintProperty('pipes-main', 'line-color', hasResults ? VELOCITY_COLOR : '#0033cc')
    map.setFilter('pipes-violation', ['in', ['get', 'engineId'], ['literal', violationPipeIds ?? []]])
  }, [ready, networkLines, networkJunctions, fittings, problems, hasResults, violationPipeIds])

  // Parcels and the polygon being drawn.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('parcels') as maplibregl.GeoJSONSource).setData(parcels ?? EMPTY_FC)
    ;(map.getSource('existing') as maplibregl.GeoJSONSource).setData(existingLines ?? EMPTY_FC)

    const draftFeatures: Feature[] = []
    const draft = draftPolygon ?? []
    if (draft.length >= 1) {
      draftFeatures.push(...draft.map((p) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: localToLonLat(p.x, p.y) },
      })))
      if (draft.length >= 2) {
        const ring = draft.length >= 3 ? [...draft, draft[0]] : draft
        draftFeatures.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: ring.map((p) => localToLonLat(p.x, p.y)) },
        })
      }
    }
    ;(map.getSource('parcel-draft') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: draftFeatures,
    })
  }, [ready, parcels, existingLines, draftPolygon])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('project.map.title')}</h2>
        <span className={`badge${points.length > 0 ? ' ok' : ''}`}>
          {t(`project.status.${points.length > 0 ? 'filled' : 'empty'}`)}
        </span>
      </div>
      <div className="map-toolbar">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`btn btn-ghost btn-sm${mode === m ? ' active' : ''}`}
            onClick={() => setMode(m)}
          >
            {t(`project.map.${m}`)}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleBasemap}>
          {t(`project.map.basemap.${basemap}`)}
        </button>
        <span className="hint map-hint">{t(`project.map.hint.${mode}`)}</span>
      </div>
      {hasResults && (
        <div className="map-legend">
          <span className="legend-item">
            <span className="legend-swatch legend-velocity" />
            {t('project.map.legend.velocity')}
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-pressure" />
            {t('project.map.legend.pressure')}
          </span>
          <span className="legend-item">
            <span className="legend-ring" />
            {t('project.map.legend.problem')}
          </span>
        </div>
      )}
      <div ref={containerRef} className="map-container" />
    </section>
  )
}
