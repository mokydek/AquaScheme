/**
 * Непрерывна ли загруженная ось.
 *
 * Экран импорта отчитывался «Загружена трасса: 13 участков» и ставил зелёную
 * пометку, а шлюз рабочих чертежей в тот же момент держал план стоп-фактором
 * `PLAN_GEOMETRY_MISSING` — «нет непрерывной проектной оси». Оба утверждения
 * были по-своему верны и вместе давали неправду: участки загружены, но осью
 * они не стали. Владельцу оставалось гадать, какому экрану верить.
 *
 * Здесь считается то самое, о чём молчали оба: сколько связных цепочек
 * образуют загруженные участки и какими узлами цепочки обрываются. Одна
 * цепочка — ось непрерывна; больше одной — разрыв, и он назван поимённо.
 *
 * Связность считается по узлам, а не по координатам: сшивка вершин с допуском
 * уже выполнена при импорте, и второй раз решать, «достаточно ли близко»,
 * значило бы завести второй ответ на тот же вопрос.
 */

export interface AxisSegment {
  fromNodeId: string
  toNodeId: string
}

export interface AxisContinuity {
  segmentCount: number
  /** Связных цепочек. Одна — ось непрерывна. */
  chainCount: number
  continuous: boolean
  /**
   * Узлы, которыми обрываются цепочки.
   *
   * У непрерывной оси таких ровно два — её начало и конец, и разрывом они не
   * являются. Здесь они не перечисляются: разрыв — это концы ЛИШНИХ цепочек.
   */
  breakNodeIds: string[]
  reason: string
}

/** Оценивает связность загруженных участков. Ничего не сшивает и не чинит. */
export function assessAxisContinuity(segments: readonly AxisSegment[]): AxisContinuity {
  if (segments.length === 0) {
    return {
      segmentCount: 0,
      chainCount: 0,
      continuous: false,
      breakNodeIds: [],
      reason: 'Участков нет: оси не из чего собирать.',
    }
  }

  const parent = new Map<string, string>()
  const find = (node: string): string => {
    let root = parent.get(node) ?? node
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root
    // Путь сжимается, иначе на длинной цепочке поиск становится линейным.
    let walk = node
    while (walk !== root) {
      const next = parent.get(walk) ?? walk
      parent.set(walk, root)
      walk = next
    }
    return root
  }
  const degree = new Map<string, number>()
  for (const segment of segments) {
    for (const node of [segment.fromNodeId, segment.toNodeId]) {
      if (!parent.has(node)) parent.set(node, node)
      degree.set(node, (degree.get(node) ?? 0) + 1)
    }
    parent.set(find(segment.fromNodeId), find(segment.toNodeId))
  }

  const chains = new Map<string, string[]>()
  for (const node of parent.keys()) {
    const root = find(node)
    chains.set(root, [...(chains.get(root) ?? []), node])
  }
  const chainCount = chains.size
  const continuous = chainCount === 1

  // Концы цепочек — узлы степени 1. У непрерывной оси их два, и это её начало
  // и конец, а не разрыв. Разрывом объявляются концы всех прочих цепочек:
  // именно там ось обрывается и не продолжается.
  const endsOf = (nodes: string[]) => nodes.filter((node) => (degree.get(node) ?? 0) === 1).sort()
  const breakNodeIds = continuous
    ? []
    : [...chains.values()]
      // Самая длинная цепочка считается основной: её концы — концы оси.
      .sort((left, right) => right.length - left.length)
      .slice(1)
      .flatMap(endsOf)

  return {
    segmentCount: segments.length,
    chainCount,
    continuous,
    breakNodeIds,
    reason: continuous
      ? `Ось непрерывна: ${segments.length} участков одной цепочкой.`
      : `Ось разрывна: ${segments.length} участков образуют ${chainCount} несвязанных цепочек. `
        + (breakNodeIds.length > 0
          ? `Обрыв у узлов ${breakNodeIds.slice(0, 6).join(', ')}`
            + (breakNodeIds.length > 6 ? ` и ещё ${breakNodeIds.length - 6}` : '')
            + '. План строится по непрерывной оси, поэтому плановые листы держит стоп-фактор.'
          : 'План строится по непрерывной оси, поэтому плановые листы держит стоп-фактор.'),
  }
}
