import { PARSER_VERSIONS } from '@aquascheme/engine'
import { routeUpload } from './upload'
import type { UploadStage } from './upload'

/**
 * Разбор документов проекта — одним местом на всё приложение.
 *
 * Раньше разбор жил внутри вида мастера комплекта. Пока разбор запускался
 * только оттуда, это было терпимо; с появлением перезапуска из раздела величин
 * получилось бы ДВА места, где документ превращается в набор величин, — и они
 * разошлись бы, как уже разошлись ключи мастера и реестра ИРД.
 *
 * Здесь же ставится версия разбора: результат без версии неотличим от
 * свежего, и правка извлечения молча не доходит до сохранённого. Ставить её
 * должен тот, кто разбирает, а не тот, кто сохраняет, — иначе про неё забудут
 * ровно в том вызове, который добавят следующим.
 *
 * Тексты ошибок приходят снаружи готовыми: словари живут в интерфейсе.
 */

/** Что дал разбор геологического отчёта. */
export interface GeologyExtraction {
  /** То, что ложится в `extracted.geology`. */
  payload: Record<string, unknown>
  /** Знаков текста в документе — для счётчика слота. */
  charCount: number
  /** Кандидатов промерзания — для счётчика слота. */
  candidateCount: number
  /** Описаний ИГЭ — для счётчика слота. */
  igeCount: number
}

/** Разбирает геологический отчёт DOCX. Пустой текст — ошибка, а не пустой результат. */
export async function extractGeologyDocument(file: File, noTextMessage: string): Promise<GeologyExtraction> {
  const { docxText } = await import('./docxText')
  const { parseGeologyReportSummary } = await import('@aquascheme/engine')
  const text = docxText(new Uint8Array(await file.arrayBuffer()))
  if (text.trim() === '') {
    // Молчаливое «сохранено» скрыло бы, что документ не прочитан.
    throw new Error(noTextMessage)
  }
  const summary = parseGeologyReportSummary(text)
  return {
    payload: {
      parserVersion: PARSER_VERSIONS.geology,
      // Предложение разбора: величины с цитатами, без единого выбора.
      freezingDepthCandidates: summary.freezingDepthCandidates,
      // Строки без единицы едут вместе с кандидатами: раздел обязан показать
      // и то, что разбор ОТВЕРГ, — иначе это тихая потеря.
      freezingDepthUnitlessRows: summary.freezingDepthUnitlessRows,
      ige: summary.ige,
      groundwater: summary.groundwater,
      maxAggressiveness: summary.maxAggressiveness,
    },
    charCount: text.length,
    candidateCount: summary.freezingDepthCandidates.length,
    igeCount: summary.ige.length,
  }
}

/** Что дал разбор акта технического обследования. */
export interface SurveyActExtraction {
  /** То, что ложится в `extracted.survey_act`. */
  payload: Record<string, unknown>
  /** Страниц в документе — для счётчика слота. */
  pageCount: number
  /** Найденных величин — для счётчика слота. */
  valueCount: number
}

/** Разбирает акт технического обследования PDF. Скан без текста — ошибка. */
export async function extractSurveyActDocument(
  file: File, noTextLayerMessage: string,
): Promise<SurveyActExtraction> {
  const { loadPdfTextByPage } = await import('./pdfText')
  const pages = (await loadPdfTextByPage(file)).map((page, index) => ({
    page: index + 1,
    text: page.items.map((item) => item.str).join(' '),
  }))
  if (pages.every((page) => page.text.trim() === '')) throw new Error(noTextLayerMessage)
  const { countSurveyActValues, extractSurveyActFacts } = await import('@aquascheme/engine')
  const facts = extractSurveyActFacts(pages)
  return {
    payload: { parserVersion: PARSER_VERSIONS.survey_act, ...facts },
    pageCount: pages.length,
    valueCount: countSurveyActValues(facts),
  }
}

/** Что дал разбор чертежа топоосновы. */
export interface SurveyDrawingExtraction {
  layers: number
  roledLayers: number
  points: number
  segments: number
  marks: number
  elevations: number
  /** Разобран не выбранный файл, а его конвертация из DWG. */
  fromDwg: boolean
}

/**
 * Разбирает чертёж топоосновы — DXF или DWG.
 *
 * DWG идёт через `routeUpload`, ТОТ ЖЕ маршрут, что и все прочие загрузки
 * приложения. Слот мастера читал файл сам (`parseDxfNetwork(await
 * file.text())`), поэтому DWG в него было не положить: `accept` не показывал
 * его в диалоге, а подсказка велела владельцу конвертировать руками то, что
 * сервис делает за пять секунд. Ошибки при этом не было — возможность просто
 * не предлагалась.
 *
 * Скопировать конвертацию в слот было нельзя: два маршрута загрузки обязаны
 * разойтись. Поэтому разбор переехал сюда, к разбору геологии и акта, а слот
 * стал тонкой обёрткой.
 *
 * Отказ маршрута выходит наружу как `UploadError` — непереведённым: словарь
 * живёт в интерфейсе, и переводить здесь значило бы завести его второй раз.
 */
export async function extractSurveyDrawing(
  file: File,
  unreadableMessage: string,
  onStage?: (stage: UploadStage) => void,
): Promise<SurveyDrawingExtraction> {
  const routed = await routeUpload(file, ['dxf'], onStage)
  const { parseDxfNetwork, classifyDxfConstraints } = await import('@aquascheme/engine/dxfread')
  const data = parseDxfNetwork(routed.text ?? '')
  if (!data.ok) throw new Error(unreadableMessage)
  const constraints = classifyDxfConstraints(data, {}) as unknown as {
    roles?: Record<string, string>
    textEntities?: unknown[]
    surveyPoints?: unknown[]
  }
  const roles = Object.values(constraints.roles ?? {})
  return {
    layers: data.layers.length,
    roledLayers: roles.filter((role) => role !== 'unknown').length,
    points: data.points.length,
    segments: data.segments.length,
    marks: constraints.textEntities?.length ?? 0,
    elevations: constraints.surveyPoints?.length ?? 0,
    fromDwg: routed.fromDwg === true,
  }
}
