import type { RouteConstraintInput } from '@aquascheme/engine'
import { simplifyDrawingUnderlay } from '@aquascheme/engine/dxfread'
import type { DxfConstraintData } from '@aquascheme/engine/dxfread'

type XY = { x: number; y: number }

/**
 * Preserve actual DXF vector context in project-local coordinates.
 *
 * Прореживается уже после переноса в координаты проекта: допуск задан в метрах
 * на местности, и применять его к исходной системе чертежа было бы неверно.
 */
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
    terrainLines: simplifyDrawingUnderlay(constraints.terrainLines.map(mapLine)),
    cadContextLines: simplifyDrawingUnderlay(constraints.contextLines.map(mapLine)),
    cadTextEntities: constraints.textEntities.map((entity) => ({ ...entity, ...transform(entity) })),
    cadBlockEntities: constraints.blockEntities.map((entity) => ({ ...entity, ...transform(entity) })),
  }
}
