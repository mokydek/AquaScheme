import { describe, expect, it } from 'vitest'
import { assessAxisContinuity } from './axis-continuity'

const chain = (...ids: string[]) =>
  ids.slice(1).map((id, index) => ({ fromNodeId: ids[index], toNodeId: id }))

describe('непрерывность загруженной оси', () => {
  it('одна цепочка объявляется непрерывной', () => {
    const result = assessAxisContinuity(chain('К-1', 'К-2', 'К-3', 'К-4'))
    expect(result).toMatchObject({ segmentCount: 3, chainCount: 1, continuous: true, breakNodeIds: [] })
    expect(result.reason).toContain('непрерывна')
  })

  it('разрыв назван числом цепочек и узлами обрыва', () => {
    // Ровно тот случай, что давал противоречие: участки загружены, а осью не
    // стали. «Загружена трасса: N участков» и «нет непрерывной оси» —
    // одновременно верно, и вместе это неправда.
    const result = assessAxisContinuity([...chain('К-1', 'К-2', 'К-3'), ...chain('К-7', 'К-8')])
    expect(result.continuous).toBe(false)
    expect(result.chainCount).toBe(2)
    // Концы ОСНОВНОЙ цепочки разрывом не считаются: это начало и конец оси.
    expect(result.breakNodeIds).toEqual(['К-7', 'К-8'])
    expect(result.reason).toContain('2 несвязанных цепочек')
    expect(result.reason).toContain('К-7')
  })

  it('порядок участков на вывод не влияет', () => {
    const forward = assessAxisContinuity(chain('К-1', 'К-2', 'К-3'))
    const shuffled = assessAxisContinuity([
      { fromNodeId: 'К-2', toNodeId: 'К-3' },
      { fromNodeId: 'К-1', toNodeId: 'К-2' },
    ])
    expect(shuffled.continuous).toBe(forward.continuous)
    expect(shuffled.chainCount).toBe(forward.chainCount)
  })

  it('кольцо непрерывно и концов не имеет', () => {
    const ring = [...chain('К-1', 'К-2', 'К-3'), { fromNodeId: 'К-3', toNodeId: 'К-1' }]
    const result = assessAxisContinuity(ring)
    expect(result.continuous).toBe(true)
    expect(result.breakNodeIds).toEqual([])
  })

  it('пустой набор объявляется пустым, а не непрерывным', () => {
    const result = assessAxisContinuity([])
    expect(result.continuous).toBe(false)
    expect(result.chainCount).toBe(0)
    expect(result.reason).toContain('Участков нет')
  })

  it('длинная цепочка не превращает поиск в линейный', () => {
    // Сжатие пути в объединении: на трассе из тысячи камер без него разбор
    // упирался бы в квадрат.
    const long = chain(...Array.from({ length: 2000 }, (_, index) => `К-${index}`))
    expect(assessAxisContinuity(long)).toMatchObject({ chainCount: 1, continuous: true })
  })
})
