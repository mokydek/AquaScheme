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

/**
 * Сеть из камер: узел на камеру, труба между соседними.
 *
 * ИМЕНА ПОЛЕЙ ЗДЕСЬ — ЧАСТЬ ДОГОВОРА С БАЗОЙ. Сеть уходит в
 * `replace_project_network` как JSON, и SQL достаёт из него `groundElevation`,
 * `invertElevationM`, `kind`. Пока отметка крышки лежала в поле `z`, круг базы
 * возвращал её нулём: поле было на месте, просто называлось иначе. На этом
 * стояли все высотные выводы объекта — «Земля 0.00» в профиле, уклон 0,00 ‰,
 * нехватка падения и «самотёк не обеспечен» при живом рельефе 688,22…685,21 м.
 * Договор проверяется тестом ЧЕРЕЗ круг базы, а не по объекту в памяти: объект
 * в памяти был правильным всё это время.
 */
export function buildStankevichaNetwork(): TracedNetwork {
  const nodes = STANKEVICHA_CHAMBERS.map((chamber, index) => ({
    id: chamber.label,
    label: chamber.label,
    x: chamber.x,
    y: chamber.y,
    // Отметка крышки камеры — измеренная величина объекта, а не догадка.
    groundElevation: chamber.rimElevationM,
    // Отметка лотка тоже измерена и тоже подаётся: без неё существующий профиль
    // строить нечем, а он и есть предмет реконструкции.
    invertElevationM: chamber.invertElevationM,
    // Низовой конец — выпуск: по нему конвейер и находит куда считать сток.
    kind: index === STANKEVICHA_CHAMBERS.length - 1 ? 'outlet' : 'manhole',
  }))
  const pipes = STANKEVICHA_CHAMBERS.slice(1).map((chamber, index) => {
    const from = STANKEVICHA_CHAMBERS[index]
    return {
      id: `У-${index + 1}`,
      // Без вида участка база возвращала строку как `ring`, и всё, что отбирает
      // магистрали, её не видело.
      kind: 'main',
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
  /**
   * Какая миграция добавляет вид набора. База отвергает незнакомый вид
   * ограничением `datasets_kind_check`, и сырой текст Postgres не говорит
   * пользователю, что делать: нужен не разбор SQL, а имя файла миграции.
   */
  const MIGRATION_BY_KIND: Record<string, string> = {
    'title block': '0017_title_block.sql',
    'master plan': '0018_master_plan.sql',
  }

  const step = async (name: string, action: () => Promise<void>) => {
    try {
      await action()
      seededSections += 1
    } catch (error) {
      const text = formatAppError(error)
      const migration = MIGRATION_BY_KIND[name]
      failures.push(migration && /datasets_kind_check/.test(text)
        ? `${name}: база не принимает этот вид набора — примените миграцию`
          + ` backend/migrations/${migration} (или backend/bootstrap.sql целиком)`
        : `${name}: ${text}`)
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
    /*
      ПОСЕВ НЕ ВЫБИРАЕТ ГРУНТ. Здесь стояло `freezingDepthM: суглинок` — то
      есть наименьший из трёх кандидатов отчёта, — и величина уходила в расчёт
      как расчётная, получая на экране ранг «принято по умолчанию». Это тот же
      молчаливый выбор, что и прежний `Math.max`, только зеркальный: разница
      между 0,79 и 1,03 м — треть наименьшего заглубления.
      Кандидаты кладутся списком, выбор делает инженер в разделе геологии.
    */
    freezingDepthCandidates: GEO.freezingDepthCandidates,
    freezingDepthQuote: GEO.freezingDepthQuote,
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

  /**
   * Контрактный диаметр по техническим условиям.
   *
   * Раньше посев клал его только в схему генплана, а в `technical_conditions`
   * — единственный набор, который читает подбор диаметров, — не клал вовсе.
   * Из-за этого на загруженном объекте расчёт брал ряд каталога и сообщал
   * «диаметр не подобран, принят наименьший из заданного ряда»: путь ТУ был
   * исправен, но по нему нечего было вести.
   *
   * Происхождение — `ocr`, и это не формальность: у ТУ_05-3-2723 текстового
   * слоя нет вовсе, величина прочитана распознаванием, и в аудите она обязана
   * остаться отличимой от цифрового документа.
   */
  await step('technical conditions', () => saveDataset(projectId, 'technical_conditions', {
    designDiameterMm: {
      value: TU.designDiameterMm,
      origin: 'ocr',
      source: `${TU.conditionsNumber}, ${TU.conditionsClause} (распознано со скана)`,
      quote: TU.designDiameterQuote,
    },
  }, { designDiameterMm: TU.designDiameterMm }, 'stankevicha-tu-conditions.json'))

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
