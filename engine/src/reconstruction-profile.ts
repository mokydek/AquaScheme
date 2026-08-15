import type { ProfileStation } from './norms/gravity'

/**
 * Продольный профиль РЕКОНСТРУКЦИИ: лоток закладывается от измеренных отметок.
 *
 * Обычный решатель проектирует линию «в чистом поле»: голова садится на
 * наименьшее заглубление от промерзания, дальше лоток падает по уклону. Для
 * нового строительства это верно, для реконструкции — нет.
 *
 * Сравнение с рабочим проектом по ул. Станкевича показало цену ошибки: наш
 * профиль клал трубу на 1,95 м, уложенная лежит на 2,01…5,63 м. Уклоны при этом
 * были по норме исправны — неверна была постановка задачи. Реконструкция
 * обязана состыковаться с существующими колодцами: по акту обследования их
 * лотки лежат на 3,7…5,2 м, и новая труба не может прийти выше — стыковаться
 * будет не с чем.
 *
 * ЧТО СЧИТАЕТСЯ СВЯЗЬЮ. Только узел с ИЗМЕРЕННОЙ отметкой лотка. Узел без неё
 * связью не становится: его проектная отметка выводится между связями, а не
 * придумывается. Отметки берутся из акта обследования или съёмки, то есть из
 * данных, а не из нормы.
 *
 * ЧТО ДЕЛАЕТСЯ С УКЛОНОМ. Между двумя связями обе отметки закреплены, поэтому
 * уклон не выбирается — он ВЫЧИСЛЯЕТСЯ и проверяется по норме. Не проходит —
 * это инженерный конфликт, и он сообщается числами с вариантами решения.
 * Молча нарушить норму или молча подвинуть измеренную отметку нельзя: первое
 * даёт непроходной проект, второе — выдуманную величину.
 *
 * ПРОМЕРЗАНИЕ СТАНОВИТСЯ ПРОВЕРКОЙ. Оно больше не задаёт положение лотка на
 * реконструкции: положение задают измеренные отметки. Норма проверяется после
 * стыковки, и где труба выходит мельче — это названное предупреждение, а не
 * повод переложить профиль.
 */

/** Узел, где проектный лоток закреплён измеренной отметкой. */
export interface InvertTiePoint {
  nodeId: string
  /** Измеренная отметка лотка существующего колодца, м. */
  invertElevationM: number
}

export type SlopeConflictKind = 'belowMin' | 'aboveMax' | 'counter'

export interface SlopeConflict {
  fromNodeId: string
  toNodeId: string
  lengthM: number
  /** Уклон, который получается между закреплёнными отметками, м/м. */
  actualSlope: number
  minSlope: number
  maxSlope: number
  kind: SlopeConflictKind
  message: string
}

/** Узел, где после стыковки труба лежит мельче нормы промерзания. */
export interface ShallowStation {
  nodeId: string
  depthM: number
  requiredDepthM: number
}

export interface ReconstructionProfile {
  stations: ProfileStation[]
  /** Узлы, ставшие связями: их лоток равен измеренному. */
  tieNodeIds: string[]
  conflicts: SlopeConflict[]
  shallow: ShallowStation[]
  /** Профиль заложен от измеренных отметок. */
  tied: boolean
  reason: string
}

const round2 = (value: number) => Math.round(value * 100) / 100
const permille = (slope: number) => (slope * 1000).toFixed(2)

/**
 * Закладывает профиль от связей.
 *
 * Станции приходят уже посчитанными обычным путём — от них берутся узлы,
 * пикетаж, отметки земли и диаметры. Пересчитываются только отметки лотка и
 * глубины: остальное к постановке задачи отношения не имеет.
 */
