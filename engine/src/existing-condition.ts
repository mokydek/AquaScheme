import { justified, type Justified } from './normregistry'
import { circularSection } from './norms/gravity'
import {
  designFilling,
  minVelocityMps,
  sewerChamberDiameterMm,
  sewerRoughnessN,
} from './norms/sewer'
import type { ConditionsFromText } from './norms/conditions-text'

/**
 * Заключение по существующей сети: то, что проект обязан вывести сам.
 *
 * До сих пор конвейер съёмку читал, но выводов из неё не делал. Он выдавал
 * одну длину — между центрами камер — и молчал о том, что в техническом
 * отчёте стоит другая. Уклоны существующей линии он показывал на профиле, но
 * нигде не говорил, проходят они по норме или нет, то есть главный вопрос
 * реконструкции — годится ли существующий профиль — оставался инженеру.
 *
 * Здесь три вывода, и ни один не требует ввода:
 *
 * 1. Длина трубы. Труба лежит между стенками камер, поэтому она короче
 *    расстояния между их центрами на диаметр колодца. Диаметр берётся не «по
 *    опыту», а по п. 7.4.2 от диаметра трубы и измеренной глубины.
 * 2. Уклоны. Норма для диаметров свыше 200 мм наименьшего уклона прямо не
 *    задаёт (см. `minSlopeForDiameter`), он выводится из условия наименьшей
 *    самоочищающей скорости таблицы 5.19.
 * 3. Сходимость с документом. Две независимые величины одного и того же —
 *    измеренная по чертежу и написанная в отчёте — сравниваются, и расхождение
 *    называется числом.
 */

export interface ChamberSize {
  nodeId: string
  depthM: number
  diameterMm: Justified<number>
}

export interface PipeLengthBreakdown {
  /** Ломаная по центрам камер: пикетаж и профиль считаются по ней. */
  axisLengthM: number
  /** Между стенками камер: столько трубы укладывается и закупается. */
  pipeLengthM: number
  /** Сумма вычетов на камеры, м. */
  deductionM: number
  chamberSizes: ChamberSize[]
  reason: string
}

/**
 * Длина трубы из длины оси за вычетом камер.
 *
 * На каждом участке труба не доходит до центров обеих камер на их половинные
 * диаметры. У промежуточной камеры вычитаются обе половины — по одной от
 * соседних участков, — поэтому она вычитается целиком, а крайние по половине.
 */
export function derivePipeLength(input: {
  nodeIds: string[]
  depthsM: number[]
  chainageM: number[]
  designDiameterMm: number
}): PipeLengthBreakdown {
  const { nodeIds, depthsM, chainageM, designDiameterMm } = input
  const chamberSizes: ChamberSize[] = nodeIds.map((nodeId, index) => ({
    nodeId,
    depthM: depthsM[index] ?? 0,
    diameterMm: sewerChamberDiameterMm(designDiameterMm, depthsM[index] ?? 0),
  }))
  const axisLengthM = chainageM.length > 0 ? chainageM[chainageM.length - 1] : 0

  let deductionM = 0
  for (let index = 1; index < chainageM.length; index++) {
    const half = (chamberSizes[index - 1]?.diameterMm.value ?? 0) / 2000
      + (chamberSizes[index]?.diameterMm.value ?? 0) / 2000
    const span = chainageM[index] - chainageM[index - 1]
    // Камера шире участка означала бы, что соседние камеры пересекаются:
    // вычитать больше самого участка нельзя, иначе длина уходит в минус.
    deductionM += Math.min(half, span)
  }
  const pipeLengthM = Math.max(axisLengthM - deductionM, 0)

  const sizes = [...new Set(chamberSizes.map((size) => size.diameterMm.value))].sort((a, b) => a - b)
  return {
    axisLengthM,
    pipeLengthM,
    deductionM,
    chamberSizes,
    reason: chamberSizes.length === 0
      ? 'Длина трубы не выведена: цепочка камер пуста.'
      : `Длина трубы ${pipeLengthM.toFixed(2)} м — ось ${axisLengthM.toFixed(2)} м `
        + `минус ${deductionM.toFixed(2)} м на ${chamberSizes.length} камер `
        + `(Ø ${sizes.join('/')} мм по п. 7.4.2).`,
  }
}

