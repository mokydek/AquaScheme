/**
 * Чтение проектных величин из текста технических документов.
 *
 * Диаметр, длину и число колодцев инженер до сих пор вводил руками, хотя они
 * написаны в техническом обследовании и в технических условиях прямым текстом.
 * Это не расчёт и не догадка — это чтение документа, и перекладывать его на
 * человека было нечем оправдать.
 *
 * Возвращается не только величина, но и фрагмент, из которого она взята: без
 * него инженер не может проверить, что программа прочитала именно ту строку.
 * Ни одна величина не выводится «по умолчанию»: нет совпадения — нет значения.
 *
 * Осторожно с кириллицей: `\w` в JavaScript покрывает только латиницу, поэтому
 * «протяженностью» шаблоном `протяж[её]нность\w*` не ловится. Здесь везде явные
 * кириллические классы.
 */

export interface ExtractedValue<T> {
  value: T
  /** Фрагмент документа, из которого величина взята. */
  quote: string
}

export interface ConditionsFromText {
  /** Диаметр трубы, мм. */
  diameterMm: ExtractedValue<number> | null
  /** Протяжённость сети, м. */
  lengthM: ExtractedValue<number> | null
  /** Число колодцев, шт. */
  chambers: ExtractedValue<number> | null
  /** Диаметр колодца, мм: подтверждает выведенный по норме размер камеры. */
  chamberDiameterMm: ExtractedValue<number> | null
  /** Материал трубы, как записан в документе. */
  material: ExtractedValue<string> | null
  /** Что найти не удалось: показывается инженеру, а не проглатывается. */
  missing: string[]
  /** Неоднозначности: несколько разных значений одной величины. */
  ambiguous: string[]
}

const CYR = '[а-яёА-ЯЁ]'

/**
 * Диаметр трубы. Единица обязательна: колодец в том же документе записан как
 * «колодцы Ø1,5м», и шаблон без «мм» вернул бы 1,5 как диаметр трубы.
 */
const DIAMETER = new RegExp(`труб${CYR}*\\s+[ØøΦ⌀Ф]\\s*(\\d{2,4})\\s*мм`, 'gi')

/**
 * Протяжённость. Между словом и числом бывает «составляет», поэтому допускается
 * несколько слов; «метр» в конце обязателен, иначе шаблон поймает любое число.
 */
const LENGTH = new RegExp(
  `протяж${CYR}*(?:\\s+${CYR}+){0,4}\\s+(\\d{1,5}(?:[.,]\\d{1,2})?)\\s*метр`, 'gi')

/** Колодцы: «колодцы Ø1,5м – 14 шт». Тире бывает коротким и длинным. */
const CHAMBERS = /колодц[а-яё]*\s+[Øø]\s*[\d.,]+\s*м\s*[-–—]\s*(\d{1,3})\s*шт/gi

/**
 * Диаметр колодца из той же строки, отдельным шаблоном ради своей группы.
 *
 * Величина нужна не сама по себе: труба лежит между стенками камер, и длина
 * трубы короче длины оси ровно на диаметр колодца. Программа выводит его из
 * п. 7.4.2 по глубине, а документ даёт независимое подтверждение.
 */
const CHAMBER_DIAMETER = /колодц[а-яё]*\s+[Øø]\s*([\d.,]+)\s*м\s*[-–—]\s*\d{1,3}\s*шт/gi

/** Материал: «Материал канализационной сети – керамическая труба». */
const MATERIAL = new RegExp(
  `материал${CYR}*(?:\\s+${CYR}+){0,4}\\s*[-–—]\\s*(${CYR}+)\\s+труба`, 'gi')

const numeric = (raw: string): number => Number(raw.replace(',', '.'))

/**
 * Собирает совпадения одного шаблона. Разные значения одной величины — не повод
 * выбрать первое: документ противоречив, и решать это инженеру.
 */
function collect<T>(
  text: string,
  pattern: RegExp,
  parse: (raw: string) => T,
): { hit: ExtractedValue<T> | null; conflicting: T[] } {
  const found: Array<ExtractedValue<T>> = []
  for (const match of text.matchAll(pattern)) {
    if (match[1] === undefined) continue
    found.push({ value: parse(match[1]), quote: match[0].replace(/\s+/g, ' ').trim() })
  }
  if (found.length === 0) return { hit: null, conflicting: [] }
  const distinct = [...new Set(found.map((item) => JSON.stringify(item.value)))]
  return {
    hit: found[0],
    conflicting: distinct.length > 1 ? found.map((item) => item.value) : [],
  }
}

export function extractConditionsFromText(text: string): ConditionsFromText {
  const source = String(text ?? '')
  const diameter = collect(source, DIAMETER, numeric)
  const length = collect(source, LENGTH, numeric)
  const chambers = collect(source, CHAMBERS, (raw) => Math.trunc(Number(raw)))
  const chamberDiameter = collect(source, CHAMBER_DIAMETER, (raw) => Math.round(numeric(raw) * 1000))
  const material = collect(source, MATERIAL, (raw) => raw.toLowerCase())

  const missing: string[] = []
  if (!diameter.hit) missing.push('диаметр трубы')
  if (!length.hit) missing.push('протяжённость сети')
  if (!chambers.hit) missing.push('число колодцев')
  if (!material.hit) missing.push('материал трубы')

  const ambiguous: string[] = []
  if (diameter.conflicting.length > 0) ambiguous.push(`диаметр: ${diameter.conflicting.join(', ')} мм`)
  if (length.conflicting.length > 0) ambiguous.push(`протяжённость: ${length.conflicting.join(', ')} м`)
  if (chambers.conflicting.length > 0) ambiguous.push(`колодцев: ${chambers.conflicting.join(', ')}`)
  if (material.conflicting.length > 0) ambiguous.push(`материал: ${material.conflicting.join(', ')}`)

  return {
    diameterMm: diameter.hit,
    lengthM: length.hit,
    chambers: chambers.hit,
    chamberDiameterMm: chamberDiameter.hit,
    material: material.hit,
    missing,
    ambiguous,
  }
}
