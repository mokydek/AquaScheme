import { agskConcreteGravityPipeCode, agskSectionForGravityPipe } from './norms/agsk'
import { crossingsFromSurvey } from './crossings-from-survey'
import {
  deriveDepthBandsFromSurvey,
  triageCrossings,
  type CrossingTriage,
  type DerivedDepthBands,
} from './crossing-triage'
import { classifyDxfConstraints, type DxfConstraintData, type DxfNetworkData } from './dxfread'
import { extractExistingUtilities, type ExistingUtilityNetwork } from './existing-utilities'
import { detectSurveyGrid, type SurveyGridFinding } from './surveygrid'
import { picketLabelExact } from './norms/sheetset'
import type { GravityProfile, SewerSchedule } from './norms/gravity'
import type { SurveyPoint } from './types'
import type { TracedNetwork } from './trace'
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
  georeference: { kind: string; source: string } | null
  /** Chainage of every chamber along the run, m. */
  chainageM: number[]
  totalLengthM: number
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
  const constraints = classifyDxfConstraints(data)
  const grid = detectSurveyGrid(data)
  const existing = extractExistingUtilities(data, options.existingLayerPattern ?? /канализ/i)
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
    georeference: grid.detected
      ? {
        kind: grid.offsetSource === 'grid_labels' ? 'survey_grid' : 'survey_grid_unreferenced',
        source: grid.reason,
      }
      : null,
    chainageM,
    totalLengthM,
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
