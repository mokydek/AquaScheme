import type { RouteConstraintInput, RouteContextSegment } from '@aquascheme/engine'
import { simplifyDrawingUnderlay } from '@aquascheme/engine/dxfread'
import type { DxfConstraintData } from '@aquascheme/engine/dxfread'
import { layerRoleOrUnknown } from './planLayerRole'

type XY = { x: number; y: number }

/**
 * Preserve actual DXF vector context in project-local coordinates.
 *
 * Прореживается уже после переноса в координаты проекта: допуск задан в метрах
 * на местности, и применять его к исходной системе чертежа было бы неверно.
 *
 * РОЛЬ СЛОЯ ЕДЕТ ВМЕСТЕ С ЛИНИЕЙ. Раньше она оставалась в словаре
 * `constraints.roles` — «имя слоя → роль», — и до пера не доходила: отрисовщик
 * получал линии без ролей и выводил ВЕСЬ чертёж одним стилем подосновы, поверх
 * которого те же линии рисовались второй раз из именованных наборов. Роль,
 * записанная в линию здесь, — единственный способ нарисовать линию один раз и
 * в своём стиле.
 */
export function buildDxfCadContext(
  constraints: DxfConstraintData,
  transform: (point: XY) => XY,
): Pick<RouteConstraintInput, 'terrainLines' | 'cadContextLines' | 'cadTextEntities' | 'cadBlockEntities'> {
  const mapLine = (line: DxfConstraintData['contextLines'][number]): RouteContextSegment => ({
    layer: line.layer,
    // Роль берётся по имени слоя ЗДЕСЬ, один раз, пока имя ещё рядом с линией.
    // Слоя нет в словаре — слой не разобран: 'unknown', а не «как-нибудь».
    role: constraints.roles[line.layer ?? '0'] ?? 'unknown',
    // Кольцом ли вышла эта линия — решил разбор чертежа, и решение едет сюда
    // вместе с линией. Восстанавливать его по `closed` и роли нельзя: замкнутый
    // контур из трёх точек и мелкий замкнутый значок на слое коридора кольцами
    // НЕ становятся, и такая догадка стёрла бы их с листа.
    drawnAsRing: line.drawnAsRing,
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

/**
 * Набор `route_constraints`, прочитанный из хранилища.
 *
 * Наборы, сохранённые до того, как роль поехала вместе с линией, роли не несут.
 * Миграции данных нет и не заводится: набор — это выгрузка чертежа, а не
 * состояние, которое чинят задним числом. Вместо миграции роль проставляется НА
 * ГРАНИЦЕ ЧТЕНИЯ, один раз и явно: линия без роли получает `'unknown'` — «слой
 * не разобран». Это честно: старый набор действительно не знает, чем была его
 * линия, и притворяться, что знает, нельзя.
 *
 * Граница одна: содержимое набора попадает в отрисовку только отсюда. Второго
 * места, где та же подстановка делалась бы `?? 'unknown'` по месту, нет — такая
 * подстановка внутри отрисовщика и была бы тем самым молчаливым умолчанием,
 * которого проект не допускает.
 */
export function readRouteConstraints<T extends Partial<RouteConstraintInput>>(content: T | null): T | null {
  if (content === null) return null
  const withRoles = (lines: RouteContextSegment[] | undefined): RouteContextSegment[] | undefined => {
    if (lines === undefined) return undefined
    if (lines.every((line) => line.role === layerRoleOrUnknown(line.role))) return lines
    return lines.map((line) => {
      const role = layerRoleOrUnknown(line.role)
      return line.role === role ? line : { ...line, role }
    })
  }
  const cadContextLines = withRoles(content.cadContextLines)
  const terrainLines = withRoles(content.terrainLines)
  if (cadContextLines === content.cadContextLines && terrainLines === content.terrainLines) return content
  return { ...content, cadContextLines, terrainLines }
}
