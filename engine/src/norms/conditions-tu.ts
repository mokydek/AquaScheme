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
