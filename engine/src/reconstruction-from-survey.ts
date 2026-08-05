import { agskConcreteGravityPipeCode, agskSectionForGravityPipe } from './norms/agsk'
import { crossingsFromSurvey } from './crossings-from-survey'
import {
  deriveDepthBandsFromSurvey,
  triageCrossings,
  type CrossingTriage,
  type DerivedDepthBands,
} from './crossing-triage'
import {
  classifyDxfConstraints,
  type DxfConstraintData,
  type DxfLayerRole,
  type DxfNetworkData,
} from './dxfread'
import { extractExistingUtilities, type ExistingUtilityNetwork } from './existing-utilities'
import { detectSurveyGrid, type SurveyGridFinding } from './surveygrid'
import { picketLabelExact } from './norms/sheetset'
import { manholeSpacingM } from './norms/sewer'
import { findRoadCrossings } from './norms/structures'
import type { GravityProfile, SewerSchedule } from './norms/gravity'
import type { SurveyPoint } from './types'
import type { TracedNetwork } from './trace'
import type { RouteGeoreference } from './constrained-route'
import type { CrossingRecord } from './working-drawings'

/**
 * Assembles a reconstruction project from a topographic survey alone.
 *
 * Replacing a street sewer is the one case where the survey already contains
 * the design geometry: the run follows the existing chambers, their invert
 * labels give the profile, and the drawn utilities give the crossings. This
 * module is the glue between the individual readers and the drawing set, so
 * the chain is a product capability rather than something reassembled by hand
 * for each project.
 *
 * The design bore is NOT inferred. Technical conditions state it («Д=450мм»),
 * and guessing it from an existing ceramic line would silently redesign the
 * project, so the caller must pass it.
 */

export interface ReconstructionSurveyOptions {
  /** Design bore from the technical conditions, mm. */
  designDiameterMm: number
  system?: 'sewer' | 'storm'
  /** Smallest chamber the local operator allows; Almaty requires 1500 mm. */
  minChamberDiameterMm?: number
  /** Layers whose annotation describes the line being reconstructed. */
  existingLayerPattern?: RegExp
  /**
   * Наименьшая глубина камеры магистрали, м: мельче — врезка.
   *
   * Умолчания нет. На объекте по ул. Станкевича проверено, что съёмка сама
   * врезку от магистральной камеры не отличает — ни смещением от оси, ни
   * отметкой лотка относительно соседей. Разделяет только глубина, и порог
   * назначает инженер по техническому отчёту.
   */
  minMainDepthM?: number
  /**
   * Номера первого и последнего колодца трассы, с 1.
   *
   * Границы объекта заданы техническими условиями, а в съёмке не отмечены:
   * она покрывает больше, чем объект. Вывести их из чертежа нельзя.
   */
  firstChamber?: number
  lastChamber?: number
  /**
   * Роли слоёв, назначенные инженером вручную.
   *
   * Без них путь реконструкции был тупиковым: нераспознанные слои блокируют
   * выпуск, а снять блок было негде — таблица сопоставления существовала только
   * в секции импорта чертежа.
   */
  roleOverrides?: Partial<Record<string, DxfLayerRole>>
  /**
   * Требуемый вертикальный просвет в пересечении, м.
   *
   * Единственная величина отбора, которой нет в исходных данных: это не
   * измерение, а требование владельца сети из технических условий. В имеющемся
   * комплекте нормативов её тоже нет — полнотекстовый поиск по СН РК 4.01-03-2013*
   * и СП РК 4.01-103-2013 не дал ни требований к просветам между сетями, ни
   * расстояний по вертикали; они в отсутствующих СН РК 3.01. Пока величина не
   * задана, отбор не выполняется и все неотнивелированные пересечения остаются
   * требующими вскрытия — подставлять сюда цифру «по опыту» значило бы выдать
   * догадку за норму.
   */
  requiredClearanceM?: number
  /**
   * Ширина проезжей части, м, для длины футляра на переходе под дорогой.
   *
   * Умолчания нет по той же причине, что и у просвета: в топосъёмке ширины
   * дороги нет, и принятое «по опыту» значение попало бы в проект как
   * посчитанное. Без неё переход выявляется, но длина футляра не заполняется.
   */
  roadWidthM?: number
}

