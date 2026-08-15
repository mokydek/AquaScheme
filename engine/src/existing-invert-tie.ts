/**
 * Привязка проектного лотка к существующим колодцам на реконструкции.
 *
 * НАЙДЕНО СРАВНЕНИЕМ С РАБОЧИМ ПРОЕКТОМ того же объекта. Наш профиль по
 * ул. Станкевича выходит на наибольшую глубину 1,95 м, а рабочий проект кладёт
 * трубу на 2,01…5,63 м. Расхождение не в расчёте уклонов — они по норме
 * исправны, — а в постановке задачи: решатель проектирует линию «в чистом
 * поле», от глубины промерзания вниз, тогда как реконструкция ОБЯЗАНА
 * состыковаться с существующими колодцами. По акту обследования их лотки лежат
 * на 3,7…5,2 м, и новая труба не может пройти выше: стыковаться будет не с чем.
 *
 * Здесь не пересчитывается профиль — это отдельная работа. Здесь называется
 * расхождение: программа не имеет права выдать глубину 1,95 м как ответ, если
 * рядом лежат измеренные лотки вдвое глубже. Величина не подменяется, а
 * сопровождается стоп-фактором с разделом и действием.
 */

export interface ExistingInvertTieInput {
  /** Станции проектного профиля: узел и отметка лотка. */
  stations: ReadonlyArray<{ nodeId: string; invertElevationM: number }>
  /** Измеренные отметки лотков существующих колодцев по узлам. */
  existingInvertByNodeId: ReadonlyMap<string, number>
}

export interface ExistingInvertTie {
  /** Узлы, где сравнение выполнено. */
  comparedNodes: number
  /**
   * Узлы, где проектный лоток ВЫШЕ существующего больше допуска.
   *
   * Именно они делают стыковку невозможной: труба приходит выше колодца.
   */
  aboveExistingNodeIds: string[]
  /** Наибольшее превышение проектного лотка над существующим, м. */
  worstRiseM: number
  /** Стыковка проверена и возможна. */
  tied: boolean
  reason: string
}

/**
 * Допуск стыковки, м.
 *
 * Полсантиметра — точность съёмочной отметки; расхождение в её пределах не
 * говорит ни о чём. Всё, что больше, — это уже другая отметка лотка.
 */
const TIE_TOLERANCE_M = 0.05

/** Сверяет проектный лоток с измеренным. Ничего не подменяет и не двигает. */
export function assessExistingInvertTie(input: ExistingInvertTieInput): ExistingInvertTie {
  const above: Array<{ nodeId: string; riseM: number }> = []
  let compared = 0
  for (const station of input.stations) {
    const existing = input.existingInvertByNodeId.get(station.nodeId)
    if (existing === undefined || !Number.isFinite(existing)) continue
    compared += 1
    const riseM = station.invertElevationM - existing
    if (riseM > TIE_TOLERANCE_M) above.push({ nodeId: station.nodeId, riseM })
  }

  if (compared === 0) {
    return {
      comparedNodes: 0,
      aboveExistingNodeIds: [],
      worstRiseM: 0,
      tied: false,
      reason: 'Стыковка с существующими колодцами не проверялась: измеренных отметок лотка нет. '
        + 'Загрузите акт обследования или съёмку с отметками лотков — раздел «Существующая сеть и АТО».',
    }
  }

  above.sort((left, right) => right.riseM - left.riseM)
  const worstRiseM = above.length > 0 ? Math.round(above[0].riseM * 100) / 100 : 0
  if (above.length === 0) {
    return {
      comparedNodes: compared,
      aboveExistingNodeIds: [],
      worstRiseM: 0,
      tied: true,
      reason: `Проектный лоток стыкуется с существующими колодцами: проверено ${compared} узлов.`,
    }
  }
  const named = above.slice(0, 6).map((item) => item.nodeId).join(', ')
  return {
    comparedNodes: compared,
    aboveExistingNodeIds: above.map((item) => item.nodeId),
    worstRiseM,
    tied: false,
    reason: `Проектный лоток выше существующего в ${above.length} из ${compared} узлов, наибольшее `
      + `превышение ${worstRiseM.toFixed(2)} м (${named}${above.length > 6 ? ' и далее' : ''}). `
      + 'Реконструкция стыкуется с существующими колодцами, и труба не может прийти выше их лотка: '
      + 'профиль нужно перезаложить от измеренных отметок — раздел «Самотёчный расчёт».',
  }
}
