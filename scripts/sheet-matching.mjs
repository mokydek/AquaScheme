/**
 * Сопоставление листов альбома по СОДЕРЖАНИЮ, а не по номеру страницы.
 *
 * ПОЧЕМУ МЕТРИКА МЕНЯЕТСЯ
 *
 * Нарезка альбома на листы — производная данных, а не оформления: границы
 * листов встают по узлам сети и по длине оси, а наша ось длиннее эталонной на
 * 3,4 %. Из-за этого страница N нашего альбома и страница N эталона показывают
 * РАЗНЫЕ участки трассы, и постраничное сравнение систематически наказывает
 * содержимое за сдвиг резов: безупречно нарисованный лист получает низкий ink
 * просто потому, что его пикетный диапазон смещён относительно эталонного.
 *
 * Поэтому листы сопоставляются по перекрытию пикетных диапазонов внутри одного
 * семейства (план↔план, профиль↔профиль), а листы без пикетов — по семейству и
 * порядку, как раньше. Формулы pixel / ink / structure при этом НЕ трогаются:
 * меняется только то, ЧТО с чем сравнивается.
 *
 * ЧТО ЗДЕСЬ НАМЕРЕННО ЖЁСТКО
 *
 * Сопоставление симметрично и детерминировано: пара — это лист с наибольшим
 * перекрытием, эталонный лист не переиспользуется, а при равном перекрытии
 * порядок решают номера страниц. Лист, которому пары не нашлось (перекрытие
 * ниже порога), получает ноль и помечается «без пары»: несравнимое наказывается
 * явно, а не выбрасывается молча.
 */

/** Доля перекрытия, ниже которой пара не признаётся. */
export const DEFAULT_OVERLAP_THRESHOLD = 0.3

/**
 * Пикет в метры.
 *
 * «ПК142+25.83» → 14225.83; «ПК0» → 0. Пикет без номера («ПК+10.54») НЕ
 * читается: в нём потерян номер сотни, и достроить его можно только догадкой.
 * Такой лист честнее объявить непрочитанным, чем подставить соседнее значение.
 */
export function parsePicketMetres(raw) {
  const match = /ПК(\d+)(?:\s*\+\s*(\d+(?:[.,]\d+)?))?/.exec(String(raw ?? ''))
  if (!match) return null
  const hundreds = Number(match[1])
  const rest = match[2] === undefined ? 0 : Number(String(match[2]).replace(',', '.'))
  if (!Number.isFinite(hundreds) || !Number.isFinite(rest)) return null
  return hundreds * 100 + rest
}

/**
 * Пикетный диапазон из названия листа.
 *
 * Возвращает `null`, если в названии нет пары пикетов или хотя бы один из них
 * не читается. Диапазон нулевой длины тоже отвергается: сопоставлять по нему
 * нечего.
 */
export function parsePicketRange(title) {
  const text = String(title ?? '')
  const pickets = [...text.matchAll(/ПК\s*\d*(?:\s*\+\s*\d+(?:[.,]\d+)?)?/g)].map((match) => match[0])
  if (pickets.length < 2) return null
  const start = parsePicketMetres(pickets[0])
  const end = parsePicketMetres(pickets[1])
  if (start === null || end === null) return null
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  if (!(to > from)) return null
  return { fromM: from, toM: to }
}

/**
 * Семейство листа по названию.
 *
 * Разбор один и тот же для обеих сторон: и наши названия, и эталонные приходят
 * текстом одного вида («План К2 ПК… - ПК…»). Разные разборы для «своего» и
 * «чужого» дали бы несимметричное сопоставление.
 */
export function classifySheet(title) {
  // Разбирается только НАЧАЛО страницы: дальше идёт содержимое чертежа, и по
  // нему семейство определять нельзя. На этом разбор уже ошибался — в ведомости
  // рабочих чертежей есть строка «Титульный лист рабочего комплекта», и вся
  // страница ведомости уезжала в семейство титула.
  const text = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)
  if (/^(РАБОЧАЯ ДОКУМЕНТАЦИЯ|Титульный лист)/i.test(text)) return 'title'
  if (/^(Ведомость рабочих чертежей|Общие данные|Общие указания)/i.test(text)) return 'general'
  // Границы слов: `\b` в JS считает словом только латиницу, и между «н» и
  // пробелом в «План К2» границы нет — на этом разбор уже спотыкался. Поэтому
  // конец слова задаётся явным «не буква кириллицы».
  if (/^(Сводный план|План сетей)(?![а-яё])/i.test(text)) return 'networkPlan'
  if (/^План(?![а-яё])/i.test(text)) return 'plan'
  if (/Профиль на участке/i.test(text)) return 'existingProfile'
  if (/^Профиль(?![а-яё])/i.test(text)) return 'profile'
  if (/Таблица расхода материалов/i.test(text)) return 'materials'
  if (/Защитная сетка/i.test(text)) return 'grid'
  if (/Спецификация/i.test(text)) return 'spec'
  return 'other'
}

