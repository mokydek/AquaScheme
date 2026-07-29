import type { RouteConstraintInput } from '@aquascheme/engine'
import type { DxfConstraintData } from '@aquascheme/engine/dxfread'

type XY = { x: number; y: number }

/** Preserve actual DXF vector context in project-local coordinates. */
export function buildDxfCadContext(
  constraints: DxfConstraintData,
  transform: (point: XY) => XY,
): Pick<RouteConstraintInput, 'terrainLines' | 'cadContextLines' | 'cadTextEntities' | 'cadBlockEntities'> {
  const mapLine = (line: DxfConstraintData['contextLines'][number]) => ({
    layer: line.layer,
    sourceType: line.sourceType,
    sourceHandle: line.sourceHandle,
    colorNumber: line.colorNumber,
    lineType: line.lineType,
    points: line.points.map(transform),
  })
  return {
    terrainLines: constraints.terrainLines.map(mapLine),
    cadContextLines: constraints.contextLines.map(mapLine),
    cadTextEntities: constraints.textEntities.map((entity) => ({ ...entity, ...transform(entity) })),
    cadBlockEntities: constraints.blockEntities.map((entity) => ({ ...entity, ...transform(entity) })),
  }
}
