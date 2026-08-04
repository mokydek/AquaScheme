import type { GravityProfile } from './gravity'
import type { SewerSchedule } from './gravity'
import type { SelectedManholeConstruction } from '../manhole-catalog'
import type { DropWell } from './drop-wells'

/**
 * Ведомость объёмов работ.
 *
 * Сметчик ждёт её первой, а все исходные величины проект уже считает: длины по
 * диаметрам, глубины по профилю, колодцы по типам из подобранных конструкций.
 * Не хватало только сведения их в один документ.
 *
 * Разделение строгое. Строка либо выводится из посчитанного, либо не выводится
 * вовсе и называет, какой величины ей не хватает. Земляные работы зависят от
 * ширины траншеи и заложения откоса, а норматива на них в реестре проекта нет:
 * подставленные «обычные» значения дали бы объём, неотличимый от расчётного, и
 * попали бы прямо в смету. Поэтому они приходят от инженера.
 */

export interface QuantityRow {
  /** Наименование работы или материала. */
  name: string
  unit: string
  quantity: number
  /** Из чего получено: то, что проверяющий должен увидеть рядом с числом. */
  derivedFrom: string
}

export interface QuantityGap {
  name: string
  /** Чего не хватает, чтобы строку посчитать. */
  missing: string
}

export interface QuantityBill {
  rows: QuantityRow[]
  /** Строки, которые не считаются: каждая называет недостающую величину. */
  gaps: QuantityGap[]
  /** Общая длина трассы, м. */
  totalLengthM: number
}