export function layReconstructionProfile(input: {
  stations: readonly ProfileStation[]
  /** Измеренные отметки лотков по узлам. Узла нет в карте — связью он не станет. */
  existingInvertByNodeId: ReadonlyMap<string, number>
  /** Наименьший уклон по норме для диаметра, м/м. */
  minSlopeFor: (diameterMm: number) => number
  /** Наибольший практический уклон, м/м. */
  maxSlope: number
  /** Наименьшее заглубление до лотка по норме для диаметра, м. Для проверки. */
  minDepthFor: (diameterMm: number) => number
}): ReconstructionProfile {
  const stations = [...input.stations]
  if (stations.length < 2) {
    return {
      stations,
      tieNodeIds: [],
      conflicts: [],
      shallow: [],
      tied: false,
      reason: 'Профиль реконструкции не закладывался: станций меньше двух.',
    }
  }

  const tieIndexes: number[] = []
  for (let index = 0; index < stations.length; index++) {
    const measured = input.existingInvertByNodeId.get(stations[index].nodeId)
    if (measured !== undefined && Number.isFinite(measured)) tieIndexes.push(index)
  }

  if (tieIndexes.length < 2) {
    // Одной связи мало: закрепить можно только конец, а уклон между концами
    // тогда не определён. Это честный отказ, а не повод придумать вторую.
    return {
      stations,
      tieNodeIds: tieIndexes.map((index) => stations[index].nodeId),
      conflicts: [],
      shallow: [],
      tied: false,
      reason: `Профиль реконструкции не закладывался: измеренных отметок лотка `
        + `${tieIndexes.length} из ${stations.length} узлов, а для стыковки нужны минимум две. `
        + 'Загрузите акт обследования или съёмку с отметками лотков — раздел «Существующая сеть и АТО».',
    }
  }

  const invert = new Array<number>(stations.length)
  for (const index of tieIndexes) {
    invert[index] = input.existingInvertByNodeId.get(stations[index].nodeId) as number
  }

  const conflicts: SlopeConflict[] = []
  for (let pair = 0; pair < tieIndexes.length - 1; pair++) {
    const from = tieIndexes[pair]
    const to = tieIndexes[pair + 1]
    const lengthM = stations[to].chainageM - stations[from].chainageM
    const fall = invert[from] - invert[to]
    const actualSlope = lengthM > 0 ? fall / lengthM : 0
    // Диаметр берётся наибольший на участке: наименьший уклон нормы задаётся им.
    let diameterMm = 0
    for (let index = from; index <= to; index++) {
      diameterMm = Math.max(diameterMm, stations[index].diameterMm)
    }
    const minSlope = input.minSlopeFor(diameterMm)

    // Промежуточные узлы без измеренной отметки идут ПРЯМОЙ между связями:
    // обе отметки закреплены, и другой линии между ними быть не может.
    for (let index = from + 1; index < to; index++) {
      const share = lengthM > 0 ? (stations[index].chainageM - stations[from].chainageM) / lengthM : 0
      invert[index] = invert[from] - fall * share
    }

    const kind: SlopeConflictKind | null = fall < 0
      ? 'counter'
      : actualSlope + 1e-9 < minSlope
        ? 'belowMin'
        : actualSlope - 1e-9 > input.maxSlope ? 'aboveMax' : null
    if (kind === null) continue

    const head = `Между ${stations[from].nodeId} и ${stations[to].nodeId} (${round2(lengthM)} м) `
      + `измеренные отметки лотка дают уклон ${permille(actualSlope)} ‰`
    const norm = `норма для Ø${diameterMm}: не менее ${permille(minSlope)} ‰, `
      + `не более ${permille(input.maxSlope)} ‰`
    // Варианты называются, но не выбираются: выбор между перепадом и правкой
    // отметки — решение инженера, и подменять его расчётом нельзя.
    const options = kind === 'counter'
      ? 'Лоток поднимается против течения. Проверьте, к тем ли колодцам отнесены отметки, '
        + 'либо предусмотрите перекачку.'
      : kind === 'belowMin'
        ? 'Варианты: перепадный колодец на одной из связей (п. 7.4.5), '
          + 'уточнение измеренной отметки одной из связей, разбивка участка промежуточной связью.'
        : 'Варианты: перепадный колодец, чтобы срезать уклон, либо уточнение измеренной отметки.'
    conflicts.push({
      fromNodeId: stations[from].nodeId,
      toNodeId: stations[to].nodeId,
      lengthM: round2(lengthM),
      actualSlope,
      minSlope,
      maxSlope: input.maxSlope,
      kind,
      message: `${head}; ${norm}. ${options}`,
    })
  }

  // Выше первой связи и ниже последней профиль продолжается нормативным
  // уклоном от связи: закреплять там нечем, а обрывать профиль нельзя.
  const first = tieIndexes[0]
  const last = tieIndexes[tieIndexes.length - 1]
  for (let index = first - 1; index >= 0; index--) {
    const next = stations[index + 1]
    const span = next.chainageM - stations[index].chainageM
    invert[index] = invert[index + 1] + input.minSlopeFor(stations[index].diameterMm) * Math.abs(span)
  }
  for (let index = last + 1; index < stations.length; index++) {
    const previous = stations[index - 1]
    const span = stations[index].chainageM - previous.chainageM
    invert[index] = invert[index - 1] - input.minSlopeFor(stations[index].diameterMm) * Math.abs(span)
  }

  const laid: ProfileStation[] = stations.map((station, index) => ({
    ...station,
    invertElevationM: round2(invert[index]),
    depthM: round2(station.groundElevationM - invert[index]),
  }))

  // Промерзание — ПРОВЕРКА после стыковки, а не задатчик положения лотка.
  const shallow: ShallowStation[] = []
  for (const station of laid) {
    const requiredDepthM = round2(input.minDepthFor(station.diameterMm))
    if (station.depthM + 1e-9 < requiredDepthM) {
      shallow.push({ nodeId: station.nodeId, depthM: station.depthM, requiredDepthM })
    }
  }

  const tieNodeIds = tieIndexes.map((index) => stations[index].nodeId)
  const parts = [`Профиль заложен от измеренных отметок: связей ${tieNodeIds.length} из ${stations.length} узлов.`]
  if (conflicts.length > 0) {
    parts.push(`Уклон между связями не проходит по норме на ${conflicts.length} участке(ах) — решение за инженером.`)
  }
  if (shallow.length > 0) {
    parts.push(`Мельче нормы промерзания: ${shallow.length} узлов (${shallow.slice(0, 5).map((item) => item.nodeId).join(', ')}).`)
  }
  return {
    stations: laid,
    tieNodeIds,
    conflicts,
    shallow,
    tied: true,
    reason: parts.join(' '),
  }
}
