import { describe, expect, it } from 'vitest'
import { assessSourceHead } from './source-head'
import type { SizingResult } from './sizing'

const node = (id: string, pressureM: number, requiredPressureM?: number) =>
  ({ id, kind: 'junction', elevationM: 100, headM: 100 + pressureM, pressureM, requiredPressureM, ok: true })

const result = (nodes: ReturnType<typeof node>[], sourceHeadM = 145): SizingResult =>
  ({ nodes, pipes: [], iterations: 1, solves: 1, converged: true, issues: [], sourceHeadM, totalDemandLps: 10 } as SizingResult)

describe('требуемый напор на источнике', () => {
  it('при дефиците называет недостающий напор и определяющий узел', () => {
    // Расходы от напора не зависят, поэтому подъём источника на Δ поднимает
    // напор в каждом узле ровно на Δ: недостающее — наибольший дефицит.
    const assessment = assessSourceHead(result([
      node('Ж-1', 30, 26),
      node('Ж-2', 18, 26),
      node('Ж-3', 24, 22),
    ]))
    expect(assessment.deficitM).toBe(8)
    expect(assessment.requiredSourceHeadM).toBe(153)
    expect(assessment.governingNodeId).toBe('Ж-2')
    expect(assessment.reserveM).toBe(-8)
    expect(assessment.reason).toMatch(/Напора не хватает: 8 м/)
  })

  it('при достатке называет наименьший запас, а не средний', () => {
    const assessment = assessSourceHead(result([
      node('Ж-1', 30, 26),
      node('Ж-2', 27.5, 26),
      node('Ж-3', 40, 26),
    ]))
    expect(assessment.deficitM).toBe(0)
    expect(assessment.requiredSourceHeadM).toBe(145)
    expect(assessment.reserveM).toBe(1.5)
    expect(assessment.governingNodeId).toBe('Ж-2')
    expect(assessment.reason).toMatch(/наименьший запас 1.5 м/)
  })

  it('транзитный узел без требования требование не занижает', () => {
    // У транзитного узла требования нет; включив его, мы получили бы «запас»
    // по узлу, которому напор не нужен, и требование вышло бы меньше.
    const assessment = assessSourceHead(result([
      node('Т-1', 2),
      node('Ж-1', 20, 26),
    ]))
    expect(assessment.governingNodeId).toBe('Ж-1')
    expect(assessment.deficitM).toBe(6)
  })

  it('без единого требующего узла требование не выдумывается', () => {
    const assessment = assessSourceHead(result([node('Т-1', 5), node('Т-2', 7)]))
    expect(assessment.requiredSourceHeadM).toBe(145)
    expect(assessment.deficitM).toBe(0)
    expect(assessment.governingNodeId).toBeNull()
    expect(assessment.reason).toMatch(/не определяется/)
  })

  it('нечисловое давление узел из расчёта исключает', () => {
    const broken = assessSourceHead(result([
      { ...node('Ж-1', 20, 26), pressureM: Number.NaN },
      node('Ж-2', 30, 26),
    ]))
    expect(broken.governingNodeId).toBe('Ж-2')
    expect(broken.deficitM).toBe(0)
  })

  it('ровно на границе дефицита нет', () => {
    const exact = assessSourceHead(result([node('Ж-1', 26, 26)]))
    expect(exact.deficitM).toBe(0)
    expect(exact.reserveM).toBe(0)
  })

  it('пустой расчёт не выдаётся за достаточный', () => {
    const empty = assessSourceHead(result([]))
    expect(empty.governingNodeId).toBeNull()
    expect(empty.reason).toMatch(/не определяется/)
  })
})
