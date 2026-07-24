import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { TracedNetwork } from '@aquascheme/engine'

type LocalPoint = { x: number; y: number }

/**
 * Project-specific affine georeference for 2024-51-НК. The local DWG frame is
 * anchored to the Bolshoy Taldykol / Nura district map using the outlet in the
 * north, the lake centre and the south-eastern OS III-4 end of the scheme.
 * It is deliberately isolated here: an unrelated project must provide its own
 * coordinate reference instead of silently reusing this transform.
 */
function project202451ToWgs84(point: LocalPoint): L.LatLngExpression {
  const westX = -7045
  const eastX = -3728
  const northY = 172
  const southY = -9807
  const longitude = 71.300 + ((point.x - westX) / (eastX - westX)) * 0.065
  const latitude = 51.175 - ((northY - point.y) / (northY - southY)) * 0.084
  return [latitude, longitude]
}

function diameterColor(diameter: number | undefined): string {
  if (!diameter) return '#24489b'
  if (diameter >= 2000) return '#173f9f'
  if (diameter >= 1600) return '#315cc6'
  if (diameter >= 1200) return '#1479c9'
  return '#8a35b5'
}

export function LiveSituationMap({
  network,
  pipeDiameterMm,
  pipeDisplayLabel,
  buildings,
  corridorRings,
  outletFlowLps,
}: {
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  pipeDisplayLabel?: Map<string, string>
  buildings: Array<{ x: number; y: number; label?: string | null }>
  corridorRings: Array<Array<LocalPoint>>
  outletFlowLps?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = L.map(container, { zoomControl: true, preferCanvas: true, minZoom: 10, maxZoom: 19 })
    const streetMap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
    const satelliteMap = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        crossOrigin: true,
        attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
      },
    )
    const reliefMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      crossOrigin: true,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap',
    })
    streetMap.addTo(map)

    const bounds = L.latLngBounds([])
    const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
    const corridorLayer = L.layerGroup()

    for (const ring of corridorRings) {
      const positions = ring.map(project202451ToWgs84)
      if (positions.length < 2) continue
      // The DWG corridor is a folded boundary chain, not a safe fill polygon.
      // Filling it creates the large self-intersecting "blue blinds" seen in the UI.
      L.polyline(positions, { color: '#c43131', weight: 2, opacity: 0.9, dashArray: '7 6' })
        .bindTooltip('Проверочный контур полосы отвода (без заливки)')
        .addTo(corridorLayer)
    }

    let previousMainLabel: string | undefined
    for (const pipe of network.pipes) {
      const from = nodeById.get(pipe.fromNode)
      const to = nodeById.get(pipe.toNode)
      if (!from || !to) continue
      const fromPosition = project202451ToWgs84(from)
      const toPosition = project202451ToWgs84(to)
      const diameter = pipeDiameterMm.get(pipe.id)
      const diameterLabel = pipeDisplayLabel?.get(pipe.id) ?? (diameter ? `Ø${diameter}` : 'Ø—')
      const isService = pipe.kind === 'service'
      const line = L.polyline([fromPosition, toPosition], {
        color: isService ? '#c53364' : diameterColor(diameter),
        weight: isService ? 3 : 6,
        opacity: 0.94,
        dashArray: isService ? '7 5' : undefined,
      }).addTo(map)
      line.bindTooltip(
        `<strong>${isService ? 'Подключение ОС' : 'Проектный коллектор'}</strong><br>${diameterLabel} мм<br>${pipe.lengthM.toFixed(1)} м`,
        { sticky: true },
      )
      const a = L.latLng(fromPosition)
      const b = L.latLng(toPosition)
      const midpoint = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)
      const showDiameterLabel = isService ? pipe.lengthM > 1 : diameterLabel !== previousMainLabel
      if (showDiameterLabel && diameter) {
        L.marker(midpoint, {
          interactive: false,
          icon: L.divIcon({ className: 'pipe-map-diameter', html: diameterLabel, iconSize: [68, 18], iconAnchor: [34, 9] }),
        }).addTo(map)
      }
      if (!isService) previousMainLabel = diameterLabel
      bounds.extend(fromPosition)
      bounds.extend(toPosition)
    }

    for (const building of buildings) {
      const position = project202451ToWgs84(building)
      L.circleMarker(position, { radius: 6, color: '#8d142f', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(building.label || 'Очистное сооружение', { permanent: true, direction: 'right', className: 'source-map-label' })
        .addTo(map)
      bounds.extend(position)
    }

    const outlet = network.nodes.find((node) => node.kind === 'source')
    if (outlet) {
      const position = project202451ToWgs84(outlet)
      L.circleMarker(position, { radius: 7, color: '#111', weight: 2, fillColor: '#173f9f', fillOpacity: 1 })
        .bindTooltip(`Оголовок / выпуск${outletFlowLps == null ? '' : `<br>${outletFlowLps.toFixed(1)} л/с`}`, { permanent: true, direction: 'right' })
        .addTo(map)
      bounds.extend(position)
    }

    const legend = new L.Control({ position: 'bottomleft' })
    legend.onAdd = () => {
      const element = L.DomUtil.create('div', 'situation-map-legend')
      element.innerHTML = '<strong>Проектная сеть</strong><span><i class="main"></i>ось коллектора</span><span><i class="service"></i>подключение ОС</span><span><i class="corridor"></i>полоса отвода (опция)</span>'
      return element
    }
    legend.addTo(map)

    L.control.layers(
      {
        'Карта OSM': streetMap,
        'Спутник Esri': satelliteMap,
        'Рельеф OpenTopoMap': reliefMap,
      },
      {
        'Полоса отвода (проверочная)': corridorLayer,
      },
      { collapsed: false, position: 'topright' },
    ).addTo(map)

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [38, 38], maxZoom: 14 })
    else map.setView([51.12433, 71.33639], 13)
    setReady(true)

    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      map.remove()
      setReady(false)
    }
  }, [network, pipeDiameterMm, pipeDisplayLabel, buildings, corridorRings, outletFlowLps])

  return (
    <div className="live-situation-map-wrap">
      {!ready && <div className="live-map-loading"><span className="export-progress-spinner" />Загрузка настоящей карты…</div>}
      <div ref={containerRef} className="live-situation-map" aria-label="Интерактивная карта с проектной трассой коллектора" />
      <p className="reference-source-note">
        Подложка переключается между картой, спутником и обзорным рельефом. Ось трассы и подключения взяты из данных DWG проекта 2024-51-НК; проектные диаметры не подменяются автоматическим гидравлическим подбором. Инженерные отметки рельефа учитываются в продольном профиле и расчёте, а не меняют план трассы. Полоса отвода доступна отдельным выключенным слоем и никогда не заливается.
      </p>
    </div>
  )
}
