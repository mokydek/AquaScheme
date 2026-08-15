import { describe, expect, it } from 'vitest'
import type { RouteConstraintInput } from '@aquascheme/engine'
import {
  PLAN_ROLE_BY_LAYER_ROLE,
  RING_DRAWN_LAYER_ROLES,
  UNTHINNED_ROLE_LINES,
  allocatePlanLineBudget,
  layerRoleOrUnknown,
  planSourceLines,
} from './planLayerRole'
import { PLAN_LINE_STYLE } from './planStyles'
import type { PlanLineRole } from './planStyles'

const line = (role: string, points = [{ x: 0, y: 0 }, { x: 10, y: 10 }], extra: object = {}) =>
  ({ role, points, ...extra }) as RouteConstraintInput['cadContextLines'] extends (infer T)[] ? T : never

describe('соответствие роли слоя и роли линии', () => {
  it('назначает стиль каждой роли слоя, и стиль этот есть в измеренной таблице', () => {
    for (const [layerRole, planRole] of Object.entries(PLAN_ROLE_BY_LAYER_ROLE)) {
      if (planRole === null) {
        expect(layerRole).toBe('ignore')
        continue
      }
      expect(PLAN_LINE_STYLE[planRole], `роль ${layerRole} → ${planRole}`).toBeTruthy()
    }
  })

  it('рельеф чертежа идёт подосновой, а не горизонталью', () => {
    // Горизонталь строится по отметкам съёмки и несёт отметку. Линия слоя
    // рельефа отметки не несёт, и выдавать её за горизонталь нельзя.
    expect(PLAN_ROLE_BY_LAYER_ROLE.terrain).toBe('topobase')
    expect(PLAN_ROLE_BY_LAYER_ROLE.terrainBreakline).toBe('topobase')
    // Ни один слой чертежа не становится горизонталью: роли горизонталей
    // принадлежат линиям, ПОСТРОЕННЫМ по отметкам съёмки.
    const assigned = Object.values(PLAN_ROLE_BY_LAYER_ROLE)
    expect(assigned).not.toContain('contour')
    expect(assigned).not.toContain('contourIndex')
  })

  it('железная дорога выводится стилем автомобильной — знака пути в нормах комплекта нет', () => {
    expect(PLAN_ROLE_BY_LAYER_ROLE.railway).toBe(PLAN_ROLE_BY_LAYER_ROLE.road)
  })

  it('неизвестное значение роли читается как «не разобрано», а не как похожая роль', () => {
    expect(layerRoleOrUnknown('utility')).toBe('utility')
    expect(layerRoleOrUnknown('utilities')).toBe('unknown')
    expect(layerRoleOrUnknown(undefined)).toBe('unknown')
    expect(layerRoleOrUnknown(17)).toBe('unknown')
  })
})

