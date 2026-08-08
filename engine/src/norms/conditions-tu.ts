/**
 * Величины из документа технических условий.
 *
 * ТУ загружается в проект как файл основания и лежит мёртвым грузом: никто его
 * не разбирает, а инженер перепечатывает из него цифры руками. Между тем
 * проектный диаметр и требуемый просвет написаны там прямым текстом.
 *
 * ЧТО ЗДЕСЬ НЕ ДЕЛАЕТСЯ. Найденное не выбирается и не подставляется: возвращаются
 * ВСЕ кандидаты с цитатой строки и номером страницы, а решает инженер. Документ
 * бывает противоречив — в одном пункте Ø450, в другом перечень допустимых, — и
 * молчаливый выбор первого попавшегося был бы догадкой в контрактной величине.
 *
 * ОТКУДА НЕЛЬЗЯ. Проектный диаметр извлекается только отсюда, из документа
 * условий. Из съёмки его выводить запрещено: там он относится к существующей
 * трубе, а проектируется по ТУ, и на объекте по ул. Станкевича эти величины
 * прямо расходятся — подписи дают Ø300 при Ø450 в документе.
 *
 * Осторожно с кириллицей: `\w` в JavaScript покрывает только латиницу.
 */

export interface TuCandidate<T = number> {
  value: T
  /** Строка документа, из которой прочитано. */
  quote: string
  /** Страница PDF, с 1. */
  page: number
}

export interface TuPage {
  page: number
  text: string
}

export interface ConditionsFromTu {
  /** Все найденные проектные диаметры, мм. */
  designDiameterMm: TuCandidate[]
  /** Ряды допустимых диаметров, если ТУ задают перечнем. */
  allowedDiametersMm: Array<TuCandidate<number[]>>
  /** Требуемые вертикальные просветы в пересечениях, м. */
  requiredClearanceM: TuCandidate[]
  /** Чего не нашлось — показывается инженеру, а не проглатывается. */
  missing: string[]
}

/** Диаметр: «Д=450 мм», «DN400», «диаметром 400 мм», «⌀500», «Ø 500 мм». */
const DIAMETER_PATTERNS = [
  /[ДдDd]\s*[=:]\s*(\d{2,4})\s*мм/g,
  /\bDN\s*(\d{2,4})\b/gi,
  /диаметр[а-яё]*\s+(?:не\s+менее\s+)?(\d{2,4})\s*мм/gi,
  /[Ø⌀øФф]\s*(\d{2,4})(?:\s*мм)?/g,
]

/**
 * Перечень допустимых диаметров: «диаметры 300, 400, 500 мм».
 *
 * Требуется не менее двух чисел: одно — это не перечень, а тот же одиночный
 * диаметр, и записывать его рядом было бы удвоением одной находки.
 */
const ALLOWED_LIST = /диаметр[а-яё]*\s*(?:ряд[а-яё]*\s*)?[:\s]\s*((?:\d{2,4}\s*[,;]\s*){1,}\d{2,4})\s*мм/gi

/**
 * Просвет: число рядом со словами о пересечении или сближении.
 *
 * Без такой привязки шаблон ловил бы любое «не менее 0,2 м» в документе —
 * например, заглубление или расстояние до фундамента, — и подставил бы чужую
 * величину в отбор пересечений.
 */
const CLEARANCE = /(?:пересеч[а-яё]*|сближен[а-яё]*|в\s+свету)[^.]{0,160}?(?:не\s+менее\s+)?(\d+(?:[.,]\d{1,2})?)\s*(?:метр[а-яё]*|м)(?![а-яёА-ЯЁ])/gi

const numeric = (raw: string): number => Number(raw.replace(',', '.'))