export interface ReconstructionFromSurvey {
  network: TracedNetwork
  profile: GravityProfile
  schedule: SewerSchedule
  crossings: CrossingRecord[]
  surveyPoints: SurveyPoint[]
  constraints: DxfConstraintData
  grid: SurveyGridFinding
  existing: ExistingUtilityNetwork
  /** Геопривязка в том виде, в каком её принимает набор рабочих чертежей. */
  georeference: RouteGeoreference
  /** Chainage of every chamber along the run, m. */
  chainageM: number[]
  totalLengthM: number
  /**
   * Пересечения трассы с автомобильными дорогами.
   *
   * Отдельно от `crossings`: те приходят из пересечений с коммуникациями, а эти
   * — с осями дорог, и требуют футляра. Длина футляра не подставляется, она
   * считается по ширине дороги, которой в чертеже нет.
   */
  roadCrossings: CrossingRecord[]
  /**
   * Диапазоны глубин залегания пересекаемых сетей, выведенные из парных
   * отметок самой съёмки. Считаются всегда — вход инженера для этого не нужен.
   */
  depthBands: DerivedDepthBands
  /**
   * Отбор пересечений на контрольное вскрытие. `null`, когда не задан
   * требуемый просвет: без него исход не оценивается.
   */
  crossingTriage: CrossingTriage | null
  /** Reasons the result is not yet a releasable project. */
  blockers: string[]
  reason: string
}

