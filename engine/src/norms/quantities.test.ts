import { describe, expect, it } from 'vitest'
import { buildQuantityBill } from './quantities'
import type { QuantityBillInput } from './quantities'
import type { GravityProfile, SewerSchedule } from './gravity'
import type { SelectedManholeConstruction } from '../manhole-catalog'

/** Ровный участок 100 м, глубина 2 м в обоих концах, DN500. */
const profile: GravityProfile = {
  stations: [
    { nodeId: 'К-1', chainageM: 0, groundElevationM: 100, invertElevationM: 98, depthM: 2, diameterMm: 500 },
    { nodeId: 'К-2', chainageM: 100, groundElevationM: 100, invertElevationM: 98, depthM: 2, diameterMm: 500 },
  ],
  maxDepthM: 2,
  outletInvertElevationM: 98,
  totalLengthM: 100,
  pipeIds: ['У-1'],
} as GravityProfile

const schedule: SewerSchedule = {
  manholes: [
    { label: 'К-1', picket: 'ПК0', depthMm: 2000, pipeDiameterMm: 500 },
    { label: 'К-2', picket: 'ПК1', depthMm: 2000, pipeDiameterMm: 500 },
  ],
  pipes: [
    { designation: 'Труба 500', diameterMm: 500, lengthM: 100, agskCode: 'X' },
    { designation: 'Труба 300', diameterMm: 300, lengthM: 40, agskCode: 'X' },
  ],
  totalPipeLengthM: 140,
}

const constructions: SelectedManholeConstruction[] = [
  { manholeLabel: 'К-1', typeCode: 'КК-1', chamberDiameterMm: 1500, source: 'каталог', components: [] },
  { manholeLabel: 'К-2', typeCode: 'КК-1', chamberDiameterMm: 1500, source: 'каталог', components: [] },
]

const base: QuantityBillInput = { profile, schedule, constructions }
const row = (bill: ReturnType<typeof buildQuantityBill>, name: string) =>
  bill.rows.find((item) => item.name.includes(name))
const gap = (bill: ReturnType<typeof buildQuantityBill>, name: string) =>
  bill.gaps.find((item) => item.name.includes(name))