/** Строка вокруг совпадения — чтобы инженер видел, что именно прочитано. */
function lineAround(text: string, index: number): string {
  const from = text.lastIndexOf('\n', index) + 1
  const to = text.indexOf('\n', index)
  return text.slice(from, to < 0 ? text.length : to).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Разбирает страницы документа ТУ. Ничего не выбирает — собирает кандидатов. */
export function extractConditionsFromTu(pages: TuPage[]): ConditionsFromTu {
  const designDiameterMm: TuCandidate[] = []
  const allowedDiametersMm: Array<TuCandidate<number[]>> = []
  const requiredClearanceM: TuCandidate[] = []

  for (const { page, text } of pages) {
    for (const pattern of DIAMETER_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern)) {
        const value = Number(match[1])
        // Диаметры наружных сетей: 50…3000 мм. Число вне этого ряда — не
        // диаметр, а год, номер пункта или отметка.
        if (!Number.isFinite(value) || value < 50 || value > 3000) continue
        const quote = lineAround(text, match.index ?? 0)
        // Одна и та же строка может подойти двум шаблонам («Ø450 мм» ловится
        // и как Ø, и как «диаметром»): повтор не добавляется.
        if (designDiameterMm.some((item) => item.value === value && item.quote === quote)) continue
        designDiameterMm.push({ value, quote, page })
      }
    }

    ALLOWED_LIST.lastIndex = 0
    for (const match of text.matchAll(ALLOWED_LIST)) {
      const values = match[1].split(/[,;]/).map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value) && value >= 50 && value <= 3000)
      if (values.length < 2) continue
      allowedDiametersMm.push({ value: values, quote: lineAround(text, match.index ?? 0), page })
    }

    CLEARANCE.lastIndex = 0
    for (const match of text.matchAll(CLEARANCE)) {
      const value = numeric(match[1])
      // Просвет между сетями — доли метра, редко больше двух. Число крупнее —
      // это расстояние в плане или длина, а не просвет по вертикали.
      if (!Number.isFinite(value) || value <= 0 || value > 2) continue
      const quote = lineAround(text, match.index ?? 0)
      if (requiredClearanceM.some((item) => item.value === value && item.quote === quote)) continue
      requiredClearanceM.push({ value, quote, page })
    }
  }

  const missing: string[] = []
  if (designDiameterMm.length === 0) missing.push('проектный диаметр')
  if (requiredClearanceM.length === 0) missing.push('требуемый просвет в пересечении')

  return { designDiameterMm, allowedDiametersMm, requiredClearanceM, missing }
}

/**
 * Категория надёжности и характер стоков — из задания на проектирование.
 *
 * По итогам прошлого захода эти две величины остались единственными ручными
 * входами подбора насосов. Они не выводятся ни из чертежа, ни из расчёта — их
 * называет задание, и там они написаны словами.
 *
 * Термины берутся из СН РК 4.01-03-2013*: категории надёжности действия I, II
 * и III; характер стоков — бытовые, производственные, дождевые. Ни одного
 * термина сверх названных в норме здесь не изобретено.
 */

export type ReliabilityCategoryValue = 'first' | 'second' | 'third'
export type EffluentValue = 'domestic' | 'aggressive' | 'storm'

export interface ConditionsFromBrief {
  category: Array<TuCandidate<ReliabilityCategoryValue>>
  effluent: Array<TuCandidate<EffluentValue>>
  missing: string[]
}

/**
 * Категория: «I категории надёжности», «категория надёжности действия II»,
 * «третья категория надёжности», «категория надёжности — 1».
 *
 * Слово «надёжност» обязательно рядом: без него шаблон ловил бы «категория
 * грунта II» и «II категория сложности изысканий», а это другие величины.
 */
/**
 * Число стоит то перед словом «категория», то после: «I категории
 * надёжности» и «категория надёжности — II». Поэтому два шаблона, а не один
 * с необязательными частями: один шаблон на оба порядка ловил бы заодно
 * посторонние числа из соседнего предложения.
 */
const CATEGORY_BEFORE = /(I{1,3}|1|2|3|перв[а-яё]+|втор[а-яё]+|трет[а-яё]+)\s+категор[а-яё]*\s+надёжност[а-яё]*/gi
const CATEGORY_AFTER = /категор[а-яё]*\s+надёжност[а-яё]*(?:\s+действи[а-яё]*)?\s*[-–—:]?\s*(I{1,3}|1|2|3|перв[а-яё]+|втор[а-яё]+|трет[а-яё]+)(?![IА-Яа-яё\d])/gi

const CATEGORY_VALUES: Record<string, ReliabilityCategoryValue> = {
  i: 'first', '1': 'first', перв: 'first',
  ii: 'second', '2': 'second', втор: 'second',
  iii: 'third', '3': 'third', трет: 'third',
}

/** Характер стоков: бытовые, производственные, дождевые. */
const EFFLUENT_PATTERNS: Array<[RegExp, EffluentValue]> = [
  [/(?:бытов[а-яё]*|хозяйственно-бытов[а-яё]*)\s+(?:сточн[а-яё]*\s+вод[а-яё]*|сток[а-яё]*)/gi, 'domestic'],
  [/(?:производствен[а-яё]*|промышленн[а-яё]*)\s+(?:сточн[а-яё]*\s+вод[а-яё]*|сток[а-яё]*)/gi, 'aggressive'],
  [/(?:дождев[а-яё]*|ливнев[а-яё]*|поверхностн[а-яё]*)\s+(?:сточн[а-яё]*\s+вод[а-яё]*|сток[а-яё]*)/gi, 'storm'],
]