/** Семейства, которые сопоставляются по пикетам. */
export const PICKET_FAMILIES = new Set(['plan', 'profile'])

/**
 * Ведомость листов эталона из `ETALON-SHEETS.md`.
 *
 * Читается только состав — номера и названия листов. Инженерные величины из
 * эталона не берутся: пикеты здесь задают, ЧТО с чем сравнивать, и в чертёж не
 * попадают.
 *
 * Номер страницы PDF: титул — 1, лист 1 — страница 2, то есть страница = лист+1.
 */
export function parseReferenceRegister(markdown, { pageOffset = 1 } = {}) {
  const sheets = []
  for (const match of String(markdown ?? '').matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|$/gm)) {
    const sheet = Number(match[1])
    const title = match[2].trim()
    if (!Number.isFinite(sheet) || title === '' || /^Наименование$/i.test(title)) continue
    // В файле есть и сводка по семействам — её строки начинаются не с номера
    // листа, а с названия семейства, и сюда не попадают. Но диапазон листов
    // «1–2» в сводке выглядит как число, поэтому лишние строки отсекаются по
    // отсутствию осмысленного семейства.
    const family = classifySheet(title)
    if (family === 'other') continue
    sheets.push({ sheet, page: sheet + pageOffset, title, family, range: parsePicketRange(title) })
  }
  return [...sheets, ...parseReferenceStructure(markdown)].sort((left, right) => left.page - right.page)
}

/**
 * Страницы эталона вне основного комплекта: титул и прилагаемые НК.С.
 *
 * Таблицей они в ведомости не перечислены — только фразой о структуре PDF, — и
 * без них сопоставление получалось несимметричным: наши титул и спецификация
 * оставались без пары и получали ноль, а соответствующие страницы эталона в
 * сравнение вообще не входили. Наказание за состав должно быть взаимным.
 *
 * Фраза разбирается узко и намеренно: не нашлась — возвращается пусто, и это
 * видно в отчёте по числу листов. Догадок о номерах страниц здесь нет.
 */
export function parseReferenceStructure(markdown) {
  const text = String(markdown ?? '').replace(/\s+/g, ' ')
  const sheets = []
  const title = /титульный лист \(стр\.\s*(\d+)\)/i.exec(text)
  if (title) sheets.push({ sheet: null, page: Number(title[1]), title: 'Титульный лист', family: 'title', range: null })
  const attached = /листа? НК\.С «([^»]+)»[^)]*?стр\.\s*(\d+)\s*[–—-]\s*(\d+)\)/i.exec(text)
  if (attached) {
    for (let page = Number(attached[2]); page <= Number(attached[3]); page++) {
      sheets.push({ sheet: null, page, title: attached[1], family: 'spec', range: null })
    }
  }
  return sheets
}

/** Доля перекрытия двух диапазонов: пересечение к объединению. */
export function overlapRatio(left, right) {
  if (!left || !right) return 0
  const from = Math.max(left.fromM, right.fromM)
  const to = Math.min(left.toM, right.toM)
  const intersection = Math.max(0, to - from)
  if (intersection === 0) return 0
  const union = Math.max(left.toM, right.toM) - Math.min(left.fromM, right.fromM)
  return union > 0 ? intersection / union : 0
}

/**
 * Пары «наш лист ↔ эталонный лист».
 *
 * Жадно: сначала пара с наибольшим перекрытием, затем следующая из оставшихся.
 * При равном перекрытии решают номера страниц — иначе результат зависел бы от
 * порядка перебора и переставал быть воспроизводимым.
 *
 * Непикетные семейства сопоставляются по порядку внутри семейства: другого
 * признака у них нет, а по номеру страницы они разъезжаются так же, как планы.
 */