describe('ведомость объёмов работ', () => {
  it('трубы разносятся по диаметрам от меньшего к большему', () => {
    const bill = buildQuantityBill(base)
    const pipes = bill.rows.filter((item) => item.name.startsWith('Укладка трубопровода'))
    expect(pipes.map((item) => item.quantity)).toEqual([40, 100])
    expect(pipes[0].name).toContain('Ø300')
    expect(pipes[1].unit).toBe('м')
  })

  it('колодцы группируются по типу подобранной конструкции', () => {
    const bill = buildQuantityBill(base)
    expect(row(bill, 'типа КК-1')?.quantity).toBe(2)
    expect(row(bill, 'типа КК-1')?.derivedFrom).toMatch(/конструкции/)
  })

  it('без каталога тип колодца называется недостающим, а не выдумывается', () => {
    const bill = buildQuantityBill({ ...base, constructions: [] })
    expect(row(bill, 'тип не определён')?.quantity).toBe(2)
    expect(gap(bill, 'по типам')?.missing).toMatch(/каталог/)
  })

  it('колодцы без подобранной конструкции попадают в пробелы', () => {
    const bill = buildQuantityBill({ ...base, constructions: [constructions[0]] })
    expect(gap(bill, 'без подобранной конструкции')?.missing).toMatch(/1 колодц/)
  })

  it('перепадный колодец — позиция сметы, слив в обычном колодце — нет', () => {
    // Слив конструкции не добавляет: колодец уже посчитан в своей строке.
    const bill = buildQuantityBill({
      ...base,
      dropWells: [
        { nodeId: 'К-1', chainageM: 35, dropM: 2.12, diameterMm: 500,
          kind: { value: 'перепадный колодец', refs: ['sewer.drop.wells'], basis: 'normative' } },
        { nodeId: 'К-2', chainageM: 147, dropM: 0.48, diameterMm: 500,
          kind: { value: 'слив в смотровом колодце', refs: ['sewer.drop.wells'], basis: 'normative' } },
      ],
    })
    expect(row(bill, 'перепадного колодца')?.quantity).toBe(1)
    expect(row(bill, 'перепадного колодца')?.derivedFrom).toMatch(/пикеты 35 м/)
    expect(row(bill, 'высота перепадов')?.quantity).toBe(2.12)
  })

  it('без перепадов строк о них не появляется', () => {
    const bill = buildQuantityBill(base)
    expect(row(bill, 'перепадного колодца')).toBeUndefined()
    expect(row(bill, 'высота перепадов')).toBeUndefined()
  })

  it('земляные работы не считаются, пока их величины не заданы', () => {
    // Норматива на ширину траншеи в реестре нет. Подставленное «обычное»
    // значение дало бы объём, неотличимый от расчётного, прямо в смете.
    const bill = buildQuantityBill(base)
    expect(row(bill, 'Разработка грунта')).toBeUndefined()
    expect(gap(bill, 'Разработка грунта')?.missing).toMatch(/зазор от трубы.*заложение откоса/)
    expect(gap(bill, 'Разработка грунта')?.missing).toMatch(/норматива.*нет/)
    expect(gap(bill, 'Обратная засыпка')).toBeDefined()
  })

  it('при вертикальных стенках объём равен ширина × глубина × длина', () => {
    // Ширина дна = 0,5 + 2×0,3 = 1,1 м; 1,1 × 2 × 100 = 220 м³.
    const bill = buildQuantityBill({ ...base, trenchAllowanceM: 0.3, sideSlopeRatio: 0 })
    expect(row(bill, 'Разработка грунта')?.quantity).toBe(220)
    expect(gap(bill, 'Разработка грунта')).toBeUndefined()
  })

  it('откос увеличивает объём ровно на площадь треугольников', () => {
    // (1,1 + 1×2) × 2 × 100 = 620 м³.
    const bill = buildQuantityBill({ ...base, trenchAllowanceM: 0.3, sideSlopeRatio: 1 })
    expect(row(bill, 'Разработка грунта')?.quantity).toBe(620)
  })

  it('обратная засыпка меньше разработки на объём трубы', () => {
    const bill = buildQuantityBill({ ...base, trenchAllowanceM: 0.3, sideSlopeRatio: 0 })
    const pipeVolume = (Math.PI * 0.5 ** 2 / 4) * 100
    expect(row(bill, 'Обратная засыпка')?.quantity).toBeCloseTo(220 - pipeVolume, 1)
    // Котлованы колодцев не вычитаются, и это сказано прямо.
    expect(row(bill, 'Обратная засыпка')?.derivedFrom).toMatch(/колодцев не вычтены/)
  })

  it('переменная глубина берётся средней площадью сечения', () => {
    // Глубины 2 и 4 м, вертикальные стенки: (1,1×2 + 1,1×4)/2 × 100 = 330 м³.
    const deep: GravityProfile = {
      ...profile,
      stations: [profile.stations[0], { ...profile.stations[1], depthM: 4 }],
    }
    const bill = buildQuantityBill({ ...base, profile: deep, trenchAllowanceM: 0.3, sideSlopeRatio: 0 })
    expect(row(bill, 'Разработка грунта')?.quantity).toBe(330)
  })

  it('песчаное основание требует толщины и не принимает её по умолчанию', () => {
    const without = buildQuantityBill({ ...base, trenchAllowanceM: 0.3, sideSlopeRatio: 0 })
    expect(gap(without, 'песчаного основания')?.missing).toMatch(/толщина/)

    const with_ = buildQuantityBill({ ...base, trenchAllowanceM: 0.3, sideSlopeRatio: 0, beddingThicknessM: 0.1 })
    expect(row(with_, 'песчаного основания')?.quantity).toBe(11) // 1,1 × 0,1 × 100
  })

  it('каждая посчитанная строка называет, из чего получена', () => {
    const bill = buildQuantityBill({ ...base, trenchAllowanceM: 0.3, sideSlopeRatio: 0, beddingThicknessM: 0.1 })
    for (const item of bill.rows) {
      expect(item.derivedFrom.trim().length).toBeGreaterThan(0)
      expect(Number.isFinite(item.quantity)).toBe(true)
      expect(item.quantity).toBeGreaterThan(0)
    }
    expect(bill.totalLengthM).toBe(100)
  })

  it('пустой проект даёт пустую ведомость, а не нули', () => {
    const empty = buildQuantityBill({
      profile: { stations: [], maxDepthM: 0, outletInvertElevationM: 0, totalLengthM: 0, pipeIds: [] } as GravityProfile,
      schedule: { manholes: [], pipes: [], totalPipeLengthM: 0 },
    })
    expect(empty.rows).toEqual([])
    expect(empty.gaps.some((item) => item.name.includes('Разработка грунта'))).toBe(true)
  })
})
