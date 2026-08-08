import { saveDataset } from './datasets'
import type { DatasetRow } from './datasets'

/**
 * Контрактные величины проекта — одно место на весь проект.
 *
 * Проектный диаметр спрашивался дважды: своим полем в секции реконструкции и
 * своим в прогоне комплекта. Два поля для одной величины расходятся молча —
 * инженер правит одно, второе остаётся прежним, и два расчёта одного объекта
 * дают разное. Здесь запись одна, и правка в любой секции правит её же.
 *
 * Хранится не только число, но и ОТКУДА оно: величина из документа ТУ,
 * измеренная по чертежу и введённая руками — разные основания, и в аудите
 * происхождения они не должны сливаться.
 */

export type ValueOrigin =
  /** Из документа: ТУ, задание, технический отчёт. */
  | 'stated'
  /** Измерено по чертежу. */
  | 'measured'
  /** Введено инженером руками — запасной путь. */
  | 'manual'
  /**
   * Распознано со скана.
   *
   * Худший источник из всех: OCR путает 0 и О, 4 и Ч. Отдельный разряд, а не
   * `stated`, именно поэтому — в аудите происхождения скан обязан быть
   * отличим от цифрового документа.
   */
  | 'ocr'

export interface ConfirmedValue<T = number> {
  value: T
  origin: ValueOrigin
  /** Файл, слой или иное место, откуда величина взята. */
  source: string
  /** Страница документа, если из PDF. */
  page?: number
  /** Строка документа, из которой прочитано, — для проверки прочтения. */
  quote?: string
}

export interface TechnicalConditions {
  /** Проектный диаметр, мм. Только из ТУ или вручную: из съёмки его выводить нельзя. */
  designDiameterMm?: ConfirmedValue
  /** Ряд допустимых диаметров, если ТУ задают его перечнем. */
  allowedDiametersMm?: ConfirmedValue<number[]>
  /** Требуемый вертикальный просвет в пересечении, м. */
  requiredClearanceM?: ConfirmedValue
  /** Ширина проезжей части, м: измеряется по съёмке либо вводится. */
  roadWidthM?: ConfirmedValue
  /**
   * Категория надёжности насосной станции и характер стоков — из задания.
   *
   * Не выводятся ни из чертежа, ни из расчёта: их называет задание словами, и
   * до этого захода они оставались единственными ручными входами подбора
   * насосов.
   */
  reliabilityCategory?: ConfirmedValue<'first' | 'second' | 'third'>
  effluentKind?: ConfirmedValue<'domestic' | 'aggressive' | 'storm'>
}

export const TECHNICAL_CONDITIONS_KIND = 'technical_conditions' as const

export function readTechnicalConditions(dataset: DatasetRow | undefined): TechnicalConditions {
  const content = (dataset?.content ?? {}) as TechnicalConditions
  return content ?? {}
}

/**
 * Записывает одну величину, не трогая остальные.
 *
 * Набор перезаписывается целиком, поэтому простое сохранение стёрло бы
 * соседние величины — той же ошибкой уже поплатился набор `drainage`.
 */
export async function saveTechnicalCondition<K extends keyof TechnicalConditions>(
  projectId: string,
  dataset: DatasetRow | undefined,
  key: K,
  value: TechnicalConditions[K] | null,
): Promise<void> {
  const existing = readTechnicalConditions(dataset)
  const next: TechnicalConditions = { ...existing }
  if (value === null) delete next[key]
  else next[key] = value
  await saveDataset(projectId, TECHNICAL_CONDITIONS_KIND, next, dataset?.meta ?? null, dataset?.file_name ?? null)
}

/** Величина для расчёта: `null`, если не подтверждена. */
export const valueOf = (item: ConfirmedValue | undefined): number | null =>
  item && Number.isFinite(item.value) && item.value > 0 ? item.value : null

/** Подпись происхождения для экрана. */
export const originKey = (origin: ValueOrigin): string => `project.conditions.origin.${origin}`
