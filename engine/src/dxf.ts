import { Colors, DxfWriter, LineTypes, point3d, TextHorizontalAlignment } from '@tarikjabiri/dxf'
import type { ExportInput } from './exportdata'
import { materialLabel, MATERIAL_LABELS } from './exportdata'
import type { NetworkNode } from './trace'

/**
 * DXF drawing of the water supply network, in real local coordinates
 * (meters). Layers follow the spirit of GOST 21.704 for outdoor water
 * supply working documentation (network W1). The file opens in AutoCAD;
 * DWG is a closed format and is deliberately not produced.
 *
 * Contents:
 *  - plan: buildings, ring and cross mains, service connections, wells,
 *    source, fittings and pipe annotations, over a light survey base;
 *  - longitudinal profile of the ring main below the plan.
 */

const LAYERS = {
  survey: 'В1-рельеф',
  network: 'В1-сеть',
  service: 'В1-вводы',
  wells: 'В1-колодцы',
  buildings: 'В1-здания',
  source: 'В1-источник',
  fittings: 'В1-арматура',
  annotation: 'В1-аннотации',
  profile: 'В1-профиль',
  geology: 'В1-геология',
} as const

function p3(x: number, y: number) {
  return point3d(x, y, 0)
}

function ringNodesInOrder(input: ExportInput): NetworkNode[] {
  return input.network.nodes
    .filter((n) => n.kind === 'ring')
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

export function buildNetworkDxf(input: ExportInput): string {
  const dxf = new DxfWriter()
  dxf.addLayer(LAYERS.survey, 8, LineTypes.Continuous)
  dxf.addLayer(LAYERS.network, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.service, Colors.Cyan, LineTypes.Continuous)
  dxf.addLayer(LAYERS.wells, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.buildings, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.source, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.fittings, Colors.Blue, LineTypes.Continuous)
  dxf.addLayer(LAYERS.annotation, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.profile, Colors.Black, LineTypes.Continuous)
  dxf.addLayer(LAYERS.geology, Colors.Green, LineTypes.Continuous)

  const nodeById = new Map(input.network.nodes.map((n) => [n.id, n]))

  // Survey base: light plus markers at survey points.
  if (input.surveyPoints && input.surveyPoints.length > 0) {
    dxf.setCurrentLayerName(LAYERS.survey)
    for (const p of input.surveyPoints) {
      dxf.addLine(p3(p.x - 1.2, p.y), p3(p.x + 1.2, p.y))
      dxf.addLine(p3(p.x, p.y - 1.2), p3(p.x, p.y + 1.2))
    }
  }

  // Buildings.
  dxf.setCurrentLayerName(LAYERS.buildings)
  for (const b of input.buildings) {
    dxf.addRectangle({ x: b.x - 7, y: b.y - 5 }, { x: b.x + 7, y: b.y + 5 })
    if (b.label) {
      dxf.addText(p3(b.x, b.y + 7), 2.2, b.label, {
        horizontalAlignment: TextHorizontalAlignment.Center,
        secondAlignmentPoint: p3(b.x, b.y + 7),
      })
    }
  }

  // Pipes.
  const matShort = MATERIAL_LABELS[input.material.primary] ?? input.material.primary
  for (const pipe of input.sizing.pipes) {
    const a = nodeById.get(pipe.fromNode)
    const b = nodeById.get(pipe.toNode)
    if (!a || !b) continue
    dxf.setCurrentLayerName(pipe.kind === 'service' ? LAYERS.service : LAYERS.network)
    dxf.addLine(p3(a.x, a.y), p3(b.x, b.y))
    if (pipe.kind !== 'service') {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
      const rotation = angle > 90 || angle < -90 ? angle + 180 : angle
      dxf.setCurrentLayerName(LAYERS.annotation)
      dxf.addText(p3(mx, my + 1.5), 1.8, `d${pipe.nominalMm} ${matShort} L${pipe.lengthM.toFixed(1)}`, {
        rotation,
        secondAlignmentPoint: p3(mx, my + 1.5),
      })
    }
  }

  // Wells and fittings.
  const wellByNode = new Map(input.fittings.wells.map((w) => [w.nodeId, w.label]))
  const FITTING_MARK: Record<string, string> = {
    hydrant: 'ПГ',
    valve: 'З',
    airValve: 'В',
    washout: 'ВП',
  }
  for (const item of input.fittings.items) {
    const node = nodeById.get(item.nodeId)
    if (!node) continue
    dxf.setCurrentLayerName(LAYERS.wells)
    dxf.addCircle(p3(node.x, node.y), 1.6)
    const well = wellByNode.get(item.nodeId)
    const marks = item.types.map((t) => FITTING_MARK[t] ?? t).join(' ')
    dxf.setCurrentLayerName(LAYERS.fittings)
    dxf.addText(p3(node.x + 2.5, node.y + 2.5), 1.8, well ? `${well} ${marks}` : marks, {
      secondAlignmentPoint: p3(node.x + 2.5, node.y + 2.5),
    })
  }

  // Source.
  const src = input.network.nodes.find((n) => n.kind === 'source')
  if (src) {
    dxf.setCurrentLayerName(LAYERS.source)
    dxf.addRectangle({ x: src.x - 5, y: src.y - 5 }, { x: src.x + 5, y: src.y + 5 })
    dxf.addText(p3(src.x, src.y + 7), 2.4, 'ВОС', {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(src.x, src.y + 7),
    })
  }

  drawProfile(dxf, input)

  // Title.
  const minX = Math.min(...input.buildings.map((b) => b.x), src?.x ?? 0)
  const maxY = Math.max(...input.buildings.map((b) => b.y)) + 30
  dxf.setCurrentLayerName(LAYERS.annotation)
  dxf.addText(p3(minX, maxY), 4, `AquaScheme. Сеть В1. План и профиль. ${input.projectName}`, {
    secondAlignmentPoint: p3(minX, maxY),
  })
  dxf.addText(p3(minX, maxY - 6), 2.2, `Материал ${materialLabel(input)}. Глубина заложения ${input.material.burialDepthM.toFixed(2)} м`, {
    secondAlignmentPoint: p3(minX, maxY - 6),
  })

  return dxf.stringify()
}

/** Longitudinal profile of the ring main, placed below the plan. */
function drawProfile(dxf: DxfWriter, input: ExportInput): void {
  const ring = ringNodesInOrder(input)
  if (ring.length < 2) return
  const path = [...ring, ring[0]]

  const minY = Math.min(...input.network.nodes.map((n) => n.y))
  const minX = Math.min(...input.network.nodes.map((n) => n.x))
  const originX = minX
  const originY = minY - 140
  const vScale = 10 // vertical exaggeration for readability

  const elevations = path.map((n) => n.groundElevation)
  const datum = Math.floor(Math.min(...elevations) - 1)
  const burial = input.material.burialDepthM

  const yFor = (elev: number) => originY + (elev - datum) * vScale

  // Chainage.
  const chain: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    chain.push(chain[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  }

  dxf.setCurrentLayerName(LAYERS.profile)
  // Datum line.
  const totalLen = chain[chain.length - 1]
  dxf.addLine(p3(originX, originY), p3(originX + totalLen, originY))
  dxf.addText(p3(originX - 4, originY), 1.8, `${datum.toFixed(1)}`, {
    horizontalAlignment: TextHorizontalAlignment.Right,
    secondAlignmentPoint: p3(originX - 4, originY),
  })

  // Ground line.
  const ground = path.map((n, i) => ({ point: { x: originX + chain[i], y: yFor(n.groundElevation) } }))
  dxf.addLWPolyline(ground)
  // Pipe invert line.
  const invert = path.map((n, i) => ({ point: { x: originX + chain[i], y: yFor(n.groundElevation - burial) } }))
  dxf.addLWPolyline(invert)

  // Node ticks and elevation labels.
  for (let i = 0; i < path.length; i++) {
    const x = originX + chain[i]
    dxf.addLine(p3(x, originY), p3(x, yFor(path[i].groundElevation)))
    dxf.addText(p3(x, yFor(path[i].groundElevation) + 1.5), 1.6, path[i].groundElevation.toFixed(1), {
      rotation: 90,
      secondAlignmentPoint: p3(x, yFor(path[i].groundElevation) + 1.5),
    })
  }

  drawBoreholeColumns(dxf, input, path, chain, originX, yFor)

  dxf.setCurrentLayerName(LAYERS.annotation)
  dxf.addText(p3(originX, yFor(Math.max(...elevations)) + 6), 2.4, 'Продольный профиль магистрали В1', {
    secondAlignmentPoint: p3(originX, yFor(Math.max(...elevations)) + 6),
  })
}

/** Chainage of the point on the route path nearest to (bx, by). */
function chainageOfNearest(path: NetworkNode[], chain: number[], bx: number, by: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x
    const ay = path[i - 1].y
    const dx = path[i].x - ax
    const dy = path[i].y - ay
    const segLen2 = dx * dx + dy * dy
    const t = segLen2 === 0 ? 0 : Math.max(0, Math.min(1, ((bx - ax) * dx + (by - ay) * dy) / segLen2))
    const px = ax + t * dx
    const py = ay + t * dy
    const d = Math.hypot(bx - px, by - py)
    if (d < bestDist) {
      bestDist = d
      best = chain[i - 1] + t * Math.hypot(dx, dy)
    }
  }
  return best
}

/**
 * Geology cross-section on the longitudinal profile (requirements update 3,
 * change 1, G3): each borehole is drawn as a column at its chainage along the
 * route, with layer boundaries and the water table, so the profile carries
 * the geology it was designed against.
 */
function drawBoreholeColumns(
  dxf: DxfWriter,
  input: ExportInput,
  path: NetworkNode[],
  chain: number[],
  originX: number,
  yFor: (elev: number) => number,
): void {
  const boreholes = (input.boreholes ?? []).filter(
    (b) => b.x !== undefined && b.y !== undefined && b.mouthElevationM !== undefined && b.layers.length > 0,
  )
  if (boreholes.length === 0) return

  dxf.setCurrentLayerName(LAYERS.geology)
  for (const b of boreholes) {
    const x = originX + chainageOfNearest(path, chain, b.x as number, b.y as number)
    const mouth = b.mouthElevationM as number
    const deepest = Math.max(...b.layers.map((l) => l.bottomDepthM))
    // Column from mouth down to the deepest layer bottom.
    dxf.addLine(p3(x, yFor(mouth)), p3(x, yFor(mouth - deepest)))
    // Layer boundary ticks.
    for (const layer of b.layers) {
      const yb = yFor(mouth - layer.bottomDepthM)
      dxf.addLine(p3(x - 2, yb), p3(x + 2, yb))
      if (layer.igeCode) {
        dxf.addText(p3(x + 2.5, yFor(mouth - (layer.topDepthM + layer.bottomDepthM) / 2)), 1.4, `ИГЭ-${layer.igeCode}`, {
          secondAlignmentPoint: p3(x + 2.5, yFor(mouth - (layer.topDepthM + layer.bottomDepthM) / 2)),
        })
      }
    }
    // Water table marker.
    if (b.water.depthM !== undefined) {
      const yw = yFor(mouth - b.water.depthM)
      dxf.addLine(p3(x - 3, yw), p3(x + 3, yw))
      dxf.addText(p3(x - 3.5, yw), 1.4, 'УГВ', {
        horizontalAlignment: TextHorizontalAlignment.Right,
        secondAlignmentPoint: p3(x - 3.5, yw),
      })
    }
    // Borehole label above the column.
    dxf.addText(p3(x, yFor(mouth) + 2), 1.6, b.label, {
      horizontalAlignment: TextHorizontalAlignment.Center,
      secondAlignmentPoint: p3(x, yFor(mouth) + 2),
    })
  }
}