export interface QuantityBillInput {
  profile: GravityProfile
  schedule: SewerSchedule
  /** Подобранные конструкции колодцев; без них колодцы идут одной строкой. */
  constructions?: SelectedManholeConstruction[]
  /**
   * Зазор от трубы до стенки траншеи с каждой стороны, м.
   *
   * Умолчания нет: норматива на ширину траншеи в реестре проекта не
   * подтверждено, а принятое «по практике» значение вошло бы в смету как
   * расчётное.
   */
  trenchAllowanceM?: number
  /** Заложение откоса m (горизонталь на единицу глубины); 0 — вертикальные стенки. */
  sideSlopeRatio?: number
  /** Толщина песчаного основания под трубой, м. */
  beddingThicknessM?: number
  /**
   * Перепады на трассе (`planDropWells`). Перепадный колодец — отдельная
   * позиция сметы, а слив в смотровом колодце конструкции не добавляет и в
   * объёмы не идёт: колодец уже посчитан в своей строке.
   */
  dropWells?: DropWell[]
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Площадь сечения трапецеидальной траншеи глубиной h, м². */
function trenchAreaM2(bottomWidthM: number, depthM: number, sideSlopeRatio: number): number {
  return (bottomWidthM + sideSlopeRatio * depthM) * depthM
}

export function buildQuantityBill(input: QuantityBillInput): QuantityBill {
  const rows: QuantityRow[] = []
  const gaps: QuantityGap[] = []
  const stations = input.profile.stations ?? []
  const totalLengthM = input.profile.totalLengthM ?? 0

  // 1. Трубы по диаметрам — выводятся полностью.
  // Строка «Укладка трубопровода Øundefined» — не позиция, а дыра, выданная за
  // позицию. Такие участки попадают в пробелы, где их видно.
  const lengthByDiameter = new Map<number, number>()
  let incompletePipes = 0
  for (const pipe of input.schedule.pipes ?? []) {
    if (!Number.isFinite(pipe.diameterMm) || !(pipe.diameterMm > 0) || !Number.isFinite(pipe.lengthM)) {
      incompletePipes += 1
      continue
    }
    lengthByDiameter.set(pipe.diameterMm, (lengthByDiameter.get(pipe.diameterMm) ?? 0) + pipe.lengthM)
  }
  if (incompletePipes > 0) {
    gaps.push({
      name: 'Укладка трубопровода без диаметра или длины',
      missing: `${incompletePipes} позиций ведомости труб без диаметра или длины: расчёт их не дал`,
    })
  }
  for (const [diameterMm, lengthM] of [...lengthByDiameter].sort((a, b) => a[0] - b[0])) {
    rows.push({
      name: `Укладка трубопровода Ø${diameterMm} мм`,
      unit: 'м',
      quantity: round2(lengthM),
      derivedFrom: 'ведомость труб проекта',
    })
  }

  // 2. Колодцы по типам конструкций; без каталога — одной строкой.
  const manholes = input.schedule.manholes ?? []
  const byType = new Map<string, number>()
  for (const construction of input.constructions ?? []) {
    byType.set(construction.typeCode, (byType.get(construction.typeCode) ?? 0) + 1)
  }
  if (byType.size > 0) {
    for (const [typeCode, count] of [...byType].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push({
        name: `Устройство колодца типа ${typeCode}`,
        unit: 'шт',
        quantity: count,
        derivedFrom: 'подобранные конструкции колодцев',
      })
    }
    const unmatched = manholes.length - [...byType.values()].reduce((sum, count) => sum + count, 0)
    if (unmatched > 0) {
      gaps.push({
        name: 'Устройство колодцев без подобранной конструкции',
        missing: `конструкция не подобрана для ${unmatched} колодцев: каталог не покрывает их глубину или диаметр`,
      })
    }
  } else if (manholes.length > 0) {
    gaps.push({
      name: 'Устройство колодцев по типам',
      missing: 'каталог конструкций не подобран; тип колодца в смете обязателен',
    })
    rows.push({
      name: 'Устройство колодцев (тип не определён)',
      unit: 'шт',
      quantity: manholes.length,
      derivedFrom: 'ведомость колодцев проекта',
    })
  }

  // 2а. Перепады. Считаются только те, что требуют отдельной конструкции.
  const dropWells = input.dropWells ?? []
  const structures = dropWells.filter((well) => well.kind.value === 'перепадный колодец')
  if (structures.length > 0) {
    rows.push({
      name: 'Устройство перепадного колодца',
      unit: 'шт',
      quantity: structures.length,
      derivedFrom: `перепады профиля свыше допустимых сливом (п. 7.5.1): пикеты `
        + `${structures.map((well) => well.chainageM.toFixed(0)).join(', ')} м`,
    })
    rows.push({
      name: 'Суммарная высота перепадов в перепадных колодцах',
      unit: 'м',
      quantity: round2(structures.reduce((sum, well) => sum + well.dropM, 0)),
      derivedFrom: 'высота ступени лотка сверх падения по уклону участка',
    })
  }

  // 3. Земляные работы. Зависят от величин, которых норматив проекта не даёт.
  const allowance = input.trenchAllowanceM
  const slope = input.sideSlopeRatio
  const missingEarthwork: string[] = []
  if (allowance == null || !(allowance > 0)) missingEarthwork.push('зазор от трубы до стенки траншеи')
  if (slope == null || !(slope >= 0)) missingEarthwork.push('заложение откоса')
  if (stations.length < 2) missingEarthwork.push('профиль без участков')

  if (missingEarthwork.length > 0) {
    gaps.push({
      name: 'Разработка грунта в траншее',
      missing: `${missingEarthwork.join(', ')}; норматива на ширину траншеи в реестре проекта нет,`
        + ' поэтому величина задаётся инженером и по умолчанию не принимается',
    })
    gaps.push({ name: 'Обратная засыпка траншеи', missing: 'следует за объёмом разработки грунта' })
  } else {
    let excavationM3 = 0
    let pipeVolumeM3 = 0
    for (let index = 0; index + 1 < stations.length; index++) {
      const from = stations[index]
      const to = stations[index + 1]
      const lengthM = to.chainageM - from.chainageM
      if (!(lengthM > 0)) continue
      const diameterM = ((from.diameterMm ?? 0) || (to.diameterMm ?? 0)) / 1000
      const bottomWidthM = diameterM + 2 * (allowance as number)
      // Объём по средней площади сечения на концах участка — тот же приём, что
      // и в ведомостях земляных работ: глубина между узлами меняется линейно.
      const areaFrom = trenchAreaM2(bottomWidthM, from.depthM, slope as number)
      const areaTo = trenchAreaM2(bottomWidthM, to.depthM, slope as number)
      excavationM3 += ((areaFrom + areaTo) / 2) * lengthM
      pipeVolumeM3 += (Math.PI * diameterM ** 2 / 4) * lengthM
    }
    rows.push({
      name: 'Разработка грунта в траншее',
      unit: 'м³',
      quantity: round2(excavationM3),
      derivedFrom: `профиль: ${stations.length} узлов, зазор ${allowance} м, заложение откоса ${slope}`,
    })
    rows.push({
      name: 'Обратная засыпка траншеи',
      unit: 'м³',
      // Колодцы из засыпки не вычитаются: их объём считается по конструкциям
      // каталога, а он даёт диаметр камеры, но не полную геометрию котлована.
      quantity: round2(Math.max(0, excavationM3 - pipeVolumeM3)),
      derivedFrom: 'разработка грунта за вычетом объёма трубы; котлованы колодцев не вычтены',
    })
  }

  // 4. Песчаное основание.
  const bedding = input.beddingThicknessM
  if (bedding == null || !(bedding > 0)) {
    gaps.push({
      name: 'Устройство песчаного основания',
      missing: 'толщина основания; определяется грунтом по трассе, а не нормативом на всю трассу',
    })
  } else if (allowance != null && allowance > 0 && stations.length >= 2) {
    let beddingM3 = 0
    for (let index = 0; index + 1 < stations.length; index++) {
      const from = stations[index]
      const to = stations[index + 1]
      const lengthM = to.chainageM - from.chainageM
      if (!(lengthM > 0)) continue
      const diameterM = ((from.diameterMm ?? 0) || (to.diameterMm ?? 0)) / 1000
      beddingM3 += (diameterM + 2 * allowance) * bedding * lengthM
    }
    rows.push({
      name: 'Устройство песчаного основания',
      unit: 'м³',
      quantity: round2(beddingM3),
      derivedFrom: `толщина ${bedding} м по ширине траншеи`,
    })
  } else {
    gaps.push({
      name: 'Устройство песчаного основания',
      missing: 'зазор от трубы до стенки траншеи: без него ширина основания неизвестна',
    })
  }

  return { rows, gaps, totalLengthM: round2(totalLengthM) }
}