/**
 * Наименьший уклон из условия самоочищающей скорости.
 *
 * Норма задаёт скорость, а не уклон: v = (1/n)·R^(2/3)·√i при наибольшем
 * расчётном наполнении, откуда i = (v·n / R^(2/3))². Диаметр и наполнение
 * нормативные, шероховатость — из таблицы 5.18.
 */
export function selfCleaningMinSlope(
  diameterMm: number,
  system: 'sewer' | 'storm' = 'sewer',
): Justified<number> {
  const vMin = minVelocityMps(diameterMm, system)
  const fill = designFilling(diameterMm)
  const n = sewerRoughnessN('gravity')
  const radiusM = circularSection(diameterMm / 1000, fill.value).hydraulicRadiusM
  const slope = radiusM > 0
    ? Math.pow((vMin.value * n.value) / Math.pow(radiusM, 2 / 3), 2)
    : 0
  return justified(
    Math.round(slope * 1e6) / 1e6,
    [...vMin.refs, ...fill.refs, ...n.refs],
    // Все три входа нормативные, преобразование — формула Шези-Маннинга; своего
    // допущения здесь нет, поэтому основание остаётся нормативным.
    'normative',
    `${(slope * 1000).toFixed(2)} ‰ — уклон, при котором DN${diameterMm} при наполнении `
    + `${fill.value} достигает ${vMin.value} м/с (n = ${n.value})`,
  )
}

export type SlopeVerdictCode = 'ok' | 'below_min' | 'counter'

export interface SpanSlopeVerdict {
  pipeId: string
  fromNodeId: string
  toNodeId: string
  lengthM: number
  /** Падение лотка, м: положительное — вниз по течению. */
  fallM: number
  slope: number
  verdict: SlopeVerdictCode
  note: string
}

export interface ExistingSlopeAssessment {
  minSlope: Justified<number>
  spans: SpanSlopeVerdict[]
  compliant: number
  counter: number
  belowMin: number
  summary: string
}

/**
 * Оценка существующих уклонов по отметкам лотков.
 *
 * Это и есть вопрос реконструкции: можно ли уложить проектную трубу по
 * существующему профилю. Ответ считается из съёмки без единого ввода.
 */
export function assessExistingSlopes(input: {
  pipeIds: string[]
  fromNodeIds: string[]
  toNodeIds: string[]
  lengthsM: number[]
  invertsM: number[]
  /** Глубины камер: по ним отличается обратный уклон от отметки врезки. */
  depthsM?: number[]
  designDiameterMm: number
  system?: 'sewer' | 'storm'
}): ExistingSlopeAssessment {
  const system = input.system ?? 'sewer'
  const minSlope = selfCleaningMinSlope(input.designDiameterMm, system)
  const depths = input.depthsM ?? []

  /**
   * Камера мельче обоих соседей при поднявшемся лотке.
   *
   * Самотёк вверх не идёт, значит либо порядок цепочки неверен, либо снятая
   * отметка принадлежит не магистрали. Второе распознаётся: у врезки лоток
   * выше и камера мельче соседних. Это объяснение, а не исправление — ни одна
   * отметка не подменяется, вопрос выносится инженеру.
   */
  const shallowerThanNeighbours = (index: number): boolean => {
    const here = depths[index]
    const before = depths[index - 1]
    const after = depths[index + 1]
    if (here == null || before == null || after == null) return false
    return here < before && here < after
  }

  const spans: SpanSlopeVerdict[] = input.pipeIds.map((pipeId, index) => {
    const lengthM = input.lengthsM[index] ?? 0
    const fallM = (input.invertsM[index] ?? 0) - (input.invertsM[index + 1] ?? 0)
    const slope = lengthM > 0 ? fallM / lengthM : 0
    const verdict: SlopeVerdictCode = fallM < 0
      ? 'counter'
      : slope + 1e-9 < minSlope.value ? 'below_min' : 'ok'
    return {
      pipeId,
      fromNodeId: input.fromNodeIds[index] ?? '',
      toNodeId: input.toNodeIds[index] ?? '',
      lengthM,
      fallM,
      slope,
      verdict,
      note: verdict === 'counter'
        ? `лоток поднимается на ${Math.abs(fallM).toFixed(3)} м`
          + (shallowerThanNeighbours(index + 1)
            ? ' — камера мельче обеих соседних: вероятно, снята отметка лотка врезки,'
              + ' а не магистрали; требуется уточнение'
            : ' — течение против уклона: проверить порядок цепочки или отметки')
        : verdict === 'below_min'
          ? `${(slope * 1000).toFixed(2)} ‰ меньше ${(minSlope.value * 1000).toFixed(2)} ‰ — `
            + 'самоочищающая скорость не достигается'
          : `${(slope * 1000).toFixed(2)} ‰`,
    }
  })
  const counter = spans.filter((span) => span.verdict === 'counter').length
  const belowMin = spans.filter((span) => span.verdict === 'below_min').length
  const compliant = spans.length - counter - belowMin
  return {
    minSlope,
    spans,
    compliant,
    counter,
    belowMin,
    summary: spans.length === 0
      ? 'Уклоны не оценивались: участков нет.'
      : counter + belowMin === 0
        ? `Все ${spans.length} участков существующего профиля проходят по уклону `
          + `(не менее ${(minSlope.value * 1000).toFixed(2)} ‰).`
        : `Из ${spans.length} участков ${compliant} проходят по уклону; `
          + `${belowMin} положе ${(minSlope.value * 1000).toFixed(2)} ‰`
          + `${counter > 0 ? `, ${counter} с обратным уклоном` : ''}. `
          + 'Существующий профиль на них не годится: нужен перезалог отметок или перепад.',
  }
}

