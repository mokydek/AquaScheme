import standbyTable from './data/table-8-2-standby-pumps.json'
import { justified, type Justified } from '../normregistry'

/**
 * Подбор насосного оборудования ЛНС.
 *
 * СН РК 4.01-03-2013* п. 8.2.1: «Насосы, оборудование и трубопроводы следует
 * выбирать в зависимости от расчетного притока и физико-химических свойств
 * сточных вод или осадков, высоты подъема». Требуемый напор уже считает
 * `solvePressureMain`; здесь по расходу и напору подбирается рабочий агрегат
 * и по Таблице 8.2 определяется число резервных.
 *
 * Каталог насосов не встроен: марка и характеристики приходят от проекта, как
 * и каталог колодцев. Подбор без каталога возвращает требование, а не
 * выдуманный агрегат.
 */

export type ReliabilityCategory = 'first' | 'second' | 'third'
export type EffluentKind = 'domestic' | 'aggressive' | 'storm'

export interface PumpCatalogueItem {
  /** Марка, как её пишут в спецификацию. */
  designation: string
  /** Подача в рабочей точке, л/с. */
  flowLps: number
  /** Напор в рабочей точке, м. */
  headM: number
  /** Мощность двигателя, кВт — для графы «установленная мощность». */
  powerKw?: number
  /** Погружной агрегат: у него своё правило резерва (примечание 3). */
  submersible?: boolean
  source?: string
}

export interface PumpSelectionInput {
  /** Расчётный приток, л/с. */
  designFlowLps: number
  /** Требуемый напор, м — из solvePressureMain. */
  requiredHeadM: number
  category: ReliabilityCategory
  effluent: EffluentKind
  catalogue: PumpCatalogueItem[]
  /** Число рабочих агрегатов; по умолчанию один на весь расход. */
  workingCount?: number
  /**
   * Для ливневой станции резерв не нужен, «за исключением случаев, когда
   * аварийный сброс дождевых вод в водные объекты невозможен» (примечание 1).
   */
  stormOverflowImpossible?: boolean
}

export interface PumpSelection {
  ok: boolean
  pump: PumpCatalogueItem | null
  workingCount: number
  standbyCount: number
  /** Агрегаты, которые норма требует хранить на складе, а не устанавливать. */
  spareOnStoreCount: number
  totalInstalled: number
  /** Подача одного агрегата, л/с. */
  perPumpFlowLps: number
  blockers: string[]
  notes: string[]
}

interface DomesticRow {
  workingMin: number
  workingMax: number | null
  firstCategory: number
  secondCategory: number
  thirdCategory: number
  thirdCategorySpare?: number
}

interface AggressiveRow {
  workingMin: number
  workingMax: number | null
  standby?: number
  spare?: number
  standbyFraction?: number
}

const inRange = (value: number, min: number, max: number | null) =>
  value >= min && (max === null || value <= max)

/**
 * Число резервных насосов по Таблице 8.2. Возвращает и устанавливаемый резерв,
 * и агрегаты, которые норма разрешает держать на складе — это разные позиции
 * спецификации.
 */
