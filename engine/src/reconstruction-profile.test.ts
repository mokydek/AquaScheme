import { describe, expect, it } from 'vitest'
import { layReconstructionProfile } from './reconstruction-profile'
import type { ProfileStation } from './norms/gravity'

const station = (nodeId: string, chainageM: number, groundElevationM: number): ProfileStation => ({
  nodeId,
  chainageM,
  groundElevationM,
  // Приходят из обычного профиля и здесь пересчитываются.
  invertElevationM: groundElevationM - 1.5,
  depthM: 1.5,
  diameterMm: 450,
})

/** Наименьший уклон для Ø450 по самоочищающей скорости — около 1,3 ‰. */
const minSlopeFor = () => 0.0013
const minDepthFor = () => 2.16

describe('профиль реконструкции закладывается от измеренных отметок', () => {
  it('в точке стыковки лоток равен измеренному', () => {
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 688.22), station('ВК-2', 100, 688.07), station('ВК-3', 200, 687.34)],
      existingInvertByNodeId: new Map([['ВК-1', 684.78], ['ВК-3', 684.37]]),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.tied).toBe(true)
    expect(laid.tieNodeIds).toEqual(['ВК-1', 'ВК-3'])
    expect(laid.stations[0].invertElevationM).toBeCloseTo(684.78, 2)
    expect(laid.stations[2].invertElevationM).toBeCloseTo(684.37, 2)
    // Глубина считается от той же земли: 688,22 − 684,78 = 3,44 м.
    expect(laid.stations[0].depthM).toBeCloseTo(3.44, 2)
  })

  it('узел без измеренной отметки связью не становится, а выводится между связями', () => {
    // Промежуточный узел лежит на прямой между закреплёнными концами: обе
    // отметки заданы, и другой линии между ними быть не может.
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 690), station('ВК-2', 50, 689), station('ВК-3', 100, 688)],
      existingInvertByNodeId: new Map([['ВК-1', 686], ['ВК-3', 684]]),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.tieNodeIds).not.toContain('ВК-2')
    expect(laid.stations[1].invertElevationM).toBeCloseTo(685, 2)
  })

  it('недостижимый нормативный уклон между связями — конфликт с числами, а не тихое нарушение', () => {
    // Связи закреплены жёстко, падение 0,02 м на 100 м даёт 0,20 ‰ против
    // потребных 1,30 ‰. Программа не вправе ни подвинуть измеренную отметку,
    // ни выдать непроходной уклон молча.
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 690), station('ВК-2', 100, 689.8)],
      existingInvertByNodeId: new Map([['ВК-1', 686.0], ['ВК-2', 685.98]]),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.conflicts).toHaveLength(1)
    const conflict = laid.conflicts[0]
    expect(conflict.kind).toBe('belowMin')
    expect(conflict.fromNodeId).toBe('ВК-1')
    expect(conflict.toNodeId).toBe('ВК-2')
    expect(conflict.actualSlope).toBeCloseTo(0.0002, 5)
    // В сообщении есть оба числа и варианты решения — но не выбор.
    expect(conflict.message).toContain('0.20 ‰')
    expect(conflict.message).toContain('1.30 ‰')
    expect(conflict.message).toContain('перепадный колодец')
    // Отметки при этом не подвинуты: измеренное остаётся измеренным.
    expect(laid.stations[0].invertElevationM).toBeCloseTo(686.0, 2)
    expect(laid.stations[1].invertElevationM).toBeCloseTo(685.98, 2)
  })

  it('обратный уклон между связями называется отдельно', () => {
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 690), station('ВК-2', 100, 691)],
      existingInvertByNodeId: new Map([['ВК-1', 685], ['ВК-2', 686]]),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.conflicts[0].kind).toBe('counter')
    expect(laid.conflicts[0].message).toContain('против течения')
  })

  it('промерзание проверяется ПОСЛЕ стыковки и не двигает лоток', () => {
    // Труба ложится мельче нормы: это предупреждение с узлами, а не повод
    // перезаложить профиль — стыковаться всё равно надо с колодцем.
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 690), station('ВК-2', 100, 689)],
      existingInvertByNodeId: new Map([['ВК-1', 689.0], ['ВК-2', 687.9]]),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.shallow.map((item) => item.nodeId)).toContain('ВК-1')
    expect(laid.shallow[0].requiredDepthM).toBeCloseTo(2.16, 2)
    // Лоток остался измеренным.
    expect(laid.stations[0].invertElevationM).toBeCloseTo(689.0, 2)
    expect(laid.reason).toContain('Мельче нормы промерзания')
  })

  it('меньше двух измеренных отметок — стыковка не выполняется и объявляется', () => {
    // Одной связью уклон между концами не определить. Придумывать вторую
    // нельзя, и «профиль заложен» тут было бы неправдой.
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 690), station('ВК-2', 100, 689)],
      existingInvertByNodeId: new Map([['ВК-1', 686]]),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.tied).toBe(false)
    expect(laid.reason).toContain('минимум две')
    expect(laid.reason).toContain('Существующая сеть и АТО')
    // Станции возвращены как были: подмены нет.
    expect(laid.stations[0].invertElevationM).toBeCloseTo(688.5, 2)
  })

  it('без измеренных отметок вовсе профиль не трогается', () => {
    const laid = layReconstructionProfile({
      stations: [station('ВК-1', 0, 690), station('ВК-2', 100, 689)],
      existingInvertByNodeId: new Map(),
      minSlopeFor, maxSlope: 0.1, minDepthFor,
    })
    expect(laid.tied).toBe(false)
    expect(laid.tieNodeIds).toEqual([])
  })
})