export interface DominantPipeLabel {
  material: string
  diameterMm: number
  /** Сколько подписей вдоль трассы дали это значение и сколько их всего. */
  count: number
  total: number
}

/**
 * Преобладающая подпись трубы вдоль трассы.
 *
 * Брать первую подпись из чертежа нельзя: их 32 на всю съёмку, и первая может
 * относиться к чужой сети. Считаются только подписи в коридоре вокруг цепочки,
 * и берётся самая частая — одиночная подпись соседнего выпуска не перевешивает.
 */
export function dominantPipeLabel(
  chain: Array<{ x: number; y: number }>,
  labels: Array<{ x: number; y: number; material: string; diameterMm: number }>,
  corridorM = 8,
): DominantPipeLabel | null {
  if (chain.length < 2) return null
  const near = labels.filter((label) => {
    for (let index = 1; index < chain.length; index++) {
      const ax = chain[index - 1].x
      const ay = chain[index - 1].y
      const dx = chain[index].x - ax
      const dy = chain[index].y - ay
      const lengthSq = dx * dx + dy * dy
      const t = lengthSq > 0
        ? Math.max(0, Math.min(1, ((label.x - ax) * dx + (label.y - ay) * dy) / lengthSq))
        : 0
      if (Math.hypot(label.x - (ax + t * dx), label.y - (ay + t * dy)) <= corridorM) return true
    }
    return false
  })
  if (near.length === 0) return null

  const tally = new Map<string, { material: string; diameterMm: number; count: number }>()
  for (const label of near) {
    const key = `${label.material}|${label.diameterMm}`
    const seen = tally.get(key)
    if (seen) seen.count += 1
    else tally.set(key, { material: label.material, diameterMm: label.diameterMm, count: 1 })
  }
  const best = [...tally.values()].sort((a, b) => b.count - a.count)[0]
  return { material: best.material, diameterMm: best.diameterMm, count: best.count, total: near.length }
}

export interface SourceCheck {
  quantity: string
  fromSurvey: string
  fromDocument: string
  agrees: boolean
  note: string
}

export interface SourceAgreement {
  checks: SourceCheck[]
  agreed: number
  summary: string
}

/**
 * Допуск на сходимость длины: 1 %.
 *
 * Длина по чертежу набирается из координат камер, длина в отчёте округляется
 * при съёмке рулеткой; расхождение в доли процента — это одна и та же линия.
 * Больше процента — разные величины или разная трасса, и об этом надо сказать.
 */
const LENGTH_TOLERANCE = 0.01

/**
 * Сходимость чертежа с документом.
 *
 * Две независимые записи одной величины — это единственная проверка, доступная
 * без выезда на объект. Проект не выбирает «правильную» из них: он называет
 * расхождение, потому что выбор между источниками — решение инженера.
 */