/** Разбирает задание на проектирование. Ничего не выбирает — собирает кандидатов. */
export function extractConditionsFromBrief(pages: TuPage[]): ConditionsFromBrief {
  const category: Array<TuCandidate<ReliabilityCategoryValue>> = []
  const effluent: Array<TuCandidate<EffluentValue>> = []

  for (const { page, text } of pages) {
    for (const pattern of [CATEGORY_BEFORE, CATEGORY_AFTER]) {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern)) {
      const raw = match[1].toLowerCase()
      const value = CATEGORY_VALUES[raw] ?? CATEGORY_VALUES[raw.slice(0, 4)] ?? CATEGORY_VALUES[raw.slice(0, 3)]
      if (!value) continue
      const quote = lineAround(text, match.index ?? 0)
      if (category.some((item) => item.value === value && item.quote === quote)) continue
      category.push({ value, quote, page })
      }
    }

    for (const [pattern, value] of EFFLUENT_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern)) {
        const quote = lineAround(text, match.index ?? 0)
        if (effluent.some((item) => item.value === value && item.quote === quote)) continue
        effluent.push({ value, quote, page })
      }
    }
  }

  const missing: string[] = []
  if (category.length === 0) missing.push('категория надёжности насосной станции')
  if (effluent.length === 0) missing.push('характер перекачиваемых стоков')
  return { category, effluent, missing }
}

/**
 * Строки с числами, которые шаблоны НЕ разобрали.
 *
 * Измеренный факт: «Д=450 мм» с синтетического скана распознаётся как
 * «0=450 00». Буква «Д» потеряна, шаблон «Д=» не срабатывает — и верно
 * прочитанное число 450 до инженера не доходит ВОВСЕ. Молча потерянная
 * находка это та же тихая потеря данных, только на новом уровне.
 *
 * Поэтому такие строки собираются отдельным списком. Программа при этом НИЧЕГО
 * НЕ УТВЕРЖДАЕТ: список — предложение посмотреть, а не кандидат. Назначить
 * строку диаметром или просветом может только инженер, и это его решение, а не
 * догадка распознавателя.
 *
 * Только для распознанного текста. Цифровой документ разбирается шаблонами, и
 * подсовывать инженеру там «строки с числами» значило бы звать его проверять
 * то, что и так прочитано.
 */

export interface UnparsedNumericLine {
  quote: string
  page: number
  /** Числа строки, попадающие в диаметровый ряд. */
  numbers: number[]
  /** След якоря, из-за которого строка попала в список. */
  trace: string
}

/**
 * Следы искажённых якорей.
 *
 * «Д=» распознаётся как «0=», «О=», «Ц=» — важна не буква, а одиночный символ
 * перед знаком равенства. «мм» становится «00», «MM», «мн»: важно, что после
 * числа стоит короткая группа из тех же начертаний.
 */
const ANCHOR_BEFORE = /(\S)\s*=\s*\d/
const ANCHOR_AFTER = /\d\s*(00|0[О0]|[МM][МM]|мм|мн|нн)(?![а-яё\d])/i

export function unparsedNumericLines(
  pages: TuPage[],
  found: ConditionsFromTu,
): UnparsedNumericLine[] {
  const claimed = new Set([
    ...found.designDiameterMm.map((item) => `${item.page}|${item.quote}`),
    ...found.allowedDiametersMm.map((item) => `${item.page}|${item.quote}`),
    ...found.requiredClearanceM.map((item) => `${item.page}|${item.quote}`),
  ])

  const out: UnparsedNumericLine[] = []
  for (const { page, text } of pages) {
    for (const raw of text.split(/\r?\n/)) {
      const quote = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
      if (quote === '') continue
      // Строку, из которой величина уже прочитана, показывать незачем.
      if (claimed.has(`${page}|${quote}`)) continue

      const numbers = [...quote.matchAll(/\d{2,4}/g)]
        .map((match) => Number(match[0]))
        .filter((value) => value >= 50 && value <= 3000)
      if (numbers.length === 0) continue

      const before = ANCHOR_BEFORE.exec(quote)
      const after = ANCHOR_AFTER.exec(quote)
      if (!before && !after) continue

      out.push({
        quote,
        page,
        numbers: [...new Set(numbers)],
        trace: [
          before ? `«${before[1]}=» перед числом` : null,
          after ? `«${after[1]}» после числа` : null,
        ].filter(Boolean).join('; '),
      })
    }
  }
  return out
}