export function standbyPumpCount(
  workingCount: number,
  category: ReliabilityCategory,
  effluent: EffluentKind,
  options: { submersible?: boolean; stormOverflowImpossible?: boolean } = {},
): Justified<{ standby: number; spareOnStore: number }> {
  const refs = ['sewer.pumps.standby']

  if (effluent === 'storm') {
    // Примечание 1.
    if (!options.stormOverflowImpossible) {
      return justified({ standby: 0, spareOnStore: 0 }, refs, 'normative',
        'дождевая станция: резервные насосы, как правило, не требуются (примечание 1 к таблице 8.2)')
    }
    // Аварийный сброс невозможен — станция работает как обычная.
    effluent = 'domestic'
  }

  if (effluent === 'aggressive') {
    const row = (standbyTable.aggressive as AggressiveRow[])
      .find((candidate) => inRange(workingCount, candidate.workingMin, candidate.workingMax))
    if (!row) return justified({ standby: 0, spareOnStore: 0 }, refs, 'normative', 'строка таблицы не найдена')
    const standby = row.standbyFraction !== undefined
      ? Math.ceil(workingCount * row.standbyFraction)
      : row.standby ?? 0
    return justified({ standby, spareOnStore: row.spare ?? 0 }, refs, 'normative',
      'агрессивные сточные воды, таблица 8.2')
  }

  // Примечание 3: погружные агрегаты первой и второй категории.
  if (options.submersible && category === 'first') {
    return justified({ standby: 1, spareOnStore: 1 }, refs, 'normative',
      'погружные насосы первой категории, примечание 3 к таблице 8.2')
  }
  if (options.submersible && category === 'second') {
    return justified({ standby: 1, spareOnStore: 0 }, refs, 'normative',
      'погружные насосы второй категории, примечание 3 к таблице 8.2')
  }

  const row = (standbyTable.domestic as DomesticRow[])
    .find((candidate) => inRange(workingCount, candidate.workingMin, candidate.workingMax))
  if (!row) return justified({ standby: 0, spareOnStore: 0 }, refs, 'normative', 'строка таблицы не найдена')
  const standby = category === 'first' ? row.firstCategory
    : category === 'second' ? row.secondCategory
      : row.thirdCategory
  const spareOnStore = category === 'third' ? row.thirdCategorySpare ?? 0 : 0
  return justified({ standby, spareOnStore }, refs, 'normative', 'бытовые сточные воды, таблица 8.2')
}

/**
 * Подбирает агрегат из каталога проекта: подача не ниже доли расчётного
 * притока на один насос, напор не ниже требуемого. Из подходящих берётся
 * ближайший по напору — запас нужен, но избыточный напор гасится дросселем и
 * тратит энергию.
 */
export function selectPumps(input: PumpSelectionInput): PumpSelection {
  const blockers: string[] = []
  const notes: string[] = []
  const workingCount = Math.max(1, Math.floor(input.workingCount ?? 1))
  const perPumpFlowLps = input.designFlowLps / workingCount

  if (!(input.designFlowLps > 0)) blockers.push('Не задан расчётный приток ЛНС.')
  if (!(input.requiredHeadM > 0)) blockers.push('Не задан требуемый напор: сначала выполните расчёт напорного участка.')
  if (input.catalogue.length === 0) {
    blockers.push('Каталог насосов не загружен: марка агрегата не подбирается по умолчанию, её задаёт проект.')
  }

  const suitable = input.catalogue.filter((item) =>
    item.flowLps >= perPumpFlowLps - 1e-9 && item.headM >= input.requiredHeadM - 1e-9)
  const pump = suitable.length === 0 ? null : suitable.reduce((best, item) => {
    const bestGap = best.headM - input.requiredHeadM
    const gap = item.headM - input.requiredHeadM
    return gap < bestGap ? item : best
  })

  if (blockers.length === 0 && pump === null) {
    blockers.push(
      `В каталоге нет агрегата на ${perPumpFlowLps.toFixed(1)} л/с при напоре ${input.requiredHeadM.toFixed(1)} м; `
      + 'требуется другое число рабочих насосов или расширение каталога.',
    )
  }

  const standby = standbyPumpCount(workingCount, input.category, input.effluent, {
    submersible: pump?.submersible,
    stormOverflowImpossible: input.stormOverflowImpossible,
  })
  if (standby.note) notes.push(`Резерв: ${standby.note}.`)
  if (standby.value.spareOnStore > 0) {
    notes.push(`На складе хранится агрегатов: ${standby.value.spareOnStore} — они не монтируются.`)
  }

  return {
    ok: blockers.length === 0,
    pump,
    workingCount,
    standbyCount: standby.value.standby,
    spareOnStoreCount: standby.value.spareOnStore,
    totalInstalled: workingCount + standby.value.standby,
    perPumpFlowLps: Number(perPumpFlowLps.toFixed(2)),
    blockers,
    notes,
  }
}