/** Builds the reconstruction inputs a working-drawing set needs. */
export function buildReconstructionFromSurvey(
  data: DxfNetworkData,
  options: ReconstructionSurveyOptions,
): ReconstructionFromSurvey {
  const system = options.system ?? 'sewer'
  const constraints = classifyDxfConstraints(data, options.roleOverrides ?? {})
  const grid = detectSurveyGrid(data)
  const existing = extractExistingUtilities(data, options.existingLayerPattern ?? /канализ/i,
    {
      minMainDepthM: options.minMainDepthM,
      firstChamber: options.firstChamber,
      lastChamber: options.lastChamber,
    })
  const chain = existing.chain
  const blockers: string[] = []

  if (!Number.isFinite(options.designDiameterMm) || options.designDiameterMm <= 0) {
    blockers.push('Не задан проектный диаметр: он берётся из технических условий, а не из съёмки.')
  }
  if (chain.length < 2) {
    blockers.push('По съёмке не восстановлена цепочка существующих колодцев: трасса реконструкции неизвестна.')
  }
  if (constraints.surveyPoints.length === 0) {
    blockers.push('Нет отметок поверхности: продольный профиль построить нельзя.')
  }
  if (!grid.detected) {
    blockers.push('Координатная сетка не найдена: масштаб и разворот чертежа не подтверждены.')
  } else if (grid.offsetSource === 'none') {
    blockers.push('Линии координатной сетки не подписаны: начало координат требуется подтвердить.')
  }

  const chainageM: number[] = chain.length > 0 ? [0] : []
  for (let i = 1; i < chain.length; i++) {
    chainageM.push(chainageM[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y))
  }
  const totalLengthM = chainageM.length > 0 ? chainageM[chainageM.length - 1] : 0

  // A gravity run is chambers ending at an outlet. «ring»/«source» are water
  // supply terms and would misdescribe the network downstream.
  const nodes: TracedNetwork['nodes'] = chain.map((chamber, index) => ({
    id: `MH-${index + 1}`,
    kind: index === chain.length - 1 ? 'outlet' : 'manhole',
    label: `КК-${index + 1}`,
    x: chamber.x,
    y: chamber.y,
    groundElevation: chamber.rimElevationM,
  }))
  const pipes: TracedNetwork['pipes'] = chain.slice(1).map((chamber, index) => ({
    id: `P-${index + 1}`,
    kind: 'gravity_collector',
    fromNode: nodes[index].id,
    toNode: nodes[index + 1].id,
    lengthM: chainageM[index + 1] - chainageM[index],
    alignment: [
      { x: chain[index].x, y: chain[index].y },
      { x: chamber.x, y: chamber.y },
    ],
    dataSource: 'survey:existing-chamber-chain',
  }))

  const profile: GravityProfile = {
    stations: chain.map((chamber, index) => ({
      nodeId: nodes[index].id,
      chainageM: chainageM[index],
      groundElevationM: chamber.rimElevationM,
      invertElevationM: chamber.invertElevationM,
      depthM: chamber.depthM,
      diameterMm: options.designDiameterMm,
    })),
    maxDepthM: chain.reduce((deepest, chamber) => Math.max(deepest, chamber.depthM), 0),
    outletInvertElevationM: chain.length > 0 ? chain[chain.length - 1].invertElevationM : 0,
    totalLengthM,
    pipeIds: pipes.map((pipe) => pipe.id),
  }

  const schedule: SewerSchedule = {
    manholes: chain.map((chamber, index) => ({
      nodeId: nodes[index].id,
      label: `КК-${index + 1}`,
      picket: picketLabelExact(chainageM[index]),
      depthMm: Math.round(chamber.depthM * 1000),
      pipeDiameterMm: options.designDiameterMm,
    })),
    pipes: [{
      designation: `Труба DN${options.designDiameterMm}`,
      diameterMm: options.designDiameterMm,
      lengthM: totalLengthM,
      // Exact catalogue position where it was transcribed, otherwise the
      // подраздел, so the specification still carries a classifier value.
      agskCode: agskConcreteGravityPipeCode(options.designDiameterMm)
        ?? agskSectionForGravityPipe('concrete').code,
    }],
    totalPipeLengthM: totalLengthM,
  }

  /** Отметка на пикете по линейной интерполяции между замерами в колодцах. */
  const alongChain = (
    station: number,
    valueOf: (chamber: (typeof chain)[number]) => number,
  ): number | null => {
    if (chain.length === 0) return null
    for (let i = 1; i < chainageM.length; i++) {
      if (station <= chainageM[i]) {
        const span = Math.max(chainageM[i] - chainageM[i - 1], 1e-9)
        const t = (station - chainageM[i - 1]) / span
        return valueOf(chain[i - 1]) + t * (valueOf(chain[i]) - valueOf(chain[i - 1]))
      }
    }
    return valueOf(chain[chain.length - 1])
  }

  const invertAt = (station: number) => alongChain(station, (chamber) => chamber.invertElevationM)
  // Крышка колодца лежит в уровне покрытия, поэтому отметка обечайки и есть
  // отметка земли на пикете — тот же источник, что уже даёт профилю линию
  // поверхности. Ничего не интерполируется по площади: это замеры на самой трассе.
  const groundAt = (station: number) => alongChain(station, (chamber) => chamber.rimElevationM)

  const crossings = chain.length >= 2
    ? crossingsFromSurvey(
      chain.map((chamber) => ({ x: chamber.x, y: chamber.y })),
      constraints,
      data,
      { ownChamberStationsM: chainageM, designInvertAtM: invertAt },
    )
    : []
  // Шаг колодцев по норме против фактического: реконструкция идёт по
  // существующим колодцам, и если они стоят реже, чем допускает п. 7.4.1 для
  // проектного диаметра, между ними придётся добавлять новые. Молча принять
  // существующий шаг нельзя — по проектной трубе он может уже не проходить.
  const allowedSpacingM = manholeSpacingM(options.designDiameterMm).value
  const tooFarApart = pipes
    .map((pipe, index) => ({ pipe, index }))
    .filter(({ pipe }) => pipe.lengthM > allowedSpacingM + 1e-6)
  if (tooFarApart.length > 0) {
    blockers.push(
      `Шаг колодцев больше допустимого ${allowedSpacingM} м для DN${options.designDiameterMm} `
      + `(п. 7.4.1) на ${tooFarApart.length} участках: `
      + `${tooFarApart.slice(0, 5).map(({ pipe }) => `${pipe.id} — ${pipe.lengthM.toFixed(1)} м`).join(', ')}`
      + `${tooFarApart.length > 5 ? ' и далее' : ''}. Требуются промежуточные колодцы.`,
    )
  }

  // Пересечения с дорогами не выявлялись вовсе: crossingsFromSurvey пересекает
  // ось с коммуникациями, а дороги — отдельная роль слоя. Переход под дорогой
  // требует футляра, и без карточки он в проект просто не попадал.
  //
  // Длина футляра считается по ширине дороги. Ширины в чертеже нет, поэтому
  // она приходит от инженера через `roadWidthM`; без неё длина не заполняется
  // вовсе — подставленное умолчание было бы догадкой в проектном документе.
  // Требование футляра к тому же из ТЗ, а не из норматива, и в реестре оно не
  // подтверждено.
  const roadCrossings: CrossingRecord[] = chain.length >= 2
    ? findRoadCrossings(
      chain.map((chamber) => ({ x: chamber.x, y: chamber.y })),
      constraints.roadLines.map((line, index) => ({
        id: line.layer ?? `дорога-${index + 1}`,
        points: line.points,
      })),
      { roadWidthM: options.roadWidthM ?? null },
    ).map((crossing, index) => ({
      id: `Д-${index + 1}`,
      stationM: Math.round(crossing.stationM * 100) / 100,
      kind: 'автомобильная дорога',
      source: `пересечение оси с дорогой «${crossing.roadId}» по чертежу`
        + (crossing.casingLengthM ? `; футляр ${crossing.casingLengthM.value} м — ${crossing.casingLengthM.note}` : ''),
      designInvertElevationM: invertAt(crossing.stationM) ?? undefined,
    }))
    : []

  // Диапазоны глубин выводятся из парных отметок съёмки — вход инженера не нужен.
  const depthBands = deriveDepthBandsFromSurvey(constraints)

  const crossingTriage = crossings.length > 0
    && Number.isFinite(options.requiredClearanceM)
    && (options.requiredClearanceM as number) > 0
    ? triageCrossings({
      crossings,
      depthBands: depthBands.bands,
      requiredClearanceM: options.requiredClearanceM as number,
      groundElevationAtM: groundAt,
      designDiameterMm: options.designDiameterMm,
    })
    : null

  if (roadCrossings.length > 0) {
    blockers.push(
      `Переходов под автомобильными дорогами: ${roadCrossings.length} `
      + `(пикеты ${roadCrossings.map((crossing) => crossing.stationM.toFixed(0)).join(', ')} м). `
      + (options.roadWidthM != null && options.roadWidthM > 0
        ? 'Каждый требует футляра; длина футляра посчитана по заданной ширине дороги.'
        : 'Каждый требует футляра; длина футляра не посчитана: не задана ширина дороги.'),
    )
  }

  const unresolved = crossings.filter((crossing) => crossing.existingElevationM === undefined).length
  if (crossingTriage !== null) {
    // Отбор состоялся: вскрывать нужно не всё неотнивелированное, а только то,
    // где исход зависит от фактической отметки.
    if (crossingTriage.needLevelling.length > 0) {
      blockers.push(`Контрольное вскрытие: ${crossingTriage.needLevelling.length} пересечений `
        + `из ${crossings.length}. ${crossingTriage.summary} ${depthBands.reason}`)
    }
    if (crossingTriage.conflicts.length > 0) {
      blockers.push(`Неустранимых измерением пересечений: ${crossingTriage.conflicts.length} — `
        + 'требуется футляр, перекладка или изменение проектных отметок.')
    }
  } else if (unresolved > 0) {
    blockers.push(`Пересечений без снятой отметки: ${unresolved} из ${crossings.length} — `
      + 'требуется контрольное вскрытие или данные владельца сети. '
      + `${depthBands.reason} Отбор на вскрытие не выполнен: не задан требуемый просвет `
      + '(технические условия владельца сети).')
  }

  return {
    network: { nodes, pipes, totalLengthM },
    profile,
    schedule,
    crossings,
    surveyPoints: constraints.surveyPoints,
    constraints,
    grid,
    existing,
    // Привязкой считается только подписанная сетка: без подписей известны
    // масштаб и разворот, но не начало координат, и выдавать это за
    // геопривязку нельзя.
    georeference: grid.detected && grid.offsetSource === 'grid_labels'
      ? { kind: 'survey_grid', pitchM: grid.pitchX ?? undefined, source: grid.reason }
      : { kind: 'unreferenced', source: grid.reason },
    chainageM,
    totalLengthM,
    /** Пересечения с автомобильными дорогами: каждое требует футляра. */
    roadCrossings,
    depthBands,
    crossingTriage,
    blockers,
    reason: chain.length < 2
      ? 'Реконструкция по съёмке не собрана: нет цепочки колодцев.'
      : `Реконструкция ${system === 'storm' ? 'К2' : 'К1'} DN${options.designDiameterMm}: `
        + `${chain.length} колодцев, ${totalLengthM.toFixed(1)} м, пересечений ${crossings.length}`
        + `${options.minChamberDiameterMm ? `, минимальный колодец ${options.minChamberDiameterMm} мм` : ''}.`,
  }
}
