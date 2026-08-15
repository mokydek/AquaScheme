import { describe, expect, it } from 'vitest'
import { assessExistingInvertTie } from './existing-invert-tie'

const station = (nodeId: string, invertElevationM: number) => ({ nodeId, invertElevationM })

describe('стыковка проектного лотка с существующими колодцами', () => {
  it('проектный лоток выше существующего — стыковки нет, узлы названы', () => {
    // Настоящий случай ул. Станкевича: решатель выводит профиль от глубины
    // промерзания и выходит на 1,95 м, а измеренные лотки лежат на 3,44…4,50 м.
    // Труба не может прийти выше колодца: стыковаться будет не с чем.
    const tie = assessExistingInvertTie({
      stations: [station('ВК-1', 686.5), station('ВК-2', 686.1), station('ВК-3', 685.9)],
      existingInvertByNodeId: new Map([['ВК-1', 684.78], ['ВК-2', 683.6], ['ВК-3', 684.37]]),
    })
    expect(tie.tied).toBe(false)
    expect(tie.comparedNodes).toBe(3)
    expect(tie.aboveExistingNodeIds).toContain('ВК-2')
    expect(tie.worstRiseM).toBeCloseTo(2.5, 2)
    // Стоп-фактор называет и раздел, и действие.
    expect(tie.reason).toContain('Самотёчный расчёт')
    expect(tie.reason).toContain('перезаложить')
  })

  it('лоток ниже существующего стыкуется: труба приходит в колодец сверху', () => {
    const tie = assessExistingInvertTie({
      stations: [station('ВК-1', 684.0), station('ВК-2', 683.0)],
      existingInvertByNodeId: new Map([['ВК-1', 684.78], ['ВК-2', 683.6]]),
    })
    expect(tie.tied).toBe(true)
    expect(tie.aboveExistingNodeIds).toEqual([])
    expect(tie.reason).toContain('стыкуется')
  })

  it('расхождение в пределах точности отметки стыковке не мешает', () => {
    // Полсантиметра — точность съёмочной отметки, а не другая отметка лотка.
    const tie = assessExistingInvertTie({
      stations: [station('ВК-1', 684.81)],
      existingInvertByNodeId: new Map([['ВК-1', 684.78]]),
    })
    expect(tie.tied).toBe(true)
  })

  it('без измеренных лотков вывод не делается, а объявляется непроверенным', () => {
    // Отсутствие проверки не выдаётся за успешную проверку: это ровно тот
    // класс ошибок, ради которого заведён аудит подстановок.
    const tie = assessExistingInvertTie({
      stations: [station('ВК-1', 686.5)],
      existingInvertByNodeId: new Map(),
    })
    expect(tie.tied).toBe(false)
    expect(tie.comparedNodes).toBe(0)
    expect(tie.reason).toContain('не проверялась')
    expect(tie.reason).toContain('Существующая сеть и АТО')
  })
})
