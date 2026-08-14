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
  /**
   * Величина названа в ССЫЛКЕ НА НОРМАТИВ, а не в описании объекта.
   *
   * В настоящем акте различие существенно. Материал трубы объекта назван прямо:
   * «Материал канализационной сети – керамическая труба». А рядом стоит «Для
   * керамических, асбоцементных трубопроводов – … со СН РК 1.04-26-2022 …
   * составляет 30 лет» и «превышает нормативный срок службы асбоцементных
   * трубопроводов»: там асбоцемент — предмет нормы, а не материал этой сети.
   *
   * Кандидат из ссылки НЕ выбрасывается: акт противоречив сам себе, и прятать
   * это от инженера нельзя. Он помечается, чтобы разница была видна на экране.
   */
  fromNormReference?: boolean
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

/**
 * Признаки того, что строка говорит о НОРМАТИВЕ, а не об этой сети.
 *
 * Двумя способами, потому что в акте встречаются оба. Обозначение документа
 * («со СН РК 1.04-26-2022») — прямая ссылка. Оборот «нормативный срок службы»
 * ссылается на норму без её обозначения, и материал в такой строке принадлежит
 * норме: «превышает нормативный срок службы асбоцементных трубопроводов»
 * сказано о трубе, которая по описанию керамическая.
 */
const NORM_REFERENCE = [
  // Границу слова здесь задаёт просмотр назад, а не `\b`: в JS `\b` опирается
  // на `\w` = [A-Za-z0-9_], и между пробелом и «С» границы НЕТ — обозначение
  // норматива не находилось бы ни разу.
  // Номер редакции не требуется: перенос строки может оторвать его от
  // обозначения, а «со СН РК» — уже ссылка на норму, а не описание объекта.
  /(?<![а-яё])(?:СН|СП|СТ)\s*РК(?![а-яё])/i,
  /(?<![а-яё])СНиП(?![а-яё])/i,
  /(?<![а-яё])ГОСТ(?![а-яё])/i,
  /нормативн[а-яё]*\s+срок[а-яё]*\s+службы/i,
] as const

const ruNumber = (raw: string) => Number(raw.replace(',', '.'))

/** Читает факты акта. Ничего не подтверждает и ничего не додумывает. */
export function extractSurveyActFacts(pages: SurveyActPage[]): SurveyActFacts {
  const facts: SurveyActFacts = {
    diameterMm: [], material: [], lengthM: [], depthRangeM: [], category: [], verdicts: [], missing: [],
  }
  const seen = new Set<string>()
  const add = <T>(
    list: Array<SurveyActValue<T>>, value: T, quote: string, page: number, fromNormReference = false,
  ) => {
    const key = `${JSON.stringify(value)}|${quote}`
    if (seen.has(key)) return
    seen.add(key)
    list.push({ value, quote: tidy(quote), page, fromNormReference })
  }

  for (const { page, text } of pages) {
    // Перевод строки в PDF — это ПЕРЕНОС, а не конец предложения. В настоящем
    // акте стоит «классифицировано как ⏎ категория ⏎ III ⏎ (ограниченно», и
    // разрыв по переводу строки терял категорию целиком. Границей служит только
    // знак конца предложения; то же приходит и из приложения, где страница
    // склеивается из фрагментов текстового слоя в одну строку без переводов.
    for (const sentence of tidy(text).split(/(?<=[.;])\s+/)) {
      const line = tidy(sentence)
      if (line === '') continue
      const fromNorm = NORM_REFERENCE.some((pattern) => pattern.test(line))

      // Диаметр: кернинг снимается только на этом участке строки.
      const diameter = /(?:Ø|диаметр[а-яё]*)\s*([\d\s]{2,8})\s*мм/i.exec(line)
      if (diameter) {
        const value = Number(glueKerning(diameter[1]).replace(/\s/g, ''))
        if (Number.isFinite(value) && value >= 50 && value <= 3000) {
          add(facts.diameterMm, value, line, page, fromNorm)
        }
      }

      // Материалы берутся ВСЕ, что названы в строке, а не первый по списку.
      // Строка «Для керамических, асбоцементных трубопроводов» называет два, и
      // выбор одного из них порядком объявления был бы догадкой.
      if (/труб/i.test(line)) {
        for (const material of MATERIALS) {
          if (material.pattern.test(line)) add(facts.material, material.name, line, page, fromNorm)
        }
      }

      // Кернинг рвёт и слова: в акте стоит «протяженность ю 458,94 м етров».
      // Поэтому окончание слова допускается через пробел, а единица «метр»
      // разрешает пробелы между буквами — но только внутри самой единицы.
      const length = /протяж[её]нность(?:\s*[а-яё]{1,3})?\s*(?:составляет\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*м\s*е\s*т\s*р/i.exec(line)
      if (length) {
        const value = ruNumber(length[1])
        if (Number.isFinite(value) && value > 0) add(facts.lengthM, value, line, page, fromNorm)
      }

      const depth = /(?:глубин[а-яё]*\s+заложени[а-яё]*|заложени[а-яё]*)[^.]{0,60}?(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:до|[–—-])\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*м\s*е\s*т\s*р/i.exec(line)
        ?? /труб[а-яё]*\s+составляет\s+от\s+(\d{1,2}(?:[.,]\d{1,2})?)\s*до\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*м\s*е\s*т\s*р/i.exec(line)
      if (depth) {
        const fromM = ruNumber(depth[1])
        const toM = ruNumber(depth[2])
        if (Number.isFinite(fromM) && Number.isFinite(toM) && toM >= fromM) {
          add(facts.depthRangeM, { fromM, toM }, line, page, fromNorm)
        }
      }

      const category = /категори[яю]\s*(I{1,3}|IV|[1-4])\b/i.exec(line)
      if (category) add(facts.category, category[1].toUpperCase(), line, page, fromNorm)

      if (/подлежат\s+демонтажу|не\s+пригодн[а-яё]*\s+к\s+повторному|подлежит\s+заменe?|требует\s+заме/i.test(line)) {
        add(facts.verdicts, line, line, page, fromNorm)
      }
    }
  }

  // Отсутствие называется. Шероховатости в акте не бывает — это не пробел
  // разбора, а свойство документа, и инженер должен знать, что её тут нет.
  if (facts.diameterMm.length === 0) facts.missing.push('диаметр существующей трубы')
  if (facts.material.length === 0) facts.missing.push('материал существующей трубы')
  else if (facts.material.every((item) => item.fromNormReference)) {
    // Материал назван, но только там, где акт ссылается на норму. Описания
    // самой трубы в документе нет, и молчаливо принимать материал нормы за
    // материал объекта нельзя.
    facts.missing.push('материал существующей трубы в описании объекта: назван только в ссылках на нормативы')
  }
  if (facts.lengthM.length === 0) facts.missing.push('протяжённость сети')
  if (facts.category.length === 0) facts.missing.push('категория технического состояния')
  facts.missing.push('шероховатость: акт оценивает конструкции, а не гидравлику — величину принимает инженер')
  return facts
}

/**
 * Сколько величин акт дал — для счётчика слота комплекта.
 *
 * Считаются кандидаты, а не подтверждённые величины: слот показывает, что
 * нашлось в документе, подтверждает инженер в секции «Существующая сеть и АТО».
 */
export function countSurveyActValues(facts: SurveyActFacts): number {
  return facts.diameterMm.length + facts.material.length + facts.lengthM.length
    + facts.depthRangeM.length + facts.category.length + facts.verdicts.length
}