export function agreeWithDocument(input: {
  pipeLengthM: number
  chamberCount: number
  /** Преобладающая подпись трубы вдоль трассы, не первая попавшаяся в чертеже. */
  surveyLabel: DominantPipeLabel | null
  /** Диаметр камеры, выведенный по норме из глубины. */
  normChamberDiameterMm: number | null
  document: ConditionsFromText
}): SourceAgreement {
  const checks: SourceCheck[] = []
  const { document } = input

  if (document.lengthM) {
    const documented = document.lengthM.value
    const delta = input.pipeLengthM - documented
    const agrees = documented > 0 && Math.abs(delta) <= documented * LENGTH_TOLERANCE
    checks.push({
      quantity: 'Длина трубы, м',
      fromSurvey: input.pipeLengthM.toFixed(2),
      fromDocument: documented.toFixed(2),
      agrees,
      note: agrees
        ? `расхождение ${Math.abs(delta).toFixed(2)} м — в пределах 1 %`
        : `расхождение ${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)} м `
          + `(${(Math.abs(delta) / documented * 100).toFixed(1)} %) — источники расходятся`,
    })
  }

  if (document.chambers) {
    const agrees = input.chamberCount === document.chambers.value
    checks.push({
      quantity: 'Колодцев, шт',
      fromSurvey: String(input.chamberCount),
      fromDocument: String(document.chambers.value),
      agrees,
      note: agrees
        ? 'совпало'
        : `в цепочке ${input.chamberCount}, в документе ${document.chambers.value}`,
    })
  }

  if (document.chamberDiameterMm && input.normChamberDiameterMm != null) {
    const agrees = input.normChamberDiameterMm === document.chamberDiameterMm.value
    checks.push({
      quantity: 'Камера, мм',
      fromSurvey: String(input.normChamberDiameterMm),
      fromDocument: String(document.chamberDiameterMm.value),
      agrees,
      note: agrees
        ? 'размер, выведенный по п. 7.4.2 из глубины, подтверждён документом'
        : 'выведенный по п. 7.4.2 размер расходится с документом — проверить глубины',
    })
  }

  if (document.diameterMm && input.surveyLabel) {
    const agrees = input.surveyLabel.diameterMm === document.diameterMm.value
    checks.push({
      // Обе стороны описывают СУЩЕСТВУЮЩУЮ трубу: подписи вдоль трассы и
      // раздел характеристик обследуемой сети. С проектным диаметром, который
      // назначают технические условия, эта строка не связана.
      quantity: 'Диаметр существующей, мм',
      fromSurvey: String(input.surveyLabel.diameterMm),
      fromDocument: String(document.diameterMm.value),
      agrees,
      note: agrees
        ? `${input.surveyLabel.count} подписей вдоль трассы совпали с документом`
        : `на трассе ${input.surveyLabel.count} подписей из ${input.surveyLabel.total} `
          + `дают Ø${input.surveyLabel.diameterMm}, документ — Ø${document.diameterMm.value}; `
          + 'чертёж и отчёт описывают одну сеть по-разному',
    })
  }

  if (document.material && input.surveyLabel) {
    // «керамическая» в отчёте против «керамика» в подписи: сравнивается корень.
    const stem = (value: string) => value.trim().toLowerCase().slice(0, 5)
    const agrees = stem(input.surveyLabel.material) === stem(document.material.value)
    checks.push({
      quantity: 'Материал',
      fromSurvey: input.surveyLabel.material,
      fromDocument: document.material.value,
      agrees,
      note: agrees ? 'подпись на чертеже совпала с документом' : 'подпись на чертеже расходится с документом',
    })
  }

  const agreed = checks.filter((check) => check.agrees).length
  return {
    checks,
    agreed,
    summary: checks.length === 0
      ? 'Сверять не с чем: в документе не прочитана ни одна величина.'
      : agreed === checks.length
        ? `Чертёж и документ сходятся по всем ${checks.length} величинам.`
        : `Сходятся ${agreed} из ${checks.length}: `
          + checks.filter((check) => !check.agrees).map((check) => `${check.quantity} — ${check.note}`).join('; ')
          + '.',
  }
}
