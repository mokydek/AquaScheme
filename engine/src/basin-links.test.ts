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
    // Длины в общем списке больше нет: она выводится из геометрии, а её
    // отсутствие — свойство конкретной перемычки, и говорится в её блокере.
    for (const item of ['приток', 'ряд диаметров', 'каталог насосов',
      'категория надёжности', 'характер']) {
      expect(plan.missing.join(' ')).toContain(item)
    }
    expect(plan.links[0].blockers.join(' ')).toContain('границы бассейнов')
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

describe('выводимое у перемычки выводится', () => {
  const lifts = [lift('K-9', 540, 4.2), lift('K-18', 1100, 6.1)]
  const geometry = { basinBoundariesM: [540, 1100], routeEndM: 1600 }

  it('длина выводится из геометрии и совпадает с расстоянием до головы следующего бассейна', () => {
    const plan = planBasinPressureLinks({ lifts, ...geometry, designFlowLps: 35 })
    expect(plan.links[0].lengthM).toBeCloseTo(560, 6)
    expect(plan.links[0].lengthOrigin).toBe('derived')
    // Последняя перемычка идёт до конца трассы.
    expect(plan.links[1].lengthM).toBeCloseTo(500, 6)
  })

  it('заданная вручную длина переопределяет выведенную', () => {
    const plan = planBasinPressureLinks({ lifts, ...geometry, designFlowLps: 35, pressureLengthM: 120 })
    expect(plan.links[0].lengthM).toBe(120)
    expect(plan.links[0].lengthOrigin).toBe('stated')
  })

  it('без границ бассейнов длина не выводится и это названо', () => {
    const plan = planBasinPressureLinks({ lifts, designFlowLps: 35 })
    expect(plan.links[0].lengthM).toBeNull()
    expect(plan.links[0].lengthOrigin).toBe('unknown')
    expect(plan.links[0].blockers.join(' ')).toContain('границы бассейнов')
  })

  it('диаметр предлагается из ряда каталога по допустимой скорости', () => {
    const plan = planBasinPressureLinks({
      lifts, ...geometry, designFlowLps: 35,
      availableDiametersMm: [100, 160, 200, 315, 400],
    })
    expect(plan.links[0].suggestedDiameterMm).toBeGreaterThan(0)
    // Обоснование называет скорость и предел, а не просто число.
    expect(plan.links[0].diameterReason).toContain('м/с')
  })

  it('предложенный диаметр действительно используется в расчёте напора', () => {
    const plan = planBasinPressureLinks({
      lifts: [lift('K-9', 540, 4.2)], ...geometry, designFlowLps: 35,
      availableDiametersMm: [200, 315],
      catalogue, category: 'first', effluent: 'domestic',
    })
    expect(plan.links[0].requiredHeadM).toBeGreaterThan(4.2)
    expect(plan.missing).toEqual([])
  })

  it('без ряда диаметров предложения нет и стоп честный', () => {
    const plan = planBasinPressureLinks({ lifts, ...geometry, designFlowLps: 35 })
    expect(plan.links[0].suggestedDiameterMm).toBeNull()
    expect(plan.missing.join(' ')).toContain('ряд диаметров')
  })
})
