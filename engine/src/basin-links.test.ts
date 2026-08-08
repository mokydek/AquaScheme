import { describe, expect, it } from 'vitest'
import { planBasinPressureLinks } from './basin-links'
import type { GravityLift } from './norms/gravity'

const lift = (nodeId: string, chainageM: number, liftHeightM: number): GravityLift => ({
  nodeId, chainageM, incomingDepthM: 6, liftHeightM,
})

const catalogue = [
  { designation: 'НС-1', flowLps: 40, headM: 12, powerKw: 7.5 },
  { designation: 'НС-2', flowLps: 40, headM: 25, powerKw: 15 },
]

describe('напорные перемычки между бассейнами', () => {
  it('без перекачек перемычек не требуется', () => {
    const plan = planBasinPressureLinks({ lifts: [] })
    expect(plan.links).toEqual([])
    expect(plan.reason).toContain('не требуется')
  })

  it('без входных данных расчёт останавливается и называет недостающее поимённо', () => {
    const plan = planBasinPressureLinks({ lifts: [lift('K-9', 540, 4.2)] })
    expect(plan.links[0].requiredHeadM).toBeNull()
    expect(plan.links[0].pumps).toBeNull()
    for (const item of ['приток', 'длина напорного участка', 'диаметр', 'каталог насосов',
      'категория надёжности', 'характер']) {
      expect(plan.missing.join(' ')).toContain(item)
    }
  })

  it('геометрический подъём известен даже без остальных данных: он из разбивки', () => {
    const plan = planBasinPressureLinks({ lifts: [lift('K-9', 540, 4.2)] })
    // Не догадка и не умолчание — величина посчитана по отметкам профиля.
    expect(plan.links[0].geometricLiftM).toBe(4.2)
  })

  it('при полных данных считается напор и подбирается агрегат с резервом', () => {
    const plan = planBasinPressureLinks({
      lifts: [lift('K-9', 540, 4.2)],
      designFlowLps: 35,
      pressureLengthM: 220,
      pressureDiameterMm: 200,
      catalogue,
      category: 'first',
      effluent: 'domestic',
    })
    const link = plan.links[0]
    expect(link.headlossM).toBeGreaterThan(0)
    // Требуемый напор — подъём плюс потери, и он строго больше подъёма.
    expect(link.requiredHeadM).toBeCloseTo(4.2 + link.headlossM!, 6)
    expect(link.requiredHeadM).toBeGreaterThan(link.geometricLiftM)
    expect(link.pumps?.pump?.designation).toBeTruthy()
    expect(link.pumps!.standbyCount).toBeGreaterThan(0)
    expect(plan.missing).toEqual([])
  })

  it('без каталога напор считается, а агрегат — нет', () => {
    const plan = planBasinPressureLinks({
      lifts: [lift('K-9', 540, 4.2)],
      designFlowLps: 35,
      pressureLengthM: 220,
      pressureDiameterMm: 200,
      category: 'first',
      effluent: 'domestic',
    })
    expect(plan.links[0].requiredHeadM).toBeGreaterThan(0)
    expect(plan.links[0].pumps).toBeNull()
    expect(plan.links[0].blockers.join(' ')).toContain('каталог насосов')
  })

  it('каждая перекачка получает свою перемычку', () => {
    const plan = planBasinPressureLinks({
      lifts: [lift('K-9', 540, 4.2), lift('K-18', 1100, 6.1)],
      designFlowLps: 35,
      pressureLengthM: 220,
      pressureDiameterMm: 200,
      catalogue,
      category: 'first',
      effluent: 'domestic',
    })
    expect(plan.links.map((link) => link.liftNodeId)).toEqual(['K-9', 'K-18'])
    // Более высокий подъём требует большего напора: величина следует из данных.
    expect(plan.links[1].requiredHeadM!).toBeGreaterThan(plan.links[0].requiredHeadM!)
  })
})
