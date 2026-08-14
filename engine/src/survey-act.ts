/**
 * Разбор акта технического обследования существующей сети (АТО).
 *
 * Акт — это не геология и не ТУ: он оценивает НЕСУЩУЮ СПОСОБНОСТЬ конструкций
 * по СП РК 1.04-101-2012 и даёт то, чего нет больше нигде, — материал и диаметр
 * уложенной трубы, её протяжённость, глубину заложения и категорию состояния.
 *
 * Всё найденное — КАНДИДАТЫ с цитатой. Извлечение не подтверждает: величина
 * попадает в проект только после подтверждения инженером, как и в разборе ТУ.
 *
 * Шероховатости в акте нет и не предполагается — документ о конструкциях, а не
 * о гидравлике. Выводить её из износа молча здесь нечем и не нужно: материал
 * известен, а величину принимает инженер по нормативу.
 */

export interface SurveyActValue<T> {
  value: T
  /** Цитата документа, по которой величина прочитана. */
  quote: string
  /** Страница, если разбор шёл постранично. */
  page?: number
}

export interface SurveyActFacts {
  /** Диаметр существующей трубы, мм. */
  diameterMm: Array<SurveyActValue<number>>
  /** Материал существующей трубы, как назван в акте. */
  material: Array<SurveyActValue<string>>
  /** Протяжённость сети, м. */
  lengthM: Array<SurveyActValue<number>>
  /** Глубина заложения, м: наименьшая и наибольшая. */
  depthRangeM: Array<SurveyActValue<{ fromM: number; toM: number }>>
  /** Категория технического состояния по СП РК 1.04-101-2012. */
  category: Array<SurveyActValue<string>>
  /** Прямые указания акта о судьбе конструкций. */
  verdicts: Array<SurveyActValue<string>>
  /** Чего в акте не нашлось — чтобы отсутствие было названо, а не подразумевалось. */
  missing: string[]
}

export interface SurveyActPage {
  page: number
  text: string
}

/**
 * Склейка цифр, разорванных кернингом.
 *
 * В текстовом слое настоящего акта диаметр записан как «Ø 45 0 мм»: извлечение
 * PDF расставляет пробелы по метрикам шрифта, а не по словам. Числа склеиваются
 * ТОЛЬКО внутри записи диаметра и только через одиночный пробел — иначе «458,94
 * метра» и «3,7 до 5,2» слиплись бы в бессмыслицу.
 */
function glueKerning(text: string): string {
  let previous = text
  for (let pass = 0; pass < 4; pass++) {
    const next = previous.replace(/(\d) (\d)/g, '$1$2')
    if (next === previous) break
    previous = next
  }
  return previous
}

/** Нормализует пробелы, оставляя текст пригодным для цитаты. */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

const MATERIALS = [
  { pattern: /керамическ/i, name: 'керамическая' },
  { pattern: /чугунн/i, name: 'чугунная' },
  { pattern: /асбоцемент|асбестоцемент/i, name: 'асбестоцементная' },
  { pattern: /железобетонн/i, name: 'железобетонная' },
  { pattern: /полиэтиленов/i, name: 'полиэтиленовая' },
  { pattern: /стальн/i, name: 'стальная' },
] as const

const ruNumber = (raw: string) => Number(raw.replace(',', '.'))

/** Читает факты акта. Ничего не подтверждает и ничего не додумывает. */
export function extractSurveyActFacts(pages: SurveyActPage[]): SurveyActFacts {
  const facts: SurveyActFacts = {
    diameterMm: [], material: [], lengthM: [], depthRangeM: [], category: [], verdicts: [], missing: [],
  }
  const seen = new Set<string>()
  const add = <T>(list: Array<SurveyActValue<T>>, value: T, quote: string, page: number) => {
    const key = `${list.length === 0 ? '' : ''}${JSON.stringify(value)}|${quote}`
    if (seen.has(key)) return
    seen.add(key)
    list.push({ value, quote: tidy(quote), page })
  }

  for (const { page, text } of pages) {
    for (const sentence of text.split(/(?<=[.;])\s+|\n/)) {
      const line = tidy(sentence)
      if (line === '') continue

      // Диаметр: кернинг снимается только на этом участке строки.
      const diameter = /(?:Ø|диаметр[а-яё]*)\s*([\d\s]{2,8})\s*мм/i.exec(line)
      if (diameter) {
        const value = Number(glueKerning(diameter[1]).replace(/\s/g, ''))
        if (Number.isFinite(value) && value >= 50 && value <= 3000) add(facts.diameterMm, value, line, page)
      }

      const material = MATERIALS.find((item) => item.pattern.test(line) && /труб/i.test(line))
      if (material) add(facts.material, material.name, line, page)

      // Кернинг рвёт и слова: в акте стоит «протяженность ю 458,94 м етров».
      // Поэтому окончание слова допускается через пробел, а единица «метр»
      // разрешает пробелы между буквами — но только внутри самой единицы.
      const length = /протяж[её]нность(?:\s*[а-яё]{1,3})?\s*(?:составляет\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*м\s*е\s*т\s*р/i.exec(line)
      if (length) {
        const value = ruNumber(length[1])
        if (Number.isFinite(value) && value > 0) add(facts.lengthM, value, line, page)
      }

      const depth = /(?:глубин[а-яё]*\s+заложени[а-яё]*|заложени[а-яё]*)[^.]{0,60}?(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:до|[–—-])\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*м\s*е\s*т\s*р/i.exec(line)
        ?? /труб[а-яё]*\s+составляет\s+от\s+(\d{1,2}(?:[.,]\d{1,2})?)\s*до\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*м\s*е\s*т\s*р/i.exec(line)
      if (depth) {
        const fromM = ruNumber(depth[1])
        const toM = ruNumber(depth[2])
        if (Number.isFinite(fromM) && Number.isFinite(toM) && toM >= fromM) {
          add(facts.depthRangeM, { fromM, toM }, line, page)
        }
      }

      const category = /категори[яю]\s*(I{1,3}|IV|[1-4])\b/i.exec(line)
      if (category) add(facts.category, category[1].toUpperCase(), line, page)

      if (/подлежат\s+демонтажу|не\s+пригодн[а-яё]*\s+к\s+повторному|подлежит\s+заменe?|требует\s+заме/i.test(line)) {
        add(facts.verdicts, line, line, page)
      }
    }
  }

  // Отсутствие называется. Шероховатости в акте не бывает — это не пробел
  // разбора, а свойство документа, и инженер должен знать, что её тут нет.
  if (facts.diameterMm.length === 0) facts.missing.push('диаметр существующей трубы')
  if (facts.material.length === 0) facts.missing.push('материал существующей трубы')
  if (facts.lengthM.length === 0) facts.missing.push('протяжённость сети')
  if (facts.category.length === 0) facts.missing.push('категория технического состояния')
  facts.missing.push('шероховатость: акт оценивает конструкции, а не гидравлику — величину принимает инженер')
  return facts
}
