import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { localToLonLat } from '@aquascheme/engine'
import type { RouteConstraintInput, RouteGeoreference, TracedNetwork } from '@aquascheme/engine'

type LocalPoint = { x: number; y: number }

function projectionFor(georeference: RouteGeoreference | undefined): {
  geographic: boolean
  point: (point: LocalPoint) => L.LatLngExpression
} {
  if (georeference?.kind === 'affine_bounds') {
    return {
      geographic: true,
      point: (point) => {
        const longitude = georeference.westLon
          + ((point.x - georeference.westX) / (georeference.eastX - georeference.westX))
          * (georeference.eastLon - georeference.westLon)
        const latitude = georeference.northLat
          - ((georeference.northY - point.y) / (georeference.northY - georeference.southY))
          * (georeference.northLat - georeference.southLat)
        return [latitude, longitude]
      },
    }
  }
  if (georeference?.kind === 'local_anchor') {
    return {
      geographic: true,
      point: (point) => {
        const [longitude, latitude] = localToLonLat(point.x, point.y, georeference.anchor)
        return [latitude, longitude]
      },
    }
  }
  return { geographic: false, point: (point) => [point.y, point.x] }
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
  pipePaths,
  verifiedProjectGeometryOnly = false,
  buildings,
  corridorRings,
  constraints,
  outletFlowLps,
}: {
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  pipeDisplayLabel?: Map<string, string>
  pipePaths?: Map<string, LocalPoint[]>
  verifiedProjectGeometryOnly?: boolean
  buildings: Array<{ x: number; y: number; label?: string | null }>
  corridorRings: Array<Array<LocalPoint>>
  constraints?: RouteConstraintInput
  outletFlowLps?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const projection = projectionFor(constraints?.georeference)
    const toMapPoint = projection.point
    const map = L.map(container, {
      zoomControl: true,
      preferCanvas: true,
      minZoom: projection.geographic ? 10 : -5,
      maxZoom: projection.geographic ? 19 : 5,
      crs: projection.geographic ? L.CRS.EPSG3857 : L.CRS.Simple,
    })
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
    if (projection.geographic) streetMap.addTo(map)

    const bounds = L.latLngBounds([])
    const nodeById = new Map(network.nodes.map((node) => [node.id, node]))
    const corridorLayer = L.layerGroup()
    const redLineLayer = L.layerGroup()
    const utilityLayer = L.layerGroup()
    const roadLayer = L.layerGroup()
    const waterLayer = L.layerGroup()
    const obstacleLayer = L.layerGroup()

    for (const ring of corridorRings) {
      const positions = ring.map(toMapPoint)
      if (positions.length < 2) continue
      // The DWG corridor is a folded boundary chain, not a safe fill polygon.
      // Filling it creates the large self-intersecting "blue blinds" seen in the UI.
      L.polyline(positions, { color: '#c43131', weight: 2, opacity: 0.9, dashArray: '7 6' })
        .bindTooltip('Проверочный контур полосы отвода (без заливки)')
        .addTo(corridorLayer)
    }

    const drawSegments = (segments: RouteConstraintInput['redLines'], layer: L.LayerGroup, color: string, dashArray?: string) => {
      for (const segment of segments ?? []) {
        if (segment.points.length < 2) continue
        L.polyline(segment.points.map(toMapPoint), { color, weight: 2, opacity: 0.8, dashArray }).addTo(layer)
      }
    }
    drawSegments(constraints?.redLines, redLineLayer, '#d11b37', '8 5')
    drawSegments(constraints?.utilityLines, utilityLayer, '#8b4e18', '3 4')
    drawSegments(constraints?.roadLines, roadLayer, '#6a6a6a')
    drawSegments(constraints?.waterLines, waterLayer, '#1689c7')
    for (const ring of constraints?.hardObstacleRings ?? []) {
      L.polygon(ring.map(toMapPoint), { color: '#7a1a1a', fillColor: '#d84c4c', fillOpacity: 0.25, weight: 1 }).addTo(obstacleLayer)
    }

    const diameterLabelPoints: LocalPoint[] = []
    let serviceDiameterLabels = 0
    const localDistance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.x - b.x, a.y - b.y)
    for (const pipe of network.pipes) {
      const from = nodeById.get(pipe.fromNode)
      const to = nodeById.get(pipe.toNode)
      if (!from || !to) continue
      const localPath = pipePaths?.get(pipe.id) ?? pipe.alignment ?? [from, to]
      const positions = localPath.map(toMapPoint)
      const diameter = pipeDiameterMm.get(pipe.id)
      const diameterLabel = pipeDisplayLabel?.get(pipe.id) ?? (diameter ? `Ø${diameter}` : 'Ø—')
      const isService = pipe.kind === 'service' || pipe.kind === 'inlet' || pipe.kind === 'facility_connection' || Boolean(from.buildingId || to.buildingId)
      const isPressure = pipe.kind === 'pressure_main' || pipe.kind === 'discharge' || pipe.systemType === 'pressure'
      if (verifiedProjectGeometryOnly && isService && !pipePaths?.has(pipe.id)) continue
      const line = L.polyline(positions, {
        color: isPressure ? '#e17b16' : isService ? '#c53364' : diameterColor(diameter),
        weight: isService ? 3 : 6,
        opacity: 0.94,
        dashArray: isService ? '7 5' : undefined,
      }).addTo(map)
      line.bindTooltip(
        `<strong>${isPressure ? 'Напорный водовод от ЛНС' : isService ? 'Подключение ОС' : 'Самотёчный коллектор'}</strong><br>${diameterLabel} мм<br>${pipe.lengthM.toFixed(1)} м`,
        { sticky: true },
      )
      const localMidpoint = localPath[Math.floor(localPath.length / 2)]
      const midpoint = L.latLng(positions[Math.floor(positions.length / 2)])
      // The hydraulic model may contain many short calculation sections.
      // Labeling every section made dozens of identical white boxes overlap.
      // Keep the underlying sections and tooltips, but place readable plan
      // labels only at a safe cartographic interval.
      const labelSpacingM = isService ? 1_200 : 900
      const hasClearLabelSpace = diameterLabelPoints.every((point) => localDistance(point, localMidpoint) >= labelSpacingM)
      const showDiameterLabel = hasClearLabelSpace
        && diameterLabelPoints.length < 10
        && (!isService || (pipe.lengthM >= 120 && serviceDiameterLabels < 4))
      if (showDiameterLabel && diameter) {
        L.marker(midpoint, {
          interactive: false,
          icon: L.divIcon({ className: 'pipe-map-diameter', html: diameterLabel, iconSize: [68, 18], iconAnchor: [34, 9] }),
        }).addTo(map)
        diameterLabelPoints.push(localMidpoint)
        if (isService) serviceDiameterLabels++
      }
      positions.forEach((position) => bounds.extend(position))
    }

    for (const building of buildings) {
      const position = toMapPoint(building)
      L.circleMarker(position, { radius: 6, color: '#8d142f', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(building.label || 'Очистное сооружение', { permanent: true, direction: 'right', className: 'source-map-label' })
        .addTo(map)
      bounds.extend(position)
    }

    const outlet = network.nodes.find((node) => node.kind === 'outlet' || node.kind === 'outfall' || node.kind === 'source')
    if (outlet) {
      const position = toMapPoint(outlet)
      L.circleMarker(position, { radius: 7, color: '#111', weight: 2, fillColor: '#173f9f', fillOpacity: 1 })
        .bindTooltip(`Оголовок / выпуск${outletFlowLps == null ? '' : `<br>${outletFlowLps.toFixed(1)} л/с`}`, { permanent: true, direction: 'right' })
        .addTo(map)
      bounds.extend(position)
    }
    const lns = network.nodes.find((node) => node.kind === 'lns_inlet' || node.kind === 'lns_outlet' || node.kind === 'pumping_station')
    if (lns) {
      const position = toMapPoint(lns)
      L.marker(position, { icon: L.divIcon({ className: 'source-map-label', html: '<strong>ЛНС</strong>', iconSize: [54, 24], iconAnchor: [27, 12] }) })
        .bindTooltip(`ЛНС${lns.designFlowLps == null ? '' : `<br>${lns.designFlowLps.toFixed(1)} л/с`}`)
        .addTo(map)
      bounds.extend(position)
    }

    const legend = new L.Control({ position: 'bottomleft' })
    legend.onAdd = () => {
      const element = L.DomUtil.create('div', 'situation-map-legend')
      element.innerHTML = '<strong>Проектная сеть</strong><span><i class="main"></i>самотёчный коллектор</span><span><i class="service"></i>подключение ОС</span><span style="color:#e17b16">━━ напорный водовод</span><span><i class="corridor"></i>полоса отвода</span>'
      return element
    }
    legend.addTo(map)

    L.control.layers(
      projection.geographic ? {
        'Карта OSM': streetMap,
        'Спутник Esri': satelliteMap,
        'Рельеф OpenTopoMap': reliefMap,
      } : {},
      {
        'Полоса отвода (проверочная)': corridorLayer,
        'Красные линии DWG': redLineLayer,
        'Коммуникации DWG': utilityLayer,
        'Дороги DWG': roadLayer,
        'Гидрография DWG': waterLayer,
        'Запретные сооружения': obstacleLayer,
      },
      { collapsed: false, position: 'topright' },
    ).addTo(map)

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [38, 38], maxZoom: 14 })
    else map.setView(projection.geographic ? [51.12433, 71.33639] : [0, 0], projection.geographic ? 13 : 0)
    setReady(true)

    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      map.remove()
      setReady(false)
    }
  }, [network, pipeDiameterMm, pipeDisplayLabel, pipePaths, verifiedProjectGeometryOnly, buildings, corridorRings, constraints, outletFlowLps])

  return (
    <div className="live-situation-map-wrap">
      {!ready && <div className="live-map-loading"><span className="export-progress-spinner" />Загрузка настоящей карты…</div>}
      <div ref={containerRef} className="live-situation-map" aria-label="Интерактивная карта с проектной трассой коллектора" />
      <p className="reference-source-note">
        {constraints?.georeference && constraints.georeference.kind !== 'unreferenced'
          ? 'OSM, спутник и OpenTopoMap — только ориентировочные подложки. '
          : ''}
        Плановая ось строится по структурированным слоям DWG, а инженерные отметки берутся из топосъёмки. Синий цвет — самотёк до ЛНС, оранжевый — отдельная напорная система после ЛНС.
      </p>
      {!constraints?.georeference || constraints.georeference.kind === 'unreferenced' ? (
        <p className="notice error">DWG не геопривязан: показана локальная координатная плоскость без OSM. Задайте proj4 либо контрольные точки, чтобы наложение на реальную карту было достоверным.</p>
      ) : null}
    </div>
  )
}