describe('линейная графика листа', () => {
  it('линия существующей сети попадает в список ровно один раз и в своей роли', () => {
    const source = planSourceLines({
      corridorRings: [],
      cadContextLines: [line('utility', [{ x: 0, y: 0 }, { x: 40, y: 0 }], { layer: 'K1' })],
      // Тот же участок лежит и в именованном наборе — он и раньше приходил
      // оттуда вторым проходом. Из полного контура он берётся ОДИН раз.
      utilityLines: [{ layer: 'K1', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }],
    } as RouteConstraintInput)
    expect(source.origin).toBe('drawing')
    expect(source.lines).toHaveLength(1)
    expect(source.lines[0].role).toBe('existingUtility')
  })

  it('контур, ставший кольцом, линией не повторяется; остальные выводятся', () => {
    const source = planSourceLines({
      corridorRings: [],
      cadContextLines: [
        line('building', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }],
          { closed: true, drawnAsRing: true }),
        line('building', [{ x: 20, y: 0 }, { x: 25, y: 0 }]),
        // Замкнутый, но кольцом НЕ ставший: разбор отсеял его как условный знак.
        // Прежняя догадка «замкнут + роль со кольцами ⇒ кольцо» стёрла бы его.
        line('corridor', [{ x: 40, y: 0 }, { x: 42, y: 0 }, { x: 41, y: 2 }, { x: 40, y: 0 }],
          { closed: true }),
      ],
    } as RouteConstraintInput)
    expect(source.ringLines).toBe(1)
    expect(source.lines.map((item) => item.role)).toEqual(['existingBuilding', 'corridor'])
  })

  it('слой «не выводить» не рисуется и посчитан, неразобранный — рисуется и посчитан', () => {
    const source = planSourceLines({
      corridorRings: [],
      cadContextLines: [line('ignore'), line('unknown'), line('unknown')],
    } as RouteConstraintInput)
    expect(source.ignoredLines).toBe(1)
    expect(source.unknownRoleLines).toBe(2)
    expect(source.lines.map((item) => item.role)).toEqual(['topobase', 'topobase'])
  })

  it('без полного контура собирает лист из именованных наборов и называет эту ветку', () => {
    const source = planSourceLines({
      corridorRings: [],
      utilityLines: [{ layer: 'K1', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }],
      redLines: [{ points: [{ x: 0, y: 9 }, { x: 4, y: 9 }] }],
    } as RouteConstraintInput)
    expect(source.origin).toBe('named-sets')
    expect(source.lines.map((item) => item.role)).toEqual(['existingUtility', 'redLine'])
  })

  it('пустой набор объявляется пустым, а не заполняется молча', () => {
    expect(planSourceLines(null).origin).toBe('none')
    expect(planSourceLines(null).lines).toHaveLength(0)
  })
})

describe('раздача предела линий по ролям', () => {
  const counts = (entries: Array<[PlanLineRole, number]>) => new Map(entries)

  it('не прореживает, когда всё помещается', () => {
    const quota = allocatePlanLineBudget(counts([['topobase', 500], ['redLine', 53]]), 6000)
    expect(quota.get('topobase')).toBe(500)
    expect(quota.get('redLine')).toBe(53)
  })

  it('редкие роли проходят целиком, массовые делят остаток', () => {
    // Съёмка Станкевича: 13 000 линий подосновы и рядом с ними 53 красные,
    // 26 гидрографии, 2 дороги. Прежнее общее прореживание срезало каждую
    // роль одинаково, и от красных линий оставалась треть.
    const quota = allocatePlanLineBudget(counts([
      ['topobase', 13_000], ['existingUtility', 900], ['redLine', 53], ['water', 26], ['road', 2],
    ]), 6000)
    expect(quota.get('redLine')).toBe(53)
    expect(quota.get('water')).toBe(26)
    expect(quota.get('road')).toBe(2)
    expect(quota.get('topobase')! + quota.get('existingUtility')!).toBe(6000 - 53 - 26 - 2)
    // Массовые режутся пропорционально: 900 из 13 900 — это около 6,5 %.
    expect(quota.get('existingUtility')).toBeGreaterThan(370)
    expect(quota.get('existingUtility')).toBeLessThan(390)
  })

  it('сумма выведенного не превышает потолок ни в одном случае', () => {
    for (const total of [1, 10, 100, 2500, 6000]) {
      const quota = allocatePlanLineBudget(counts([
        ['topobase', 13_000], ['existingUtility', 900], ['redLine', 53], ['water', 26],
      ]), total)
      expect([...quota.values()].reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(total)
    }
  })

  it('роль на самом пороге редкости прореживанию не подлежит', () => {
    const quota = allocatePlanLineBudget(
      counts([['topobase', 13_000], ['redLine', UNTHINNED_ROLE_LINES - 1]]),
      1000,
    )
    expect(quota.get('redLine')).toBe(UNTHINNED_ROLE_LINES - 1)
  })

  it('кольца объявлены для всех ролей, у которых разбор чертежа их строит', () => {
    for (const role of ['building', 'structure', 'protectionZone', 'forbiddenZone',
      'approvedCrossing', 'parcel', 'corridor', 'hydrography'] as const) {
      expect(RING_DRAWN_LAYER_ROLES.has(role), role).toBe(true)
    }
    expect(RING_DRAWN_LAYER_ROLES.has('utility')).toBe(false)
    expect(RING_DRAWN_LAYER_ROLES.has('redLine')).toBe(false)
  })
})
