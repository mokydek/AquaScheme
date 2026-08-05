import type { TracedNetwork } from '@aquascheme/engine'
import { saveDataset } from './datasets'
import { replaceNetwork } from './network'
import { formatAppError } from './errorFormatting'
import {
  STANKEVICHA_CHAMBERS,
  STANKEVICHA_CONDITIONS as TU,
  STANKEVICHA_GEOLOGY as GEO,
  STANKEVICHA_MIN_MAIN_DEPTH_M,
} from './stankevichaDemo'

/**
 * Загрузка объекта «Станкевича» в проект.
 *
 * Кладёт данные туда же, куда их кладёт синтетическое демо, чтобы разделы
 * проекта работали на настоящем объекте, а не показывали его отдельной
 * табличкой: сеть, съёмка, геология, штамп и величины технических условий.
 *
 * Что НЕ кладётся и почему: подписанных оригиналов ТЗ, АПЗ, ТУ и отчётов здесь
 * нет — раздел исходно-разрешительной документации остаётся пустым намеренно.
 * Подложить туда учебные файлы вместо подписанных значило бы выдать
 * демонстрацию за комплект, пригодный к выпуску.
 */

export interface StankevichaSeedResult {
  seededSections: number
  failures: string[]
}

export const STANKEVICHA_PROJECT_NAME = 'Реконструкция К1 по ул. Станкевича'

/** Сеть из камер: узел на камеру, труба между соседними. */
export function buildStankevichaNetwork(): TracedNetwork {
  const nodes = STANKEVICHA_CHAMBERS.map((chamber, index) => ({
    id: chamber.label,
    x: chamber.x,
    y: chamber.y,
    z: chamber.rimElevationM,
    // Низовой конец — выпуск: по нему конвейер и находит куда считать сток.
    kind: index === STANKEVICHA_CHAMBERS.length - 1 ? 'outlet' : 'manhole',
  }))
  const pipes = STANKEVICHA_CHAMBERS.slice(1).map((chamber, index) => {
    const from = STANKEVICHA_CHAMBERS[index]
    return {
      id: `У-${index + 1}`,
      fromNode: from.label,
      toNode: chamber.label,
      lengthM: Math.round(Math.hypot(chamber.x - from.x, chamber.y - from.y) * 100) / 100,
      diameterMm: TU.designDiameterMm,
    }
  })
  return { nodes, pipes } as unknown as TracedNetwork
}

export async function seedStankevichaProject(projectId: string): Promise<StankevichaSeedResult> {
  const failures: string[] = []
  let seededSections = 0
  const step = async (name: string, action: () => Promise<void>) => {
    try {
      await action()
      seededSections += 1
    } catch (error) {
      failures.push(`${name}: ${formatAppError(error)}`)
    }
  }

  // Отметки крышек колодцев — единственные высотные отметки объекта, которые
  // вошли в производные величины. Полная съёмка остаётся в исходных файлах.
  const surveyPoints = STANKEVICHA_CHAMBERS.map((chamber) => ({
    id: chamber.label, x: chamber.x, y: chamber.y, z: chamber.rimElevationM,
  }))

  await step('topography', () => saveDataset(projectId, 'topography', { points: surveyPoints }, {
    total: surveyPoints.length,
    accepted: surveyPoints.length,
    zMin: Math.min(...surveyPoints.map((point) => point.z)),
    zMax: Math.max(...surveyPoints.map((point) => point.z)),
    coordinateSystem: 'Сетка 50×50 м топосъёмки объекта',
  }, 'stankevicha-chambers.json'))

  await step('geology', () => saveDataset(projectId, 'geology', {
    boreholes: GEO.boreholes,
    boreholeDepthM: GEO.boreholeDepthM,
    groundwaterEncountered: GEO.groundwaterEncountered,
    layers: GEO.layers,
    // Промерзание для суглинка: им сложена верхняя часть разреза.
    freezingDepthM: GEO.freezingDepthM.suglinok,
    freezingDepthBySoil: GEO.freezingDepthM,
    source: 'Геологический отчёт по объекту, скважины С-1…С-3',
  }, { boreholes: GEO.boreholes, layers: GEO.layers.length }, 'stankevicha-geology.json'))

  await step('seismic', () => saveDataset(projectId, 'seismic', {
    points: GEO.seismicityPoints,
    source: 'СП РК 2.03-30-2017*, приложение Б; подзона III-А-1 по СП РК 2.03-31-2020',
  }, { points: GEO.seismicityPoints }, 'stankevicha-seismic.json'))

  await step('title block', () => saveDataset(projectId, 'title_block', {
    organisation: TU.customer,
    objectName: TU.objectName,
    stage: TU.stage,
  }, {}, 'stankevicha-title.json'))

  // Диаметры по схеме генплана: ТУ назначают один диаметр на всю трассу,
  // поэтому сверка с генпланом получает строку на каждый участок.
  const network = buildStankevichaNetwork()
  await step('master plan', () => saveDataset(projectId, 'master_plan', {
    segments: network.pipes.map((pipe) => ({
      id: pipe.id, planDiameterMm: TU.designDiameterMm,
    })),
  }, { segments: network.pipes.length }, 'stankevicha-tu.json'))

  await step('network', () => replaceNetwork(projectId, network, {
    status: 'preliminary',
    report: {
      designDiameterMm: TU.designDiameterMm,
      minMainDepthM: STANKEVICHA_MIN_MAIN_DEPTH_M,
      quality: { totalLengthM: network.pipes.reduce((total, pipe) => total + (pipe.lengthM ?? 0), 0) },
    },
  }))

  return { seededSections, failures }
}
