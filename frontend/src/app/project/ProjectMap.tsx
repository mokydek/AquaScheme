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
  onAddBuilding: (x: number, y: number) => Promise<void>
  onMoveSource: (x: number, y: number) => Promise<void>
  onDeleteBuilding: (id: string) => Promise<void>
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const MODES: Mode[] = ['view', 'addBuilding', 'moveSource']

function round2(value: number): number {
  return Math.round(value * 100) / 100
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
  onAddBuilding,
  onMoveSource,
  onDeleteBuilding,
}: Props) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const modeRef = useRef<Mode>('view')
  const fittedRef = useRef(false)
  const terrainKeyRef = useRef('')
  const [mode, setMode] = useState<Mode>('view')
  const [ready, setReady] = useState(false)

  // Keep the latest callbacks and popup labels visible to map handlers.
  const callbacksRef = useRef({ onAddBuilding, onMoveSource, onDeleteBuilding })
  callbacksRef.current = { onAddBuilding, onMoveSource, onDeleteBuilding }
  const labelsRef = useRef({ floors: '', residents: '', remove: '' })
  labelsRef.current = {
    floors: t('project.map.floors'),
    residents: t('project.map.residents'),
    remove: t('project.map.delete'),
  }

  useEffect(() => {
    modeRef.current = mode
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = mode === 'view' ? '' : 'crosshair'
  }, [mode])

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
      setReady(true)
    })

    map.on('click', (e) => {
      const current = modeRef.current
      if (current === 'view') return
      const { x, y } = lonLatToLocal(e.lngLat.lng, e.lngLat.lat)
      if (current === 'addBuilding') {
        void callbacksRef.current.onAddBuilding(round2(x), round2(y))
      } else {
        void callbacksRef.current.onMoveSource(round2(x), round2(y))
      }
    })

    map.on('click', 'buildings-fill', (e) => {
      if (modeRef.current !== 'view') return
      const feature = e.features?.[0]
      if (!feature) return
      const props = feature.properties as {
        id: string
        title: string
        floors: number
        residents: number
      }
      const labels = labelsRef.current
      const content = document.createElement('div')
      content.className = 'map-popup'
      const info = document.createElement('p')
      const title = props.title ? `${props.title} · ` : ''
      info.textContent = `${title}${labels.floors}: ${props.floors} · ${labels.residents}: ${props.residents}`
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
      content.append(info, remove)
    })

    map.on('mouseenter', 'buildings-fill', () => {
      if (modeRef.current === 'view') map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'buildings-fill', () => {
      if (modeRef.current === 'view') map.getCanvas().style.cursor = ''
    })

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
      features: buildings.map((b) =>
        rectFeature(b.x, b.y, 7, 5, {
          id: b.id,
          title: b.label ?? '',
          floors: b.floors,
          residents: b.residents ?? 0,
        }),
      ),
    }
    ;(map.getSource('buildings') as maplibregl.GeoJSONSource).setData(buildingsFc)
    const sourceFc: FeatureCollection = {
      type: 'FeatureCollection',
      features: source ? [rectFeature(source.x, source.y, 8, 8, {})] : [],
    }
    ;(map.getSource('source-point') as maplibregl.GeoJSONSource).setData(sourceFc)
  }, [ready, buildings, source])

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
        <span className="hint map-hint">{t(`project.map.hint.${mode}`)}</span>
      </div>
      <div ref={containerRef} className="map-container" />
    </section>
  )
}