export function matchSheets(generated, reference, { threshold = DEFAULT_OVERLAP_THRESHOLD } = {}) {
  const pairs = []
  const usedReference = new Set()
  const usedGenerated = new Set()

  const candidates = []
  for (const ours of generated) {
    if (!PICKET_FAMILIES.has(ours.family) || !ours.range) continue
    for (const theirs of reference) {
      if (theirs.family !== ours.family || !theirs.range) continue
      const ratio = overlapRatio(ours.range, theirs.range)
      if (ratio < threshold) continue
      candidates.push({ ours, theirs, ratio })
    }
  }
  candidates.sort((left, right) =>
    right.ratio - left.ratio || left.ours.page - right.ours.page || left.theirs.page - right.theirs.page)
  for (const candidate of candidates) {
    if (usedGenerated.has(candidate.ours.page) || usedReference.has(candidate.theirs.page)) continue
    usedGenerated.add(candidate.ours.page)
    usedReference.add(candidate.theirs.page)
    pairs.push({
      generatedPage: candidate.ours.page,
      referencePage: candidate.theirs.page,
      family: candidate.ours.family,
      overlap: candidate.ratio,
      generatedRange: candidate.ours.range,
      referenceRange: candidate.theirs.range,
      basis: 'picket',
    })
  }

  const families = new Set([...generated, ...reference].map((sheet) => sheet.family))
  for (const family of families) {
    if (PICKET_FAMILIES.has(family)) continue
    const ours = generated.filter((sheet) => sheet.family === family && !usedGenerated.has(sheet.page))
    const theirs = reference.filter((sheet) => sheet.family === family && !usedReference.has(sheet.page))
    for (let index = 0; index < Math.min(ours.length, theirs.length); index++) {
      usedGenerated.add(ours[index].page)
      usedReference.add(theirs[index].page)
      pairs.push({
        generatedPage: ours[index].page,
        referencePage: theirs[index].page,
        family,
        overlap: null,
        generatedRange: null,
        referenceRange: null,
        basis: 'family',
      })
    }
  }
  pairs.sort((left, right) => left.generatedPage - right.generatedPage)

  const unmatchedGenerated = generated
    .filter((sheet) => !usedGenerated.has(sheet.page))
    .map((sheet) => ({ page: sheet.page, family: sheet.family, title: sheet.title, reason: unmatchedReason(sheet, reference, threshold) }))
  const unmatchedReference = reference
    .filter((sheet) => !usedReference.has(sheet.page))
    .map((sheet) => ({ page: sheet.page, family: sheet.family, title: sheet.title, reason: unmatchedReason(sheet, generated, threshold) }))
  return { pairs, unmatchedGenerated, unmatchedReference }
}

/** Почему лист остался без пары — чтобы ноль в отчёте был объяснён. */
function unmatchedReason(sheet, otherSide, threshold) {
  if (PICKET_FAMILIES.has(sheet.family) && !sheet.range) return 'пикетный диапазон в названии не читается'
  const sameFamily = otherSide.filter((other) => other.family === sheet.family)
  if (sameFamily.length === 0) return 'на другой стороне нет листов этого семейства'
  if (!PICKET_FAMILIES.has(sheet.family)) return 'листов этого семейства на другой стороне меньше'
  const best = sameFamily.reduce((max, other) => Math.max(max, overlapRatio(sheet.range, other.range)), 0)
  if (best < threshold) return `наибольшее перекрытие ${(best * 100).toFixed(1)} % ниже порога ${(threshold * 100).toFixed(0)} %`
  return 'лист с наибольшим перекрытием уже занят другой парой'
}

/**
 * Общее пикетное окно пары.
 *
 * Сравнивается только тот участок трассы, который показан на обоих листах:
 * остальное на одном из листов физически отсутствует, и требовать там совпадения
 * значило бы снова наказывать за нарезку.
 */
export function commonWindow(pair) {
  if (!pair.generatedRange || !pair.referenceRange) return null
  const fromM = Math.max(pair.generatedRange.fromM, pair.referenceRange.fromM)
  const toM = Math.min(pair.generatedRange.toM, pair.referenceRange.toM)
  return toM > fromM ? { fromM, toM } : null
}
