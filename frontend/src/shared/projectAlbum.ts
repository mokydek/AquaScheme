import type {
  GravityProfile,
  Borehole,
  CrossingRecord,
  RouteConstraintInput,
  SelectedManholeConstruction,
  SewerSchedule,
  SurveyPoint,
  TracedNetwork,
  WorkingDrawingAlbumPage,
  WorkingDrawingSet,
  WorkingDrawingSheet,
} from '@aquascheme/engine'
import { contoursFromSurvey, parseUtilityMark } from '@aquascheme/engine'
import type { ContourResult } from '@aquascheme/engine'
import {
  PLAN_TEXT_HEIGHT_MM,
  UTILITY_MARK_INTERVAL_MM,
  markPositionsAlong,
  planColour,
  planFontSize,
  planStroke,
} from './planStyles'
import type { PlanLineRole } from './planStyles'
import { allocatePlanLineBudget, planSourceLines } from './planLayerRole'
import type { PlanSourceLine, PlanSourceLines, RoleLineBudget } from './planLayerRole'
import { buildPlanSheetScene, clipPlanPolyline } from './planScene'
import type { PlanPipeDesign } from './planScene'
import { buildTitleBlock } from './titleBlock'
import type { TitleBlockSignatory } from './titleBlock'

export interface ProjectAlbumInput {
  /**
   * Альбом собран на учебных данных.
   *
   * Ставит водяной знак на каждый лист и остаётся единственной причиной, по
   * которой демо не уходит в выпуск. К режиму измерения сходства отношения не
   * имеет: там знака нет никогда.
   */
  syntheticData?: boolean
  projectName: string
  projectCode: string
  system: 'sewer' | 'storm'
  network: TracedNetwork
  profile: GravityProfile
  schedule: SewerSchedule
  drawingSet: WorkingDrawingSet
  surveyPoints: SurveyPoint[]
  boreholes?: Borehole[]
  /** Confirmed maximum perpendicular distance from the design axis for profile geology. */
  geologyMaxOffsetM?: number
  constraints?: (RouteConstraintInput & { crossings?: CrossingRecord[] }) | null
  manholeConstructions: SelectedManholeConstruction[]
  pipeDiameterMm: Map<string, number>
  /** Calculated per-pipe values used by plan annotations. */
  pipeDesign?: Map<string, PlanPipeDesign>
  outletFlowLps: number
  buildingLabels?: Map<string, string>
  /** Графа 9 основной надписи: организация, разработавшая документ. */
  organisation?: string
  /** Графы 10, 11, 13: характер работы, фамилия и дата. Подписи не рисуются. */
  signatories?: TitleBlockSignatory[]
}

type PdfNode = Record<string, unknown>
type PathPoint = { x: number; y: number; chainageM: number }
type AlbumPageFormat = WorkingDrawingAlbumPage['pageFormat']
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type SvgPoint = { x: number; y: number }
type SvgProjector = (point: { x: number; y: number }) => SvgPoint

const PDF_POINTS_PER_MM = 72 / 25.4
const PAGE_MARGINS: [number, number, number, number] = [30, 28, 30, 52]
const PLAN_SCALE_DENOMINATOR = 500
const PROFILE_HORIZONTAL_SCALE_DENOMINATOR = 500
/**
 * Вертикальные масштабы профиля — ряд ГОСТ 21.704—2011, таблица 2, строка 4.
 *
 * Норматив даёт три величины, и это не украшение: полоса чертежа у эталона
 * 129 мм, что при 1:100 вмещает 12,9 м перепада. Профиль нашего объекта уходит
 * на глубину до 47 м, и при 1:100 он в полосу не ложится — линия просто
 * пропадала бы за рамкой. Масштаб выбирается наименьшим из ряда, в который
 * профиль укладывается, и подписывается на листе.
 */
const PROFILE_VERTICAL_SCALE_DENOMINATORS = [100, 200, 500] as const

/**
 * Пределы прореживания подосновы на листе.
 *
 * Съёмка объекта — сотни тысяч примитивов, и весь массив в один SVG не влезает:
 * pdfmake разбирает разметку в лоб, и лист перестаёт собираться. Пределы подняты
 * против прежних (2400 / 1400 / 320 / 240) по измерению эталона: на его плотном
 * план-листе 15,5 тысячи обводок и 211 текстовых подписей, то есть прежний
 * предел подписей был втрое ниже натуры.
 *
 * Отброшенное не замалчивается: `cadContextSvg` возвращает счётчики, и лист
 * печатает их в строке основания.
 */
/**
 * Боковик продольного профиля: состав, порядок и высоты граф.
 *
 * Измерено по эталону — страницы 34 и 40 PDF (листы 33 и 39). Разделители граф
 * сняты по линиям постоянной координаты поперёк листа и легли на круглые
 * миллиметры: 15, 20, 25, 35, 45, 50, 55, 70, 85, 100, 115. Заголовки взяты
 * дословно из текстового слоя тех же страниц; их порядок — порядок координат.
 *
 * Полоса 50…55 мм на обеих страницах пуста: разделители есть, заголовка и
 * значений нет. Она сохранена как есть — выдумывать ей назначение не из чего.
 *
 * Поле чертежа начинается на 115 мм и кончается на 244 мм: 129 мм при
 * вертикальном 1:100 — это 12,9 м перепада, и шкала отметок эталона на стр. 34
 * идёт ровно от 335,00 до 348,00, то есть 13 м. Совпадение подтверждает замер.
 */
const PROFILE_SIDEBAR_ROWS = [
  { title: 'Пикеты', fromMm: 5, toMm: 15, vertical: false },
  { title: 'Номер колодца, точки, угла поворота', fromMm: 15, toMm: 25, vertical: false },
  { title: 'Расстояние, м', fromMm: 25, toMm: 35, vertical: false },
  { title: 'Уклон, ‰; длина, м', fromMm: 35, toMm: 45, vertical: false },
  { title: 'Основание', fromMm: 45, toMm: 50, vertical: false },
  { title: '', fromMm: 50, toMm: 55, vertical: false },
  { title: 'Обозначение трубы и тип изоляции', fromMm: 55, toMm: 70, vertical: false },
  { title: 'Натурная отметка земли, м', fromMm: 70, toMm: 85, vertical: true },
  { title: 'Проектная отметка земли, м', fromMm: 85, toMm: 100, vertical: true },
  { title: 'Проектная отметка низа трубы или низа лотка колодца, м', fromMm: 100, toMm: 115, vertical: true },
] as const

/** Поле чертежа профиля, мм от нижней кромки листа. */
const PROFILE_FIELD_FROM_MM = 115
const PROFILE_FIELD_TO_MM = 244

/**
 * Кегль боковика, мм.
 *
 * Взят прямо из матрицы шрифта эталона: 10,46 pt = 3,69 мм. Отметки набраны
 * чуть мельче (10,12 pt), примечания у колодцев — 4,47 pt; эта разница здесь не
 * воспроизводится, потому что назначения мелкого кегля мы не знаем.
 */
const PROFILE_TEXT_HEIGHT_MM = 3.7

/**
 * Поле чертежа планового листа в единицах холста.
 *
 * Прямоугольник, который лист физически показывает: его же задаёт обрезка
 * `clip-path` и обводит рамка. Отбор линий подосновы идёт ПО НЕМУ, а не по
 * географическому окну листа: поле шире окна поперёк оси, и линия, вышедшая за
 * окно вбок, на бумаге видна.
 */
const PLAN_FIELD = { x: 35, y: 15, height: 445 } as const

const CONTEXT_LINE_LIMIT = 6000
const TERRAIN_LINE_LIMIT = 3000
const CONTEXT_LABEL_LIMIT = 900
const CONTEXT_BLOCK_LIMIT = 500

/** Physical paper distance occupied by one model metre at the requested scale. */
export function scaleMillimetresPerMetre(denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error('Знаменатель масштаба должен быть положительным числом.')
  return 1000 / denominator
}

/** Rotate source coordinates into a local sheet axis without changing distances. */
export function localAxisCoordinates(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): SvgPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const ux = length > 1e-9 ? dx / length : 1
  const uy = length > 1e-9 ? dy / length : 0
  const rx = point.x - start.x
  const ry = point.y - start.y
  return { x: rx * ux + ry * uy, y: -rx * uy + ry * ux }
}

function pdfPageSize(format: AlbumPageFormat): string | { width: number; height: number } {
  if (!Number.isFinite(format.widthMm) || !Number.isFinite(format.heightMm) || format.widthMm <= 0 || format.heightMm <= 0) {
    throw new Error('Некорректный формат листа в манифесте альбома.')
  }
  if (format.format === 'A3' && format.widthMm === 420 && format.heightMm === 297) return 'A3'
  return { width: format.widthMm * PDF_POINTS_PER_MM, height: format.heightMm * PDF_POINTS_PER_MM }
}

/**
 * Ориентация страницы — по объявленным сторонам листа.
 *
 * pdfmake нормализует явно заданный размер под объявленную ориентацию: у
 * «landscape» он делает ширину не меньше высоты. Постоянный «landscape»
 * поэтому переворачивал листы, которые по расчёту выше своей ширины.
 */
function pdfPageOrientation(format: AlbumPageFormat): 'portrait' | 'landscape' {
  return format.heightMm > format.widthMm ? 'portrait' : 'landscape'
}

function manifestPageForSheet(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): WorkingDrawingAlbumPage {
  const page = input.drawingSet.manifest.pages.find((item) => item.sheetId === sheet.id)
  if (!page) throw new Error(`Лист ${sheet.id} отсутствует в манифесте альбома.`)
  return page
}

function drawingViewport(format: AlbumPageFormat) {
  const fitWidth = format.widthMm * PDF_POINTS_PER_MM - PAGE_MARGINS[0] - PAGE_MARGINS[2]
  const fitHeight = format.heightMm * PDF_POINTS_PER_MM - PAGE_MARGINS[1] - PAGE_MARGINS[3] - 36
  const canvasHeight = 500
  const canvasWidth = canvasHeight * fitWidth / Math.max(fitHeight, 1)
  const physicalHeightMm = fitHeight / PDF_POINTS_PER_MM
  const svgUnitsPerMm = canvasHeight / physicalHeightMm
  return { fitWidth, fitHeight, canvasWidth, canvasHeight, svgUnitsPerMm }
}

function intersectsBounds(points: Array<{ x: number; y: number }>, bounds: Bounds): boolean {
  if (points.length === 0) return false
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  return Number.isFinite(minX) && maxX >= bounds.minX && minX <= bounds.maxX && maxY >= bounds.minY && minY <= bounds.maxY
}

function sampled<T>(items: T[], maximum: number): T[] {
  const stride = Math.max(1, Math.ceil(items.length / Math.max(maximum, 1)))
  return items.filter((_, index) => index % stride === 0).slice(0, maximum)
}

function picket(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const rest = Math.round((chainageM - pk * 100) * 100) / 100
  return rest === 0 ? `ПК${pk}` : `ПК${pk}+${rest}`
}

function xmlText(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** Что осталось за кадром при отрисовке подосновы — чтобы не молчать об этом. */
interface CadContextResult {
  svg: string
  /** Линий подосновы отброшено прореживанием. */
  droppedLines: number
  /** Подписей подосновы скрыто из-за тесноты. */
  hiddenLabels: number
  /** Подписей подосновы выведено. */
  shownLabels: number
  /** Сколько линий каждой роли пришло в окно, выведено и отброшено. */
  roles: RoleLineBudget[]
  /** Линии со слоёв, роль которых не разобрана. Выведены подосновой. */
  unknownRoleLines: number
  /** Откуда взята линейная графика листа. */
  origin: PlanSourceLines['origin']
}

/**
 * Порядок вывода ролей: подоснова снизу, предмет чертежа сверху.
 *
 * SVG рисует в порядке разметки, и порядок здесь — это порядок перекрытия.
 * Существующая сеть и красная линия идут последними: на плотном листе их
 * перекрывала подоснова, и оранжевая нитка терялась под чёрным.
 */
const PLAN_ROLE_DRAW_ORDER: readonly PlanLineRole[] = [
  'topobase', 'existingBuilding', 'road', 'water', 'corridor', 'existingUtility', 'redLine',
]

/**
 * Линейная графика листа.
 *
 * КАЖДАЯ ЛИНИЯ ВЫВОДИТСЯ ОДИН РАЗ И В СТИЛЕ СВОЕЙ РОЛИ. Прежде здесь рисовался
 * весь чертёж стилем подосновы, а лист поверх повторял те же линии из
 * именованных наборов: существующая сеть выходила чёрной 0,127 мм и оранжевой
 * поверх неё, дороги — чёрными дважды. Теперь источник один
 * (`planSourceLines`), роль приезжает вместе с линией, а толщины и цвета
 * берутся из измеренной таблицы `planStyles`.
 *
 * Прореживание осталось — полная съёмка объекта не влезает в один SVG, — но
 * оно РАЗДАЁТСЯ ПО РОЛЯМ: редкая роль проходит целиком, массовые делят
 * остаток. Общий потолок прежний. Отброшенное не замалчивается: счётчики по
 * ролям возвращаются наверх и печатаются в примечании листа.
 */
function cadContextSvg(
  constraints: ProjectAlbumInput['constraints'],
  project: SvgProjector,
  bounds: Bounds,
  svgUnitsPerMm = 1,
  placer: ReturnType<typeof labelPlacer> | null = null,
  options: { lineLimit?: number; markIntervalFactor?: number; field?: Bounds } = {},
): CadContextResult {
  const lineLimit = options.lineLimit ?? CONTEXT_LINE_LIMIT + TERRAIN_LINE_LIMIT
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => {
      const projected = project(point)
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
    })
    .join(' ')
  const fontSize = planFontSize(svgUnitsPerMm)
  const markInterval = UTILITY_MARK_INTERVAL_MM * svgUnitsPerMm * (options.markIntervalFactor ?? 1)
  const source = planSourceLines(constraints ?? null)
  /**
   * Отбор идёт по ПОЛЮ ЧЕРТЕЖА, а не по географическому окну листа.
   *
   * Это не одно и то же. Окно задаёт участок трассы вдоль оси, а поле — тот
   * прямоугольник, который лист физически показывает; поперёк оси поле ШИРЕ
   * окна, и линия, вышедшая за окно вбок, на бумаге видна. Отбор по окну её
   * срезал.
   *
   * Прежде перекос не замечали, потому что именованные наборы — существующие
   * сети, красные линии — не отбирались ВООБЩЕ: на каждый лист выводился весь
   * объект, а лишнее срезала обрезка `clip-path`. На листе «План К2 ПК0 –
   * ПК3+93.88» это 53 красные линии в разметке при трёх, попадающих в окно:
   * семь процентов веса документа, невидимых на бумаге. Отбор по полю
   * оставляет ровно то, что лист показывает, — и не режет видимого, и не
   * носит невидимого.
   */
  const field = options.field
  const inWindow = field === undefined
    ? source.lines.filter((line) => intersectsBounds(line.points, bounds))
    : source.lines.filter((line) => intersectsBounds(line.points.map(project), field))
  const byRole = new Map<PlanLineRole, PlanSourceLine[]>()
  for (const line of inWindow) {
    const list = byRole.get(line.role)
    if (list) list.push(line)
    else byRole.set(line.role, [line])
  }
  const quota = allocatePlanLineBudget(
    new Map([...byRole].map(([role, lines]) => [role, lines.length])),
    lineLimit,
  )
  const ordered = [
    ...PLAN_ROLE_DRAW_ORDER.filter((role) => byRole.has(role)),
    ...[...byRole.keys()].filter((role) => !PLAN_ROLE_DRAW_ORDER.includes(role)),
  ]
  const roles: RoleLineBudget[] = []
  const roleSvg = ordered.map((role) => {
    const lines = byRole.get(role) ?? []
    const kept = sampled(lines, quota.get(role) ?? 0)
    roles.push({ role, arrived: lines.length, drawn: kept.length, thinned: lines.length - kept.length })
    const stroke = planStroke(role, svgUnitsPerMm)
    return kept.map((line) =>
      `<polyline data-cad-context="line" data-plan-role="${role}" points="${linePoints(line.points)}"`
      + ` fill="none" ${stroke}/>${lineMarkSvg(line, role, project, fontSize, markInterval)}`).join('')
  }).join('')
  const droppedByRole = roles.reduce((sum, item) => sum + item.thinned, 0)
  let hiddenLabels = 0
  let shownLabels = 0
  const labels = sampled(
    (constraints?.cadTextEntities ?? []).filter((label) =>
      Number.isFinite(label.x) && Number.isFinite(label.y)
      && label.x >= bounds.minX && label.x <= bounds.maxX
      && label.y >= bounds.minY && label.y <= bounds.maxY),
    CONTEXT_LABEL_LIMIT,
  ).map((label) => {
    const projected = project(label)
    const text = String(label.text ?? '').replaceAll('\\P', ' ')
    // Подпись подосновы уступает всем: сначала пробуется её собственное место,
    // затем небольшой сдвиг, и только потом она снимается. Наложение не
    // допускается — нечитаемая каша хуже отсутствующей отметки.
    const w = Math.max(fontSize, text.length * fontSize * 0.55)
    const h = fontSize * 1.25
    const box = placer
      ? placer.placeSource([0, -h, h, -2 * h, 2 * h].map((dy) => ({
        x: projected.x, y: projected.y - h + dy, w, h,
      })))
      : { x: projected.x, y: projected.y - h, w, h }
    if (box === null) { hiddenLabels += 1; return '' }
    shownLabels += 1
    const tx = box.x
    // Базовая линия отсчитывается от верха коробки так же, как у отметок
    // съёмки: у обоих видов подписи одна геометрия, и проверка перекрытий
    // восстанавливает коробку по одной формуле.
    const ty = box.y + h * 0.8
    const rotation = Number.isFinite(label.rotationDeg) && label.rotationDeg
      ? ` transform="rotate(${-label.rotationDeg!} ${tx.toFixed(1)} ${ty.toFixed(1)})"`
      : ''
    return `<text data-cad-context="text" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${fontSize.toFixed(2)}" fill="${planColour('topobase')}"${rotation}>${xmlText(text)}</text>`
  }).join('')
  const blocks = sampled(
    (constraints?.cadBlockEntities ?? []).filter((block) =>
      Number.isFinite(block.x) && Number.isFinite(block.y)
      && block.x >= bounds.minX && block.x <= bounds.maxX
      && block.y >= bounds.minY && block.y <= bounds.maxY),
    CONTEXT_BLOCK_LIMIT,
  ).map((block) => {
    const projected = project(block)
    const bx = projected.x
    const by = projected.y
    const arm = fontSize * 0.7
    return `<g data-cad-context="block"><path d="M${(bx - arm).toFixed(1)} ${by.toFixed(1)}H${(bx + arm).toFixed(1)}M${bx.toFixed(1)} ${(by - arm).toFixed(1)}V${(by + arm).toFixed(1)}" ${planStroke('topobase', svgUnitsPerMm)}/><text x="${(bx + arm + 1).toFixed(1)}" y="${(by - arm).toFixed(1)}" font-size="${fontSize.toFixed(2)}" fill="${planColour('topobase')}">${xmlText(block.name)}</text></g>`
  }).join('')
  return {
    svg: roleSvg + blocks + labels,
    droppedLines: droppedByRole,
    hiddenLabels,
    shownLabels,
    roles,
    unknownRoleLines: source.unknownRoleLines,
    origin: source.origin,
  }
}

/**
 * Буквенная марка или подпись линии — по роли, а не по слою.
 *
 * Марку разбирает `parseUtilityMark` — тот же разбор, что и на карточке
 * пересечения; второго словаря марок в проекте нет и не заводится. Текст марки
 * берётся из обозначения линии в съёмке: роль линии уже известна, и имя слоя
 * используется как ПОДПИСЬ съёмки, а не как признак роли.
 *
 * Если разбор вида не удался, а обозначение длинное, марка не ставится:
 * повторять «W-КАНАЛИЗАЦИЯ-ЛИВНЕВАЯ» через каждые два сантиметра — не подпись,
 * а помеха. Короткое обозначение подписывается дословно.
 *
 * Красная линия подписывается словами — так она названа и на эталоне, — и
 * реже: её подпись длинная, а сама линия обычно тянется через весь лист.
 *
 * Шаг повтора — 21,0 мм бумаги, измерен по эталону (см. `planStyles`). Раньше
 * марки ставились только на плановом листе; теперь они живут здесь, и схема
 * получает их тем же шагом, из того же места.
 */
const RED_LINE_CAPTION_STEPS = 6

function lineMarkSvg(
  line: PlanSourceLine,
  role: PlanLineRole,
  project: SvgProjector,
  fontSize: number,
  markInterval: number,
): string {
  if (role !== 'existingUtility' && role !== 'redLine') return ''
  const projected = line.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(project)
  const caption = (text: string, interval: number) =>
    markPositionsAlong(projected, interval).map((position) =>
      `<text data-utility-mark="${xmlText(text)}" transform="translate(${position.x.toFixed(1)} ${position.y.toFixed(1)}) rotate(${position.angleDeg.toFixed(1)})"`
      + ` x="0" y="${(-fontSize * 0.35).toFixed(2)}" text-anchor="middle" font-size="${fontSize.toFixed(2)}"`
      + ` fill="${planColour(role)}">${xmlText(text)}</text>`).join('')
  if (role === 'redLine') return caption('красная линия', markInterval * RED_LINE_CAPTION_STEPS)
  const raw = String(line.layer ?? '').trim()
  if (raw === '') return ''
  const parsed = parseUtilityMark(raw)
  const mark = parsed.kindEvidence ?? (raw.length <= 6 ? raw : '')
  return mark === '' ? '' : caption(mark, markInterval)
}

/**
 * Названия ролей в условных обозначениях.
 *
 * Ровно по одному на роль таблицы стилей: роль без названия не попала бы в
 * условные обозначения молча, а тип этого не позволит.
 */
const PLAN_ROLE_LEGEND: Readonly<Record<PlanLineRole, string>> = {
  topobase: 'топографическая подоснова',
  existingUtility: 'существующая сеть',
  existingBuilding: 'существующие здания и сооружения',
  redLine: 'красная линия',
  designedPipe: 'проектируемый трубопровод',
  designedPipeHidden: 'то же, невидимый участок',
  routeAxis: 'проектная ось',
  stationTick: 'пикетная засечка',
  coordinateGrid: 'координатная сетка',
  contour: 'горизонталь',
  contourIndex: 'горизонталь утолщённая',
  corridor: 'полоса отвода, зоны',
  water: 'водные объекты',
  road: 'дороги',
  sheetFrame: 'рамка листа',
}

/**
 * Что стало с линиями подосновы — строкой под листом.
 *
 * Прежде здесь стояло одно число: «линий подосновы прорежено 9 214». По нему
 * нельзя было понять, чего именно лишился лист, — а лишался он в первую очередь
 * редкого: красных линий и гидрографии, которые тонули в общем потоке. Теперь
 * прореживание названо ПО РОЛЯМ, и видно, что осталось от каждой.
 */
function contextNote(context: CadContextResult): string {
  const parts: string[] = []
  if (context.origin === 'named-sets') {
    parts.push('Линейная графика собрана из именованных наборов: полного контура чертежа в наборе нет,'
      + ' неразобранные элементы съёмки на лист не выведены')
  }
  if (context.origin === 'none') parts.push('Линейной подосновы в наборе нет')
  const thinned = context.roles.filter((role) => role.thinned > 0)
  parts.push(thinned.length === 0
    ? 'Прореживание не потребовалось: линии подосновы выведены полностью'
    : `Прорежено по ролям: ${thinned.map((role) => `${PLAN_ROLE_LEGEND[role.role]} ${role.drawn} из ${role.arrived}`).join('; ')}`)
  if (context.unknownRoleLines > 0) {
    parts.push(`линий со слоёв с неразобранной ролью ${context.unknownRoleLines}, выведены подосновой`)
  }
  return `${parts.join('. ')}.`
}

const LEGEND_COLUMNS = 3
const LEGEND_COLUMN_WIDTH = 128
const LEGEND_ROW_HEIGHT = 11
const LEGEND_FONT_SIZE = 6.5

/**
 * Условные обозначения листа.
 *
 * СТРОЯТСЯ ПО ТАБЛИЦЕ СТИЛЕЙ И ПО ФАКТУ ЛИСТА. Прежде обозначения были набраны
 * в разметке руками, и цвета в них не совпадали с цветами линий: существующая
 * сеть значилась фиолетовой штриховой (#9b2c8c), а рисовалась оранжевой
 * сплошной (#b85c00); «рельеф / подоснова» показывали зелёным (#78906d),
 * которого на листе нет вовсе. Условные обозначения, которые врут о самом
 * листе, хуже, чем их отсутствие.
 *
 * В список попадают только роли, ЛИНИИ КОТОРЫХ НА ЛИСТЕ ЕСТЬ. Обозначение
 * красной линии на листе без красных линий — такая же неправда, только с
 * другого конца.
 */
function planLegendSvg(
  roles: readonly PlanLineRole[],
  svgUnitsPerMm: number,
  extra: ReadonlyArray<{ symbol: (x: number, y: number) => string; label: string }> = [],
): string {
  const items = [
    ...roles.map((role) => ({
      label: PLAN_ROLE_LEGEND[role],
      symbol: (x: number, y: number) =>
        `<line data-legend-role="${role}" x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" ${planStroke(role, svgUnitsPerMm)}/>`,
    })),
    ...extra,
  ]
  if (items.length === 0) return ''
  const rows = Math.ceil(items.length / LEGEND_COLUMNS)
  const width = LEGEND_COLUMNS * LEGEND_COLUMN_WIDTH + 8
  const height = rows * LEGEND_ROW_HEIGHT + 6
  const cells = items.map((item, index) => {
    const x = 6 + (index % LEGEND_COLUMNS) * LEGEND_COLUMN_WIDTH
    const y = 10 + Math.floor(index / LEGEND_COLUMNS) * LEGEND_ROW_HEIGHT
    return `${item.symbol(x, y)}<text x="${x + 27}" y="${y + 2}">${xmlText(item.label)}</text>`
  }).join('')
  return `<g data-plan-legend="true" font-size="${LEGEND_FONT_SIZE}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff" fill-opacity="0.94" stroke="#888"/>${cells}</g>`
}

/**
 * Ситуационная схема по загруженной топооснове.
 *
 * Схему рисовал самодельный отрисовщик `SchemeView`: белый лист, синяя ломаная,
 * условная «подоснова» из координат зданий. Он не показывал НИЧЕГО из
 * загруженного чертежа — ни улиц, ни существующих сетей, ни красных линий, —
 * и решение владельца было записано давно: схема строится по топосъёмке.
 *
 * Здесь второго отрисовщика не заводится. Подоснова выводится тем же
 * `cadContextSvg`, что и на плановых листах, теми же измеренными стилями и с
 * тем же прореживанием; сверху ложится проектная графика. Схема отличается от
 * планового листа только кадром — обзорным на весь объект — и составом
 * надписей: она обзорная, а не рабочая.
 *
 * Кадр берётся по факту геометрии: экстент трассы плюс буфер, пропорции — как
 * вышло. Растягивать объект в фиксированные пропорции нельзя, это правило
 * `layerPreview`, и на вытянутой вдоль улицы трассе оно особенно заметно.
 */
export interface SituationSchemeInput {
  /** Проектная сеть: узлы и участки в координатах проекта. */
  network: TracedNetwork
  /** Подоснова в том же виде, что у плановых листов. */
  constraints?: ProjectAlbumInput['constraints']
  /** Диаметры участков для подписи. */
  pipeDiameterMm?: Map<string, number>
  /** Контуры полосы отвода, когда она загружена. */
  corridorRings?: Array<Array<{ x: number; y: number }>>
  /** Расход на выпуске, л/с. */
  outletFlowLps?: number
  title: string
}

export interface SituationSchemeResult {
  svg: string
  /** Масштаб схемы: знаменатель, округлённый до ряда. */
  scaleDenominator: number
  /** Линий подосновы выведено и отброшено прореживанием. */
  contextLines: number
  droppedLines: number
  /** То же по ролям: что именно потерял обзорный кадр. */
  roles: RoleLineBudget[]
  /** Слои, которых в проекте нет: называются строкой, а не молчанием. */
  missing: Array<'topobase' | 'corridor'>
}

/** Ряд масштабов ситуационных схем: обзорный лист крупнее рабочего. */
const SCHEME_SCALES = [500, 1000, 2000, 5000, 10000] as const
/** Буфер вокруг трассы, доля габарита. */
const SCHEME_MARGIN_SHARE = 0.12
/**
 * Предел линий подосновы на обзорной схеме.
 *
 * Он ЖЁСТЧЕ, чем у планового листа (6000): схема обзорная, вся трасса в одном
 * кадре, и тринадцать тысяч линий превратились бы в чёрное пятно и в секунды
 * ожидания. На плановых листах предел не трогается — там читают чертёж.
 */
const SCHEME_CONTEXT_LIMIT = 2500

/**
 * Во сколько раз реже ставятся буквенные марки на обзорной схеме.
 *
 * На плановом листе шаг марки 21,0 мм измерен по эталону и не трогается. Схема
 * при том же шаге ложится вчетверо плотнее: масштаб мельче (1:2000 против
 * 1:500), а в кадре не отрезок трассы, а весь объект — линий существующей сети
 * в кадре вчетверо больше, и марки сливаются в сплошную полосу.
 *
 * Правило прохода: если тесно, увеличивается ШАГ МАРКИ, а не стиль линии.
 * Толщина и цвет линии измерены по эталону и не подстраиваются под тесноту.
 * Множитель 4 возвращает схему к той же плотности марок на квадратный
 * сантиметр бумаги, что и у планового листа: 84,0 мм вместо 21,0 мм.
 */
const SCHEME_MARK_INTERVAL_FACTOR = 4

export function buildSituationSchemeSvg(input: SituationSchemeInput): SituationSchemeResult {
  const nodes = input.network.nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
  const missing: SituationSchemeResult['missing'] = []
  const contextSource = input.constraints?.cadContextLines ?? []
  if (contextSource.length === 0) missing.push('topobase')
  if (!input.corridorRings || input.corridorRings.length === 0) missing.push('corridor')

  if (nodes.length === 0) {
    return { svg: '', scaleDenominator: SCHEME_SCALES[0], contextLines: 0, droppedLines: 0, roles: [], missing }
  }

  const xs = nodes.map((node) => node.x)
  const ys = nodes.map((node) => node.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const marginM = Math.max(spanX, spanY, 1) * SCHEME_MARGIN_SHARE
  const bounds = {
    minX: Math.min(...xs) - marginM,
    maxX: Math.max(...xs) + marginM,
    minY: Math.min(...ys) - marginM,
    maxY: Math.max(...ys) + marginM,
  }
  const widthM = bounds.maxX - bounds.minX
  const heightM = bounds.maxY - bounds.minY

  // Пропорции кадра — по факту геометрии. Ширина в единицах SVG постоянна,
  // высота считается из отношения сторон объекта.
  const canvasWidth = 1000
  const canvasHeight = Math.max(320, Math.min(1400, Math.round(canvasWidth * (heightM / Math.max(widthM, 1e-9)))))
  const frame = 24
  const scale = Math.min(
    (canvasWidth - 2 * frame) / Math.max(widthM, 1e-9),
    (canvasHeight - 2 * frame) / Math.max(heightM, 1e-9),
  )
  const project = (point: { x: number; y: number }) => ({
    x: frame + (point.x - bounds.minX) * scale,
    // Север вверх: ось Y чертежа растёт вверх, экранная — вниз.
    y: canvasHeight - frame - (point.y - bounds.minY) * scale,
  })

  // Масштаб — из ряда, ближайший НЕ мельче фактического: подписывать 1:437
  // нельзя, а округление вниз соврало бы в сторону крупного.
  const metresPerSvgUnit = 1 / scale
  const actualDenominator = metresPerSvgUnit * 1000
  const scaleDenominator = SCHEME_SCALES.find((value) => value >= actualDenominator)
    ?? SCHEME_SCALES[SCHEME_SCALES.length - 1]

  const svgUnitsPerMm = scale / scaleMillimetresPerMetre(scaleDenominator)
  /**
   * Схема получает ТО ЖЕ, ЧТО И ПЛАН, из того же места.
   *
   * Прежде схема сама прорежала линии до `SCHEME_CONTEXT_LIMIT` и лишь потом
   * отдавала обрезок отрисовщику — прореживание шло вслепую, единым шагом по
   * всему чертежу, и редкие роли пропадали первыми. Теперь предел передаётся
   * внутрь, где он раздаётся по ролям тем же правилом, что и на плане.
   *
   * Шаг марок увеличен: см. `SCHEME_MARK_INTERVAL_FACTOR`.
   */
  const context = cadContextSvg(
    input.constraints,
    project,
    bounds,
    svgUnitsPerMm,
    null,
    {
      lineLimit: SCHEME_CONTEXT_LIMIT,
      markIntervalFactor: SCHEME_MARK_INTERVAL_FACTOR,
      field: { minX: 0, maxX: canvasWidth, minY: 0, maxY: canvasHeight },
    },
  )
  const drawnContextLines = context.roles.reduce((sum, role) => sum + role.drawn, 0)

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const route = input.network.pipes.flatMap((pipe) => {
    const from = nodeById.get(pipe.fromNode)
    const to = nodeById.get(pipe.toNode)
    if (!from || !to) return []
    const a = project(from)
    const b = project(to)
    const diameterMm = input.pipeDiameterMm?.get(pipe.id)
    const label = diameterMm
      ? `<text x="${((a.x + b.x) / 2).toFixed(1)}" y="${((a.y + b.y) / 2 - 4).toFixed(1)}" font-size="${planFontSize(svgUnitsPerMm).toFixed(2)}" fill="${planColour('designedPipe')}">Ø${diameterMm}</text>`
      : ''
    return [`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ${planStroke('designedPipe', svgUnitsPerMm)} stroke-linecap="round"/>${label}`]
  }).join('')

  const wells = nodes.map((node) => {
    const point = project(node)
    const isOutlet = node.kind === 'outlet' || node.kind === 'outfall' || node.kind === 'source'
      || node.kind === 'lns_inlet' || node.kind === 'pumping_station'
    const radius = Math.max(1.6, 1.1 * svgUnitsPerMm)
    const mark = isOutlet
      ? `<rect x="${(point.x - radius).toFixed(1)}" y="${(point.y - radius).toFixed(1)}" width="${(radius * 2).toFixed(1)}" height="${(radius * 2).toFixed(1)}" fill="${planColour('designedPipe')}"/>`
      : `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="#fff" ${planStroke('designedPipe', svgUnitsPerMm)}/>`
    const label = node.label ?? node.id
    return `${mark}<text x="${(point.x + radius + 2).toFixed(1)}" y="${(point.y - radius).toFixed(1)}" font-size="${planFontSize(svgUnitsPerMm).toFixed(2)}">${xmlText(label)}</text>`
  }).join('')

  const corridor = (input.corridorRings ?? []).map((ring) => {
    const points = ring.map((point) => {
      const projected = project(point)
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
    }).join(' ')
    return `<polyline data-scheme-corridor="true" points="${points}" fill="none" ${planStroke('corridor', svgUnitsPerMm)}/>`
  }).join('')

  const barMetres = SCHEME_SCALES[0] === scaleDenominator ? 20 : Math.round(scaleDenominator / 20)
  const barWidth = barMetres * scale
  const scaleBar = `<g transform="translate(${frame + 8} ${canvasHeight - frame - 12})" font-size="9">`
    + `<line x1="0" y1="0" x2="${barWidth.toFixed(1)}" y2="0" stroke="#111" stroke-width="2"/>`
    + `<line x1="0" y1="-4" x2="0" y2="4" stroke="#111"/><line x1="${barWidth.toFixed(1)}" y1="-4" x2="${barWidth.toFixed(1)}" y2="4" stroke="#111"/>`
    + `<text x="0" y="16">0</text><text x="${barWidth.toFixed(1)}" y="16" text-anchor="middle">${barMetres} м</text>`
    + `<text x="0" y="-8">М 1:${scaleDenominator}</text></g>`
  const north = `<g transform="translate(${canvasWidth - frame - 24} ${frame + 34})">`
    + '<path d="M0 26 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/>'
    + '<text x="0" y="-6" text-anchor="middle" font-size="11">С</text></g>'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}"`
    + ` data-situation-scheme="true" data-scale-denominator="${scaleDenominator}"`
    + ` data-svg-units-per-mm="${svgUnitsPerMm.toFixed(4)}">`
    + `<rect width="${canvasWidth}" height="${canvasHeight}" fill="#fff"/>`
    + `<rect x="${frame}" y="${frame}" width="${canvasWidth - 2 * frame}" height="${canvasHeight - 2 * frame}" fill="none" ${planStroke('sheetFrame', svgUnitsPerMm)}/>`
    + `<g data-scheme-context="true">${context.svg}</g>${corridor}`
    + `<g data-scheme-route="true">${route}${wells}</g>`
    + `${north}${scaleBar}`
    + `<text x="${frame + 8}" y="${frame + 16}" font-size="12" font-weight="700">${xmlText(input.title)}</text>`
    + '</svg>'

  return {
    svg,
    scaleDenominator,
    contextLines: drawnContextLines,
    droppedLines: context.droppedLines,
    roles: context.roles,
    missing,
  }
}

/**
 * Горизонтали считаются один раз на альбом и сразу по всей съёмке.
 *
 * Полистный расчёт был бы неверен: треугольники на краю окна у соседних листов
 * получились бы разными, и горизонталь на склейке не сошлась бы. Поэтому
 * поверхность строится по всем точкам, а лист лишь вырезает своё окно.
 */
const albumContourCache = new WeakMap<SurveyPoint[], ContourResult>()

function albumContours(points: SurveyPoint[]): ContourResult {
  const cached = albumContourCache.get(points)
  if (cached) return cached
  const built = contoursFromSurvey(points)
  albumContourCache.set(points, built)
  return built
}

/**
 * Горизонтали на лист плана.
 *
 * Это единственные горизонтали с известной отметкой: линейная графика рельефа
 * из чертежа приходит без отметок (проверено на обоих реальных объектах — ни
 * кода 38, ни Z у вершин), поэтому подписать её нечем. Выведенные из съёмки
 * подписываются, и каждая пятая проводится утолщённой.
 */
function contourSvg(relief: ContourResult, project: SvgProjector, bounds: Bounds): string {
  if (relief.lines.length === 0) return ''
  const parts: string[] = []
  const labelled: Array<{ x: number; y: number }> = []
  for (const line of relief.lines) {
    for (const fragment of clipPlanPolyline(line.points, bounds)) {
      const projected = fragment.map(project)
      if (projected.length < 2) continue
      parts.push(
        `<polyline data-contour="${line.levelM}" points="${projected
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"`
        + ` fill="none" stroke="#8a6b3d" stroke-width="${line.index ? 1.1 : 0.6}"`
        + ' stroke-linejoin="round" stroke-opacity="0.85"/>',
      )
      if (!line.index || projected.length < 3) continue
      // Подпись ставится на утолщённой горизонтали и разворачивается по её
      // направлению — как на топоплане. Рядом стоящие подписи пропускаются,
      // иначе на пологом участке они слипаются в кашу.
      const middle = projected[Math.floor(projected.length / 2)]
      if (labelled.some((mark) => Math.hypot(mark.x - middle.x, mark.y - middle.y) < 90)) continue
      labelled.push(middle)
      const before = projected[Math.floor(projected.length / 2) - 1]
      let angle = Math.atan2(middle.y - before.y, middle.x - before.x) * 180 / Math.PI
      if (angle > 90 || angle < -90) angle += 180
      parts.push(
        `<g transform="translate(${middle.x.toFixed(1)} ${middle.y.toFixed(1)}) rotate(${angle.toFixed(1)})">`
        + '<rect x="-11" y="-4.5" width="22" height="9" fill="#fff" fill-opacity="0.9"/>'
        + `<text x="0" y="2.5" text-anchor="middle" font-size="6.5" fill="#8a6b3d">${line.levelM.toFixed(2)}</text></g>`,
      )
    }
  }
  return parts.join('')
}

interface LabelBox { x: number; y: number; w: number; h: number }

/**
 * Учёт занятых мест на листе.
 *
 * Подписи размещались вслепую: у труб было разведение по расстоянию, у колодцев
 * — жёсткое чередование сторон, у пикетов ничего. На реальном листе Станкевича
 * это давало наложения — обозначение колодца поверх отметки съёмки, пикет
 * поверх подписи участка. Читать такой чертёж нельзя.
 *
 * Подписи исходной подосновы резервируются первыми: это данные съёмки, и
 * закрывать их своими надписями нельзя.
 */
function labelPlacer() {
  /** Наши подписи: перекрывать друг друга им нельзя. */
  const own: LabelBox[] = []
  /** Подписи подосновы: перекрывать нежелательно, но допустимо. */
  const source: LabelBox[] = []
  const overlaps = (box: LabelBox, list: LabelBox[]) => list.some((other) =>
    box.x < other.x + other.w && other.x < box.x + box.w
    && box.y < other.y + other.h && other.y < box.y + box.h)
  return {
    /**
     * Ставит подпись подосновы, если место свободно.
     *
     * Приоритет обратный прежнему. Раньше подписи съёмки занимали место первыми
     * — «это исходные данные». На листе плана это оказалось неверно: подосновы
     * тысячи подписей, они разбирали лист целиком, и обозначению колодца
     * оставалось наложение. Содержание листа — проектная сеть; отметка съёмки
     * рядом с ней контекст, и уступает она, а не наоборот. Наложения нет ни в
     * какую сторону: не поместилась — снимается.
     */
    placeSource(candidates: LabelBox[]): LabelBox | null {
      for (const box of candidates) {
        if (!overlaps(box, own) && !overlaps(box, source)) { source.push(box); return box }
      }
      return null
    },
    /**
     * Ставит подпись в первое место, не задевающее ничего; если такого нет —
     * в первое, не задевающее наши подписи.
     *
     * Два уровня, потому что обозначение участка и колодца — содержание листа,
     * а отметки подосновы — контекст под ним. Ронять подпись участка ради
     * отметки съёмки нельзя: чертёж без диаметра и длины участка дефектен, а
     * подписи идут на белой подложке и остаются читаемыми поверх.
     */
    place(candidates: LabelBox[]): LabelBox | null {
      for (const box of candidates) {
        if (!overlaps(box, own) && !overlaps(box, source)) { own.push(box); return box }
      }
      for (const box of candidates) {
        if (!overlaps(box, own)) { own.push(box); return box }
      }
      return null
    },
  }
}

function planSvg(
  input: ProjectAlbumInput,
  sheet: WorkingDrawingSheet,
  canvasWidth = 1000,
  svgUnitsPerMm = 1,
): string {
  const window = sheet.window
  if (!window) {
    throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия плана.`)
  }
  const topo = input.surveyPoints.filter((point) =>
    point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY)
  const scene = buildPlanSheetScene({
    sheet,
    drawingSet: input.drawingSet,
    network: input.network,
    schedule: input.schedule,
    pipeDiameterMm: input.pipeDiameterMm,
    pipeDesign: input.pipeDesign,
    buildingLabels: input.buildingLabels,
    constraints: input.constraints,
    surveyPointCountInWindow: topo.length,
  })
  if (!scene) throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия плана.`)
  const sourcePath = scene.sourcePath
  const path = scene.selectedPath
  const axisStart = path[0]
  const axisEnd = path[path.length - 1]
  const windowCorners = [
    { x: window.minX, y: window.minY },
    { x: window.minX, y: window.maxY },
    { x: window.maxX, y: window.minY },
    { x: window.maxX, y: window.maxY },
  ].map((point) => localAxisCoordinates(point, axisStart, axisEnd))
  const localMinX = Math.min(...windowCorners.map((point) => point.x))
  const localMinY = Math.min(...windowCorners.map((point) => point.y))
  const localMaxY = Math.max(...windowCorners.map((point) => point.y))
  const unitsPerMetre = scaleMillimetresPerMetre(PLAN_SCALE_DENOMINATOR) * svgUnitsPerMm
  const project: SvgProjector = (point) => {
    const local = localAxisCoordinates(point, axisStart, axisEnd)
    return {
      x: 45 + (local.x - localMinX) * unitsPerMetre,
      y: 235 - (local.y - (localMinY + localMaxY) / 2) * unitsPerMetre,
    }
  }
  const route = path.map((point) => {
    const projected = project(point)
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
  }).join(' ')
  const linePoints = (points: Array<{ x: number; y: number }>) => points.map((point) => {
    const projected = project(point)
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
  }).join(' ')
  const placer = labelPlacer()
  const fontSize = planFontSize(svgUnitsPerMm)
  /**
   * ЗАМКНУТЫЕ КОНТУРЫ — и только они.
   *
   * Линейной графики здесь больше нет: дороги, водотоки, существующие сети,
   * красные линии, оси и препятствия приходят на лист из `cadContextSvg`, где
   * каждая линия рисуется один раз и в стиле своей роли. Прежде тот же набор
   * выводился ЗДЕСЬ вторым проходом поверх чёрной копии самого себя — отсюда и
   * двойная линия, и лишние чернила.
   *
   * Кольца остаются: разбор чертежа складывает замкнутые контуры зданий, зон и
   * полосы отвода в отдельные наборы, часть из них приходит не из чертежа
   * вовсе (генплан даёт `buildingPolygons`), и заливка/обводка полигона — не то
   * же самое, что ломаная. Линии, ставшие кольцом, `planSourceLines` отсеивает
   * по признаку `closed`, поэтому второго следа не будет и здесь.
   */
  const constraints = [
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('existingBuilding', svgUnitsPerMm)}/>`),
    ...(input.constraints?.buildingPolygons ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('existingBuilding', svgUnitsPerMm)}/>`),
    ...(input.constraints?.parcelRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('topobase', svgUnitsPerMm)}/>`),
    ...(input.constraints?.forbiddenRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('corridor', svgUnitsPerMm)}/>`),
    ...[...(input.constraints?.protectionZoneRings ?? []), ...(input.constraints?.protectionZones ?? [])].map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('corridor', svgUnitsPerMm)}/>`),
    ...[...(input.constraints?.approvedCrossingRings ?? []), ...(input.constraints?.approvedCrossingZones ?? [])].map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('corridor', svgUnitsPerMm)}/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('water', svgUnitsPerMm)}/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('corridor', svgUnitsPerMm)}/>`),
  ].join('')
  const relief = albumContours(input.surveyPoints)
  const contours = contourSvg(relief, project, {
    minX: window.minX,
    maxX: window.maxX,
    minY: window.minY,
    maxY: window.maxY,
  })
  const networkPipes = scene.pipes.map((pipe) => pipe.fragments.map((fragment) => {
    const points = linePoints(fragment)
    // ГОСТ 21.704 п.3.9: видимый проектируемый трубопровод — сплошной толстой
    // основной линией. Неактивная ветвь того же комплекта остаётся тонкой:
    // на этом листе она контекст, а не предмет чертежа.
    const stroke = planStroke(pipe.active ? 'designedPipe' : 'topobase', svgUnitsPerMm)
    return `<polyline data-plan-pipe="${xmlText(pipe.pipeId)}" points="${points}" fill="none" ${stroke} stroke-linejoin="round"/>`
  }).join('')).join('')

  const nodeMarks = scene.nodes.map((node) => {
    const projected = project(node)
    const label = xmlText(node.label)
    const labelWidth = Math.max(28, node.label.length * 5.2)
    const symbol = node.kind === 'source'
      ? `<rect x="${(projected.x - 4).toFixed(1)}" y="${(projected.y - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="#1746b5" stroke-width="2"/>`
      : `<circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="4" fill="#fff" stroke="#1746b5" stroke-width="2"/>`
    // Восемь мест вокруг колодца: справа-сверху, слева-сверху, справа-снизу и
    // так далее. Обозначение колодца обязано остаться на листе, поэтому если
    // свободного места нет, подпись ставится в первое предложенное — лучше
    // наложение, чем неопознанный колодец.
    const candidates = [
      { dx: 8, dy: -22 }, { dx: -labelWidth - 8, dy: -22 },
      { dx: 8, dy: 10 }, { dx: -labelWidth - 8, dy: 10 },
      { dx: 8, dy: -36 }, { dx: -labelWidth - 8, dy: -36 },
      { dx: 8, dy: 24 }, { dx: -labelWidth - 8, dy: 24 },
    ].map((offset) => ({
      x: projected.x + offset.dx, y: projected.y + offset.dy, w: labelWidth, h: 13,
    }))
    // Колодец обязан быть опознан, поэтому при полной тесноте подпись всё
    // равно ставится в первое предложенное место.
    const box = placer.place(candidates) ?? candidates[0]
    const leaderY = box.y + (box.y < projected.y ? 13 : 0)
    return `<g data-plan-node="${xmlText(node.id)}">${symbol}<path d="M${projected.x.toFixed(1)} ${projected.y.toFixed(1)}L${(box.x + labelWidth / 2).toFixed(1)} ${leaderY.toFixed(1)}" stroke="#333" stroke-width="0.7"/><rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${labelWidth.toFixed(1)}" height="13" fill="#fff" stroke="#555" stroke-width="0.6"/><text x="${(box.x + 3).toFixed(1)}" y="${(box.y + 9).toFixed(1)}" font-size="7.5">${label}</text></g>`
  }).join('')
  const pipeLabels = scene.pipes.map((pipe) => {
    const projected = project(pipe.labelPoint)
    const w = Math.max(44, pipe.label.length * 4.6)
    // Подпись повёрнута вдоль трубы, поэтому занимает габарит повёрнутого
    // прямоугольника, а не квадрат по большей стороне: у вертикального участка
    // это полоса 13 × 44, и квадрат 44 × 44 отнимал бы у обозначения колодца
    // всё место вокруг.
    const radians = pipe.labelAngleDeg * Math.PI / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))
    const boxW = w * cos + 13 * sin
    const boxH = w * sin + 13 * cos
    // Подпись участка несёт диаметр, уклон и длину — без неё лист дефектен,
    // поэтому при полной тесноте она ставится поверх подосновы, на белой
    // подложке.
    const candidates = [-8, 13, -24, 29, -40, 45].map((dy) => ({
      x: projected.x - boxW / 2, y: projected.y + dy - boxH / 2, w: boxW, h: boxH,
    }))
    const box = placer.place(candidates) ?? candidates[0]
    const dy = box.y + boxH / 2 - projected.y
    return `<g data-plan-pipe-label="${xmlText(pipe.pipeId)}" transform="translate(${projected.x.toFixed(1)} ${(projected.y + dy).toFixed(1)}) rotate(${-pipe.labelAngleDeg.toFixed(2)})"><rect x="-3" y="-9" width="${w.toFixed(1)}" height="13" fill="#fff" fill-opacity="0.9" stroke="#1746b5" stroke-width="0.5"/><text x="1" y="0" font-size="7.5" fill="#1746b5">${xmlText(pipe.label)}</text></g>`
  }).join('')

  const stationMarks = scene.stations.map((station) => {
    const projected = project(station)
    const matchLine = station.boundary
      ? `<line x1="${projected.x.toFixed(1)}" y1="55" x2="${projected.x.toFixed(1)}" y2="425" stroke="#d33" stroke-width="0.8" stroke-dasharray="5 4"/>`
      : ''
    const mark = `${matchLine}<g data-plan-station="${station.chainageM.toFixed(2)}"><line x1="${projected.x.toFixed(1)}" y1="${(projected.y - 6).toFixed(1)}" x2="${projected.x.toFixed(1)}" y2="${(projected.y + 6).toFixed(1)}" stroke="#111" stroke-width="0.8"/><circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="2.2" fill="#fff" stroke="#1746b5"/>`
    // Штрих пикета остаётся всегда, подпись — только если для неё есть место:
    // пикетаж читается и по соседним подписям, а мешанина не читается вовсе.
    const width = Math.max(24, station.label.length * 4.6)
    const box = placer.place([
      { x: projected.x + 4, y: projected.y - 15, w: width, h: 10 },
      { x: projected.x - width - 4, y: projected.y - 15, w: width, h: 10 },
      { x: projected.x + 4, y: projected.y + 6, w: width, h: 10 },
      { x: projected.x - width - 4, y: projected.y + 6, w: width, h: 10 },
    ])
    if (box === null) return `${mark}</g>`
    return `${mark}<text x="${box.x.toFixed(1)}" y="${(box.y + 8).toFixed(1)}" font-size="7.5" font-weight="700">${xmlText(station.label)}</text></g>`
  }).join('')

  // Отметки съёмки и подписи подосновы считаются ПОСЛЕ проектных: место сначала
  // занимает содержание листа, а контекст встаёт в оставшееся. Порядок вывода в
  // разметке обратный — подоснова уходит под проектную графику.
  let hiddenSurveyLabels = 0
  let shownSurveyLabels = 0
  const surveyDotRadius = Math.max(0.2, 0.25 * svgUnitsPerMm)
  const topoSvg = topo.map((point) => {
    const projected = project(point)
    const text = point.z.toFixed(2)
    const w = text.length * fontSize * 0.55
    const h = fontSize * 1.25
    const box = placer.placeSource([
      { x: projected.x + surveyDotRadius * 2, y: projected.y - h, w, h },
      { x: projected.x - w - surveyDotRadius * 2, y: projected.y - h, w, h },
      { x: projected.x + surveyDotRadius * 2, y: projected.y, w, h },
      { x: projected.x - w - surveyDotRadius * 2, y: projected.y, w, h },
    ])
    if (box === null) hiddenSurveyLabels += 1
    else shownSurveyLabels += 1
    const label = box === null
      ? ''
      : `<text x="${box.x.toFixed(1)}" y="${(box.y + h * 0.8).toFixed(1)}" font-size="${fontSize.toFixed(2)}" fill="${planColour('topobase')}">${text}</text>`
    return `<circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="${surveyDotRadius.toFixed(2)}" fill="${planColour('topobase')}"/>${label}`
  }).join('')
  const context = cadContextSvg(input.constraints, project, {
    minX: window.minX,
    maxX: window.maxX,
    minY: window.minY,
    maxY: window.maxY,
  }, svgUnitsPerMm, placer, {
    // Поле чертежа — тот же прямоугольник, что задан обрезкой `work-…` ниже.
    // Одно число в двух местах разъезжается, поэтому оно объявлено один раз.
    field: { minX: PLAN_FIELD.x, maxX: canvasWidth - PLAN_FIELD.x, minY: PLAN_FIELD.y, maxY: PLAN_FIELD.y + PLAN_FIELD.height },
  })

  const missingContext = scene.hasPlanContext ? '' : `<g data-plan-context-missing="true"><rect x="${(canvasWidth / 2 - 170).toFixed(1)}" y="27" width="340" height="30" fill="#fff4dc" stroke="#c07800" stroke-width="1.2"/><text x="${(canvasWidth / 2).toFixed(1)}" y="40" text-anchor="middle" font-size="9" font-weight="700" fill="#8a4c00">НЕПОЛНЫЙ ПЛАН: топографическая/CAD-подоснова отсутствует</text><text x="${(canvasWidth / 2).toFixed(1)}" y="51" text-anchor="middle" font-size="7" fill="#8a4c00">Показана расчётная сеть; финальный выпуск должен оставаться заблокированным</text></g>`
  const overview = sourcePath
  const minX = Math.min(...overview.map((point) => point.x))
  const maxX = Math.max(...overview.map((point) => point.x))
  const minY = Math.min(...overview.map((point) => point.y))
  const maxY = Math.max(...overview.map((point) => point.y))
  const overviewScale = Math.min(135 / Math.max(maxX - minX, 1), 78 / Math.max(maxY - minY, 1))
  const ox = (value: number) => canvasWidth - 175 + (value - minX) * overviewScale
  const oy = (value: number) => 110 - (value - minY) * overviewScale
  const axisRotationDeg = Math.atan2(axisEnd.y - axisStart.y, axisEnd.x - axisStart.x) * 180 / Math.PI

  /**
   * Врезка положения листа.
   *
   * Показывает ВСЮ трассу и прямоугольник границ текущего листа: инженер по
   * ней понимает, какой кусок объекта перед ним. Прежде во врезке была только
   * ломаная текущего участка — по ней положение читается плохо, а подосновы не
   * было вовсе.
   *
   * Подоснова во врезке прорежена жёстко: она здесь фон, а не чертёж, и полные
   * четырнадцать тысяч линий сделали бы её чёрным пятном.
   */
  const insetBounds = {
    minX: Math.min(...path.map((point) => point.x)),
    maxX: Math.max(...path.map((point) => point.x)),
    minY: Math.min(...path.map((point) => point.y)),
    maxY: Math.max(...path.map((point) => point.y)),
  }
  const INSET_CONTEXT_LIMIT = 400
  const insetSource = input.constraints?.cadContextLines ?? []
  const insetStride = Math.max(1, Math.ceil(insetSource.length / INSET_CONTEXT_LIMIT))
  const insetContext = insetSource
    .filter((_, index) => index % insetStride === 0)
    .map((line) => line.points)
    .filter((points) => points.length >= 2)
    .map((points) => `<polyline points="${points.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#dcdcdc" stroke-width="0.4"/>`)
    .join('')
  /**
   * Условные обозначения — по факту листа.
   *
   * Проектная графика (ось, нитка, горизонтали) объявляется здесь: она рождается
   * на листе, а не приходит с чертежа. Роли подосновы берутся из счётчиков
   * `cadContextSvg`, то есть из того, что реально попало на лист после
   * прореживания. Роль, у которой не осталось ни одной линии, в обозначения не
   * попадает.
   */
  const legend = planLegendSvg([
    'routeAxis',
    'designedPipe',
    ...context.roles.filter((item) => item.drawn > 0).map((item) => item.role),
  ], svgUnitsPerMm, [
    { symbol: (x, y) => `<circle cx="${(x + 11).toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#fff" stroke="#1746b5"/>`, label: 'колодец / камера' },
    { symbol: (x, y) => `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 22).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#d33" stroke-dasharray="5 4"/>`, label: 'граница листа' },
    // Горизонталь названа вместе с сечением: без сечения обозначение не
    // читается. Стиль берётся из той же таблицы, что и сама линия.
    ...(relief.lines.length > 0
      ? [{
        symbol: (x: number, y: number) =>
          `<line data-legend-role="contour" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 22).toFixed(1)}" y2="${y.toFixed(1)}" ${planStroke('contour', svgUnitsPerMm)}/>`,
        label: `горизонтали, сечение ${relief.stepM} м`,
      }]
      : []),
  ])
  const insetFrame = `<rect data-inset-sheet-bounds="true" x="${Math.min(ox(insetBounds.minX), ox(insetBounds.maxX)).toFixed(1)}" y="${Math.min(oy(insetBounds.minY), oy(insetBounds.maxY)).toFixed(1)}" width="${Math.max(2, Math.abs(ox(insetBounds.maxX) - ox(insetBounds.minX))).toFixed(1)}" height="${Math.max(2, Math.abs(oy(insetBounds.maxY) - oy(insetBounds.minY))).toFixed(1)}" fill="none" stroke="#d33" stroke-width="1.2" stroke-dasharray="3 2"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} 500" data-horizontal-scale-denominator="${PLAN_SCALE_DENOMINATOR}" data-horizontal-mm-per-meter="${scaleMillimetresPerMetre(PLAN_SCALE_DENOMINATOR)}" data-svg-units-per-mm="${svgUnitsPerMm}" data-local-axis-rotation-deg="${axisRotationDeg.toFixed(6)}"><defs><clipPath id="work-${sheet.sheetNumber}"><rect x="${PLAN_FIELD.x}" y="${PLAN_FIELD.y}" width="${canvasWidth - 2 * PLAN_FIELD.x}" height="${PLAN_FIELD.height}"/></clipPath></defs><rect width="${canvasWidth}" height="500" fill="#fff"/><rect x="${PLAN_FIELD.x}" y="${PLAN_FIELD.y}" width="${canvasWidth - 2 * PLAN_FIELD.x}" height="${PLAN_FIELD.height}" fill="none" ${planStroke('sheetFrame', svgUnitsPerMm)}/><g clip-path="url(#work-${sheet.sheetNumber})">${context.svg}${constraints}${contours}${topoSvg}${networkPipes}<polyline data-plan-route="true" points="${route}" fill="none" ${planStroke('routeAxis', svgUnitsPerMm)} stroke-linejoin="round"/>${stationMarks}${nodeMarks}${pipeLabels}</g>${missingContext}<g transform="translate(55 45)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><g transform="translate(0 -20)"><rect x="${canvasWidth - 190}" y="35" width="150" height="90" fill="#fff" stroke="#111"/>${insetContext}<polyline points="${overview.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#999" stroke-width="1"/><polyline points="${path.map((point) => `${ox(point.x).toFixed(1)},${oy(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#1746b5" stroke-width="3"/>${insetFrame}<text x="${canvasWidth - 183}" y="120" font-size="7">Положение листа</text></g><g transform="translate(42 402)">${legend}</g><text x="40" y="478" font-size="8">Основание: ${scene.contextFeatureCount} объектов CAD/топоподосновы; ${topo.length} отметок в окне; ${scene.pipes.length} участков сети. ${relief.lines.length > 0 ? `Горизонтали через ${relief.stepM} м выведены по ${input.surveyPoints.length} отметкам съёмки.` : xmlText(relief.reason)} Масштаб 1:${PLAN_SCALE_DENOMINATOR}. Подписи: отметок съёмки ${shownSurveyLabels} из ${topo.length}, подосновы ${context.shownLabels}; снято из-за тесноты ${hiddenSurveyLabels + context.hiddenLabels}. Шрифт ${PLAN_TEXT_HEIGHT_MM} мм.</text><text x="40" y="490" font-size="8">${xmlText(contextNote(context))}</text></svg>`
}

function networkPlanSvg(input: ProjectAlbumInput, sheet: WorkingDrawingSheet): string {
  const networkPaths = input.drawingSet.networkPaths
  const routePoints = networkPaths.flatMap((path) => path.points)
  if (routePoints.length < 2) throw new Error(`Лист ${sheet.sheetNumber}: отсутствует подтверждённая геометрия сети.`)
  // Fit to the confirmed network, not to remote DWG frames/title blocks.
  // Context is clipped to this engineering viewport below.
  const rawMinX = Math.min(...routePoints.map((point) => point.x))
  const rawMaxX = Math.max(...routePoints.map((point) => point.x))
  const rawMinY = Math.min(...routePoints.map((point) => point.y))
  const rawMaxY = Math.max(...routePoints.map((point) => point.y))
  const margin = Math.max(Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY) * 0.04, 60)
  const minX = rawMinX - margin
  const maxX = rawMaxX + margin
  const minY = rawMinY - margin
  const maxY = rawMaxY + margin
  const scale = Math.min(900 / Math.max(maxX - minX, 1), 410 / Math.max(maxY - minY, 1))
  const x = (value: number) => 45 + (value - minX) * scale
  const y = (value: number) => 445 - (value - minY) * scale
  const project: SvgProjector = (point) => ({ x: x(point.x), y: y(point.y) })
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`)
    .join(' ')
  /**
   * Сводный план сети — та же подоснова и те же стили, что у рабочего листа.
   *
   * Здесь был ТРЕТИЙ набор цветов, набранный руками: сеть фиолетовой штриховой
   * (#9b2c8c), дороги коричневыми (#8b734f), красная линия #d22. Ни один из них
   * не совпадал ни с измеренной таблицей, ни с рабочим листом того же альбома:
   * одна и та же линия меняла цвет от листа к листу. Линейная графика теперь
   * приходит из `cadContextSvg`, кольца остаются здесь — с заливкой, которая
   * на обзорном листе читается лучше обводки.
   */
  // Сводный план обрезки не имеет: поле чертежа — весь холст, и отбор идёт по
  // нему же, чтобы линия, вышедшая за габарит сети, не пропала с обзорного листа.
  const context = cadContextSvg(input.constraints, project, { minX, maxX, minY, maxY }, 1, null, {
    field: { minX: 0, maxX: 1000, minY: 0, maxY: 500 },
  })
  const constraints = [
    context.svg,
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#e2e2e2" ${planStroke('existingBuilding', 1)}/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d8f1f8" ${planStroke('water', 1)}/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" ${planStroke('corridor', 1)}/>`),
  ].join('')
  const topo = input.surveyPoints.filter((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
  const topoStride = Math.max(1, Math.ceil(topo.length / 420))
  const topoSvg = topo.filter((_, index) => index % topoStride === 0)
    .map((point) => `<circle cx="${x(point.x).toFixed(1)}" cy="${y(point.y).toFixed(1)}" r="1" fill="#777"/>`)
    .join('')
  let lastLabel: { x: number; y: number; diameterMm?: number } | null = null
  const minimumLabelDistance = 72
  const networkSvg = networkPaths.map((path, index) => {
    const middle = path.points[Math.floor(path.points.length / 2)]
    const diameter = input.pipeDiameterMm.get(path.pipeId)
    const labelX = x(middle.x)
    const labelY = y(middle.y)
    const distanceFromLastLabel = lastLabel ? Math.hypot(labelX - lastLabel.x, labelY - lastLabel.y) : Number.POSITIVE_INFINITY
    const diameterChanged = lastLabel !== null && diameter !== lastLabel.diameterMm
    const showLabel = index === 0 || diameterChanged || distanceFromLastLabel >= minimumLabelDistance
    if (showLabel) lastLabel = { x: labelX, y: labelY, diameterMm: diameter }
    const label = showLabel
      ? `<text data-network-label="true" x="${(labelX + 5).toFixed(1)}" y="${(labelY - 5).toFixed(1)}" font-size="8" fill="#1746b5">${xmlText(path.pipeId)}${diameter ? ` · Ø${diameter}` : ''}</text>`
      : ''
    return `<polyline data-network-pipe="${xmlText(path.pipeId)}" points="${linePoints(path.points)}" fill="none" stroke="#1746b5" stroke-width="4" stroke-linejoin="round"/>${label}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><defs><clipPath id="network-${sheet.sequence}"><rect x="35" y="15" width="930" height="445"/></clipPath></defs><rect width="1000" height="500" fill="#fff"/><rect x="35" y="15" width="930" height="445" fill="none" stroke="#111"/><g clip-path="url(#network-${sheet.sequence})">${constraints}${topoSvg}${networkSvg}</g><g transform="translate(55 45)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><text x="40" y="485" font-size="8">Сводный план построен по ${networkPaths.length} подтверждённым полилиниям сети; прямые хорды не используются в финальном выпуске.</text></svg>`
}

function profileStationAt(profile: GravityProfile, chainageM: number) {
  const exact = profile.stations.find((station) => Math.abs(station.chainageM - chainageM) <= 1e-6)
  if (exact) return { ...exact }
  if (chainageM <= profile.stations[0].chainageM) return { ...profile.stations[0], chainageM }
  for (let index = 1; index < profile.stations.length; index++) {
    const b = profile.stations[index]
    if (b.chainageM >= chainageM) {
      const a = profile.stations[index - 1]
      const ratio = (chainageM - a.chainageM) / Math.max(b.chainageM - a.chainageM, 1e-9)
      return {
        ...a,
        nodeId: `${a.nodeId}:${b.nodeId}:${chainageM}`,
        chainageM,
        groundElevationM: a.groundElevationM + (b.groundElevationM - a.groundElevationM) * ratio,
        invertElevationM: a.invertElevationM + (b.invertElevationM - a.invertElevationM) * ratio,
        depthM: a.depthM + (b.depthM - a.depthM) * ratio,
        diameterMm: ratio < 0.5 ? a.diameterMm : b.diameterMm,
      }
    }
  }
  return { ...profile.stations[profile.stations.length - 1], chainageM }
}

function nearestPathProjection(
  path: PathPoint[],
  x: number,
  y: number,
): { chainageM: number; distanceM: number } | null {
  if (path.length < 2) return null
  let nearest: { distance: number; chainageM: number } | null = null
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]
    const b = path[index]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const ratio = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared))
    const projectedX = a.x + ratio * dx
    const projectedY = a.y + ratio * dy
    const distance = Math.hypot(x - projectedX, y - projectedY)
    const chainageM = a.chainageM + ratio * (b.chainageM - a.chainageM)
    if (!nearest || distance < nearest.distance) nearest = { distance, chainageM }
  }
  return nearest ? { chainageM: nearest.chainageM, distanceM: nearest.distance } : null
}

function boreholeProfileProjection(
  input: ProjectAlbumInput,
  borehole: Borehole,
  profilePath: PathPoint[],
): { chainageM: number; distanceM: number } | null {
  const maxOffsetM = input.geologyMaxOffsetM
  if (!Number.isFinite(maxOffsetM) || Number(maxOffsetM) <= 0) return null
  if (!Number.isFinite(borehole.x) || !Number.isFinite(borehole.y) || borehole.layers.length === 0) return null
  const projection = nearestPathProjection(profilePath, borehole.x!, borehole.y!)
  if (!projection || projection.distanceM > Number(maxOffsetM) + 1e-9) return null
  return projection
}

function profilePlanPath(input: ProjectAlbumInput, sheet: WorkingDrawingSheet, profile: GravityProfile): PathPoint[] {
  const expectedId = sheet.profileId ? `branch:${sheet.profileId}` : 'main'
  const exact = input.drawingSet.planPaths.find((path) => path.id === expectedId)
  if (exact?.points.length && exact.points.length >= 2) return exact.points

  const profilePipeIds = new Set(profile.pipeIds)
  const matching = input.drawingSet.planPaths.filter((path) => (
    path.points.length >= 2
    && path.pipeIds.length === profilePipeIds.size
    && path.pipeIds.every((pipeId) => profilePipeIds.has(pipeId))
  ))
  if (matching.length === 1) return matching[0].points
  // Legacy sets did not expose planPaths; only the governing main profile may
  // use their mainPath. A branch must never borrow main-profile geometry.
  return sheet.profileId ? [] : input.drawingSet.mainPath
}

export function crossingBelongsToProfile(
  crossing: CrossingRecord,
  profileId: string | undefined,
  pipeIds: readonly string[],
): boolean {
  const taggedByProfile = Boolean(crossing.profileId)
  const taggedByPipe = Boolean(crossing.pipeId)
  if (!taggedByProfile && !taggedByPipe) return profileId === undefined
  const activeProfileId = profileId ?? 'main'
  if (taggedByProfile && crossing.profileId !== activeProfileId) return false
  if (taggedByPipe && !pipeIds.includes(crossing.pipeId!)) return false
  return true
}

function profileCrossings(input: ProjectAlbumInput, sheet: WorkingDrawingSheet, profile: GravityProfile): CrossingRecord[] {
  return (input.constraints?.crossings ?? []).filter((crossing) => (
    crossingBelongsToProfile(crossing, sheet.profileId, profile.pipeIds)
  ))
}

function profileSvg(
  input: ProjectAlbumInput,
  sheet: WorkingDrawingSheet,
  canvasWidth = 1000,
  svgUnitsPerMm = 1,
): string {
  const profile = sheet.profileData ?? input.profile
  const fromM = sheet.interval?.fromM ?? 0
  const toM = sheet.interval?.toM ?? profile.totalLengthM
  const stations = [
    profileStationAt(profile, fromM),
    ...profile.stations.filter((station) => station.chainageM > fromM && station.chainageM < toM),
    profileStationAt(profile, toM),
  ]
  if (stations.length < 2) throw new Error(`Лист ${sheet.sheetNumber}: недостаточно станций профиля.`)
  const profilePath = profilePlanPath(input, sheet, profile)
  const activeCrossings = profileCrossings(input, sheet, profile)
    .filter((crossing) => crossing.stationM >= fromM && crossing.stationM <= toM)
  const activeBoreholes = (input.boreholes ?? []).flatMap((borehole) => {
    if (!Number.isFinite(borehole.mouthElevationM)) return []
    const projection = boreholeProfileProjection(input, borehole, profilePath)
    if (!projection || projection.chainageM < fromM || projection.chainageM > toM) return []
    return [{ borehole, projection }]
  })
  // Диапазон условного горизонта считается по станциям профиля. Пересечения
  // и колонки скважин, выходящие за полосу, обрезаются рамкой чертежа: их
  // включение в подбор базы дробило бы лист на десятки горизонтов.
  const horizontalUnitsPerMetre = scaleMillimetresPerMetre(PROFILE_HORIZONTAL_SCALE_DENOMINATOR) * svgUnitsPerMm
  const fieldHeightMm = PROFILE_FIELD_TO_MM - PROFILE_FIELD_FROM_MM
  // Перепад, который лист обязан вместить: самая высокая и самая низкая точка
  // всех станций плюс метр на базу условного горизонта.
  const requiredSpanM = stations.reduce((span, station) => Math.max(
    span,
    Math.abs(station.groundElevationM - station.invertElevationM),
  ), 0) + 1
  const verticalDenominator = PROFILE_VERTICAL_SCALE_DENOMINATORS
    .find((denominator) => fieldHeightMm * denominator / 1000 >= requiredSpanM)
    ?? PROFILE_VERTICAL_SCALE_DENOMINATORS[PROFILE_VERTICAL_SCALE_DENOMINATORS.length - 1]
  const verticalUnitsPerMetre = scaleMillimetresPerMetre(verticalDenominator) * svgUnitsPerMm
  const x = (chainageM: number) => 185 + (chainageM - fromM) * horizontalUnitsPerMetre
  if (x(toM) > canvasWidth - 35 + 1e-6) {
    throw new Error(`Лист ${sheet.sheetNumber}: ширины рулонного листа недостаточно для масштаба профиля 1:${PROFILE_HORIZONTAL_SCALE_DENOMINATOR}.`)
  }

  /**
   * Смена условного горизонта внутри листа.
   *
   * Высота рулонного листа постоянна (297 мм у эталона), а вертикальный
   * масштаб — 1:100, поэтому графическая полоса вмещает ограниченный перепад
   * отметок. Когда трасса выходит за него, чертёж НЕ растягивают и лист не
   * растят: базовая отметка ступенью переходит на новую круглую величину,
   * линия профиля разрывается вертикальным скачком, и рядом подписывается
   * новый условный горизонт. Это обычный приём продольного профиля.
   *
   * Базы кратны пяти метрам — так они читаются и так подписаны у эталона
   * (330, 333, 335 на разных листах его альбома).
   */
  // Поле чертежа задаётся в миллиметрах от нижней кромки листа, а не числами по
  // месту: у эталона оно 115…244 мм, и переносить эти границы в единицы холста
  // должен один пересчёт, иначе при другой высоте листа полоса разъедется.
  const across = (millimetresFromBottom: number) => 500 - millimetresFromBottom * svgUnitsPerMm
  const fieldBottom = across(PROFILE_FIELD_FROM_MM)
  const fieldTop = across(PROFILE_FIELD_TO_MM)
  const bandMetres = (fieldBottom - fieldTop) / verticalUnitsPerMetre
  const DATUM_STEP_M = 5
  const roundDatum = (elevationM: number) => Math.floor(elevationM / DATUM_STEP_M) * DATUM_STEP_M
  type DatumSegment = {
    fromM: number; toM: number; datumM: number; lowM: number; highM: number; stations: typeof stations
  }
  const segments: DatumSegment[] = []
  for (const station of stations) {
    const low = Math.min(station.invertElevationM, station.groundElevationM)
    const high = Math.max(station.invertElevationM, station.groundElevationM)
    const current = segments[segments.length - 1]
    if (current !== undefined) {
      // База берётся по САМОЙ НИЗКОЙ точке участка, а не по первой станции:
      // иначе нисходящий профиль выпадал бы из полосы на второй же станции и
      // горизонт менялся бы там, где перепад ещё помещается.
      const lowM = Math.min(current.lowM, low)
      const highM = Math.max(current.highM, high)
      if (highM - roundDatum(lowM - 1) <= bandMetres + 1e-9) {
        current.toM = station.chainageM
        current.lowM = lowM
        current.highM = highM
        current.datumM = roundDatum(lowM - 1)
        current.stations.push(station)
        continue
      }
    }
    segments.push({
      fromM: station.chainageM,
      toM: station.chainageM,
      datumM: roundDatum(low - 1),
      lowM: low,
      highM: high,
      stations: [station],
    })
  }
  const datumAt = (chainageM: number) => {
    for (const segment of segments) {
      if (chainageM >= segment.fromM - 1e-9 && chainageM <= segment.toM + 1e-9) return segment.datumM
    }
    return segments[0]?.datumM ?? 0
  }
  const y = (elevationM: number, chainageM: number) =>
    fieldBottom - (elevationM - datumAt(chainageM)) * verticalUnitsPerMetre

  // Каждый сегмент — своя ломаная: разрыв между ними и есть скачок горизонта.
  const polyline = (pick: (station: typeof stations[number]) => number) => segments
    .map((segment) => segment.stations
      .map((station) => `${x(station.chainageM).toFixed(1)},${y(pick(station), station.chainageM).toFixed(1)}`)
      .join(' '))
    .filter((points) => points.trim() !== '')
  const ground = polyline((station) => station.groundElevationM)
  const invert = polyline((station) => station.invertElevationM)
  const datumMarks = segments.map((segment) => {
    const markX = x(segment.fromM)
    return `<line data-datum-break="true" x1="${markX.toFixed(1)}" y1="${fieldTop.toFixed(1)}" x2="${markX.toFixed(1)}" y2="${fieldBottom.toFixed(1)}" stroke="#c07800" stroke-width="0.8" stroke-dasharray="4 3"/>`
      + `<text data-datum-label="true" x="${(markX + 3).toFixed(1)}" y="${(fieldTop + 11).toFixed(1)}" font-size="7" fill="#8a4c00">УГ ${segment.datumM.toFixed(2)}</text>`
  }).join('')
  const manholeByNodeId = new Map(input.schedule.manholes.flatMap((manhole) => (
    manhole.nodeId ? [[manhole.nodeId, manhole.label] as const] : []
  )))
  /**
   * Значения боковика.
   *
   * Формат записи взят у эталона: отметки и расстояния — с запятой, отметки с
   * двумя знаками, расстояния с одним, уклон с одним. Значения — наши, из
   * расчёта профиля; из эталона взято только КАК их писать.
   */
  const decimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',')
  const rowBounds = new Map(PROFILE_SIDEBAR_ROWS.map((row) => [row.title || `пусто-${row.fromMm}`, {
    top: across(row.toMm), bottom: across(row.fromMm), middle: across((row.fromMm + row.toMm) / 2),
  }]))
  const sidebarFont = PROFILE_TEXT_HEIGHT_MM * svgUnitsPerMm
  const at = (title: string) => rowBounds.get(title)!
  const cell = (title: string, centreX: number, text: string, vertical: boolean) => {
    const bounds = at(title)
    const baseline = bounds.middle + sidebarFont * 0.35
    if (!vertical) {
      return `<text data-sidebar-row="${xmlText(title)}" x="${centreX.toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="middle" font-size="${sidebarFont.toFixed(2)}">${xmlText(text)}</text>`
    }
    // Отметки в трёх нижних графах эталона стоят поперёк графы — оттого эти
    // графы и втрое выше остальных.
    return `<text data-sidebar-row="${xmlText(title)}" transform="translate(${centreX.toFixed(1)} ${(bounds.bottom - 2).toFixed(1)}) rotate(-90)" x="0" y="${(sidebarFont * 0.35).toFixed(1)}" font-size="${sidebarFont.toFixed(2)}">${xmlText(text)}</text>`
  }
  const columns = stations.map((station) => {
    const stationX = x(station.chainageM)
    const label = manholeByNodeId.get(station.nodeId) ?? station.nodeId
    // Ордината: от низа боковика до линии лотка. У эталона она сквозная по
    // всем графам и обрывается на чертеже, а не рисуется постоянным шагом —
    // ординаты стоят на колодцах и пикетах, потому что графы привязаны к ним.
    return `<line data-profile-ordinate="${station.chainageM.toFixed(2)}" x1="${stationX.toFixed(1)}" y1="${y(station.invertElevationM, station.chainageM).toFixed(1)}" x2="${stationX.toFixed(1)}" y2="${across(PROFILE_SIDEBAR_ROWS[0].fromMm).toFixed(1)}" stroke="#111" stroke-width="0.4"/>`
      + cell('Пикеты', stationX, picket(station.chainageM), false)
      + cell('Номер колодца, точки, угла поворота', stationX, String(label), false)
      + cell('Натурная отметка земли, м', stationX, decimal(station.groundElevationM, 2), true)
      // Проектной отметки земли у нас нет — вертикальная планировка не наша
      // часть. У эталона в этой графе стоит прочерк, и он же стоит здесь.
      + cell('Проектная отметка земли, м', stationX, '-', true)
      + cell('Проектная отметка низа трубы или низа лотка колодца, м', stationX, decimal(station.invertElevationM, 2), true)
  }).join('')
  /**
   * Целые пикеты подписываются каждые 100 м.
   *
   * Измерено по эталону, стр. 34: в графе «Пикеты» стоят ПК 9, ПК 10 … ПК 15 с
   * шагом 566,5 pt = 200 мм = 100 м при 1:500, и отдельно — положения колодцев
   * форматом ПК10+10.53. Прежде наш лист подписывал только станции, и пикетаж
   * между колодцами читать было не по чему.
   */
  const wholePickets: string[] = []
  for (let metre = Math.ceil(fromM / 100) * 100; metre <= toM + 1e-9; metre += 100) {
    const picketX = x(metre)
    wholePickets.push(
      `<line data-profile-picket="${metre}" x1="${picketX.toFixed(1)}" y1="${across(PROFILE_SIDEBAR_ROWS[0].toMm).toFixed(1)}" x2="${picketX.toFixed(1)}" y2="${across(PROFILE_SIDEBAR_ROWS[0].fromMm).toFixed(1)}" stroke="#111" stroke-width="0.4"/>`
      + cell('Пикеты', picketX, `ПК ${metre / 100}`, false),
    )
  }
  const segmentValues = stations.slice(1).map((station, index) => {
    const previous = stations[index]
    const lengthM = Math.max(station.chainageM - previous.chainageM, 0)
    const slopePermille = lengthM > 0 ? ((previous.invertElevationM - station.invertElevationM) / lengthM) * 1000 : 0
    const centreX = x((previous.chainageM + station.chainageM) / 2)
    const slopeRow = at('Уклон, ‰; длина, м')
    return cell('Расстояние, м', centreX, decimal(lengthM, 1), false)
      // Графа уклона несёт две величины: у эталона уклон и длина стоят в одной
      // полосе на разной высоте, разделённые чертой.
      + `<text data-sidebar-row="Уклон, ‰; длина, м" x="${centreX.toFixed(1)}" y="${(slopeRow.top + sidebarFont).toFixed(1)}" text-anchor="middle" font-size="${sidebarFont.toFixed(2)}">${decimal(slopePermille, 1)}</text>`
      + `<line x1="${(centreX - sidebarFont).toFixed(1)}" y1="${slopeRow.middle.toFixed(1)}" x2="${(centreX + sidebarFont).toFixed(1)}" y2="${slopeRow.middle.toFixed(1)}" stroke="#111" stroke-width="0.4"/>`
      + `<text data-sidebar-row="Уклон, ‰; длина, м" x="${centreX.toFixed(1)}" y="${(slopeRow.bottom - sidebarFont * 0.3).toFixed(1)}" text-anchor="middle" font-size="${sidebarFont.toFixed(2)}">${decimal(lengthM, 1)}</text>`
      + cell('Обозначение трубы и тип изоляции', centreX, `∅${station.diameterMm} L=${decimal(lengthM, 1)} м`, false)
  }).join('')
  // Выноски пересечений разводятся по ярусам.
  //
  // Обе строки писались на постоянной высоте, поэтому на плотном участке
  // соседние выноски накладывались: на профиле Станкевича 36 пересечений
  // сливались в нечитаемую полосу. Ярусы — обычный приём профиля: подпись
  // отъезжает вверх по своей же выносной линии.
  const crossingPlacer = labelPlacer()
  const crossings = activeCrossings
    .map((crossing) => {
      const crossingX = x(crossing.stationM)
      const designY = Number.isFinite(crossing.designInvertElevationM) ? y(crossing.designInvertElevationM!, crossing.stationM) : fieldBottom - 15
      const existingY = Number.isFinite(crossing.existingElevationM) ? y(crossing.existingElevationM!, crossing.stationM) : fieldTop + 30
      const title = `${crossing.id} · ${crossing.kind}`
      const clearance = `просвет ${Number.isFinite(crossing.clearanceM) ? crossing.clearanceM!.toFixed(2) + ' м' : 'нет данных'}`
      const width = Math.max(title.length, clearance.length) * 3.5 + 6
      const lanes = [0, 1, 2, 3, 4, 5].map((lane) => fieldTop + 13 + lane * 24)
      const candidates = lanes.map((top) => ({ x: crossingX + 5, y: top, w: width, h: 22 }))
      const box = crossingPlacer.place(candidates) ?? candidates[0]
      return `<line x1="${crossingX}" y1="45" x2="${crossingX}" y2="335" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="5 4"/>`
        + `<circle cx="${crossingX}" cy="${designY}" r="4" fill="#fff" stroke="#9b2c8c"/>`
        + `<path d="M${crossingX - 5} ${existingY} L${crossingX + 5} ${existingY}" stroke="#9b2c8c" stroke-width="2"/>`
        // Белая подложка под ярусом: выносные линии соседних пересечений
        // проходят сквозь подпись и без неё её не прочесть.
        + `<rect x="${(box.x - 2).toFixed(1)}" y="${(box.y - 1).toFixed(1)}" width="${width.toFixed(1)}" height="21" fill="#fff" fill-opacity="0.88"/>`
        + `<text x="${box.x.toFixed(1)}" y="${(box.y + 7).toFixed(1)}" font-size="7" fill="#7c226f">${xmlText(title)}</text>`
        + `<text x="${box.x.toFixed(1)}" y="${(box.y + 18).toFixed(1)}" font-size="7" fill="#7c226f">${xmlText(clearance)}</text>`
    }).join('')
  const geology = activeBoreholes.flatMap(({ borehole, projection }) => {
    const chainageM = projection.chainageM
    const boreholeX = x(chainageM)
    const mouthElevationM = borehole.mouthElevationM!
    const deepest = Math.max(...borehole.layers.map((layer) => layer.bottomDepthM))
    const layerLines = borehole.layers.map((layer) => {
      const boundaryY = y(mouthElevationM - layer.bottomDepthM, chainageM)
      const middleY = y(mouthElevationM - (layer.topDepthM + layer.bottomDepthM) / 2, chainageM)
      return `<line x1="${boreholeX - 5}" y1="${boundaryY}" x2="${boreholeX + 5}" y2="${boundaryY}" stroke="#7a5a32"/><text x="${boreholeX + 6}" y="${middleY}" font-size="6" fill="#6b4c2b">ИГЭ-${xmlText(layer.igeCode ?? '—')}</text>`
    }).join('')
    const water = Number.isFinite(borehole.water.depthM)
      ? `<line x1="${boreholeX - 7}" y1="${y(mouthElevationM - borehole.water.depthM!, chainageM)}" x2="${boreholeX + 7}" y2="${y(mouthElevationM - borehole.water.depthM!, chainageM)}" stroke="#2685b5" stroke-width="2"/><text x="${boreholeX - 9}" y="${y(mouthElevationM - borehole.water.depthM!, chainageM) - 2}" text-anchor="end" font-size="6" fill="#2685b5">УГВ</text>`
      : ''
    return [`<line x1="${boreholeX}" y1="${y(mouthElevationM, chainageM)}" x2="${boreholeX}" y2="${y(mouthElevationM - deepest, chainageM)}" stroke="#7a5a32" stroke-width="2"/>${layerLines}${water}<text x="${boreholeX}" y="${y(mouthElevationM, chainageM) - 5}" text-anchor="middle" font-size="7" fill="#6b4c2b">${xmlText(borehole.label)}</text>`]
  }).join('')
  // Заголовки боковика стоят в начале листа, каждый в своей полосе, и читаются
  // вдоль листа — так они набраны и у эталона.
  const headerRight = 185
  const table = PROFILE_SIDEBAR_ROWS.map((row) => {
    const top = across(row.toMm)
    const height = (row.toMm - row.fromMm) * svgUnitsPerMm
    const title = row.title === ''
      ? ''
      : `<text data-sidebar-title="${xmlText(row.title)}" x="40" y="${(top + height / 2 + sidebarFont * 0.35).toFixed(1)}" font-size="${Math.min(sidebarFont, height * 0.7).toFixed(2)}">${xmlText(row.title)}</text>`
    return `<rect data-sidebar-band="${row.fromMm}-${row.toMm}" x="35" y="${top.toFixed(1)}" width="${(canvasWidth - 70).toFixed(1)}" height="${height.toFixed(1)}" fill="none" stroke="#111" stroke-width="0.5"/>`
      + `<line x1="${headerRight}" y1="${top.toFixed(1)}" x2="${headerRight}" y2="${(top + height).toFixed(1)}" stroke="#111" stroke-width="0.5"/>${title}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} 500" data-horizontal-scale-denominator="${PROFILE_HORIZONTAL_SCALE_DENOMINATOR}" data-horizontal-mm-per-meter="${scaleMillimetresPerMetre(PROFILE_HORIZONTAL_SCALE_DENOMINATOR)}" data-vertical-scale-denominator="${verticalDenominator}" data-vertical-mm-per-meter="${scaleMillimetresPerMetre(verticalDenominator)}" data-svg-units-per-mm="${svgUnitsPerMm}"><defs><clipPath id="profile-${sheet.sheetNumber}"><rect x="160" y="${fieldTop.toFixed(1)}" width="${canvasWidth - 195}" height="${(fieldBottom - fieldTop).toFixed(1)}"/></clipPath></defs><rect width="${canvasWidth}" height="500" fill="#fff"/><text x="35" y="22" font-size="9">Условный горизонт ${segments.map((segment) => segment.datumM.toFixed(2)).join(', ')} м · масштаб гор. 1:${PROFILE_HORIZONTAL_SCALE_DENOMINATOR}, верт. 1:${verticalDenominator}</text><g clip-path="url(#profile-${sheet.sheetNumber})">${ground.map((points) => `<polyline data-profile-ground="true" points="${points}" fill="none" stroke="#6c5134" stroke-width="2.5"/>`).join('')}${invert.map((points) => `<polyline data-profile-invert="true" points="${points}" fill="none" stroke="#1746b5" stroke-width="3.5"/>`).join('')}${datumMarks}${geology}${crossings}</g>${columns}${wholePickets.join('')}${table}${segmentValues}</svg>`
}

function basicTable(headers: string[], rows: Array<Array<string | number>>, widths?: Array<number | string>): PdfNode {
  return {
    table: {
      headerRows: 1,
      widths: widths ?? headers.map(() => '*'),
      body: [headers.map((text) => ({ text, bold: true, fillColor: '#eeeeee' })), ...rows.map((row) => row.map((text) => ({ text: String(text) })))],
    },
    layout: 'lightHorizontalLines',
    fontSize: 8,
  }
}

function generalDataOverviewSvg(input: ProjectAlbumInput): string {
  const path = input.drawingSet.mainPath
  if (path.length < 2) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 430"><rect width="420" height="430" fill="#fff" stroke="#111"/><text x="210" y="215" text-anchor="middle" font-size="12">Нет подтверждённой геометрии трассы</text></svg>'
  }
  const constraintPoints = [
    ...(input.constraints?.hardObstacleRings ?? []).flat(),
    ...(input.constraints?.waterRings ?? []).flat(),
    ...(input.constraints?.corridorRings ?? []).flat(),
    ...(input.constraints?.roadLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.waterLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.utilityLines ?? []).flatMap((line) => line.points),
    ...(input.constraints?.redLines ?? []).flatMap((line) => line.points),
  ]
  const allPoints = [...path, ...constraintPoints]
  const minX = Math.min(...allPoints.map((point) => point.x))
  const maxX = Math.max(...allPoints.map((point) => point.x))
  const minY = Math.min(...allPoints.map((point) => point.y))
  const maxY = Math.max(...allPoints.map((point) => point.y))
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const scale = Math.min(365 / width, 350 / height)
  const x = (value: number) => 28 + (value - minX) * scale
  const y = (value: number) => 385 - (value - minY) * scale
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`)
    .join(' ')
  const constraints = [
    ...(input.constraints?.hardObstacleRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#e5e5e5" stroke="#555"/>`),
    ...(input.constraints?.waterRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="#d8f1f8" stroke="#2685b5"/>`),
    ...(input.constraints?.corridorRings ?? []).map((ring) => `<polygon points="${linePoints(ring)}" fill="none" stroke="#d33232" stroke-width="1.5" stroke-dasharray="7 4"/>`),
    ...(input.constraints?.roadLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#8b734f" stroke-width="3"/>`),
    ...(input.constraints?.waterLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#2685b5" stroke-width="2"/>`),
    ...(input.constraints?.utilityLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#9b2c8c" stroke-width="1.5" stroke-dasharray="5 3"/>`),
    ...(input.constraints?.redLines ?? []).map((line) => `<polyline points="${linePoints(line.points)}" fill="none" stroke="#d22" stroke-width="2"/>`),
  ].join('')
  const route = linePoints(path)
  const first = path[0]
  const last = path[path.length - 1]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 430"><rect x="1" y="1" width="418" height="428" fill="#fff" stroke="#111"/><text x="210" y="22" text-anchor="middle" font-size="13" font-weight="700">Ситуационная схема</text><g>${constraints}<polyline points="${route}" fill="none" stroke="#1746b5" stroke-width="5" stroke-linejoin="round"/><circle cx="${x(first.x)}" cy="${y(first.y)}" r="5" fill="#fff" stroke="#1746b5" stroke-width="2"/><circle cx="${x(last.x)}" cy="${y(last.y)}" r="5" fill="#1746b5"/><text x="${x(first.x) + 7}" y="${y(first.y) - 7}" font-size="9">Начало трассы</text><text x="${x(last.x) - 7}" y="${y(last.y) - 7}" text-anchor="end" font-size="9">Выпуск</text></g><g transform="translate(26 44)"><path d="M0 28 L0 0 M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none"/><text x="0" y="-5" text-anchor="middle" font-size="10">С</text></g><g transform="translate(16 398)"><line x1="0" y1="0" x2="24" y2="0" stroke="#1746b5" stroke-width="4"/><text x="31" y="3" font-size="8">проектная ось</text><line x1="130" y1="0" x2="154" y2="0" stroke="#d33232" stroke-dasharray="6 3"/><text x="161" y="3" font-size="8">ограничения</text></g></svg>`
}

function generalDataPage(input: ProjectAlbumInput): PdfNode {
  const spatialBoreholes = (input.boreholes ?? []).filter((borehole) =>
    boreholeProfileProjection(input, borehole, input.drawingSet.mainPath) !== null)
  const crossings = input.constraints?.crossings ?? []
  const verifiedSources = new Map<string, { label: string; available: boolean; verified: boolean; detail: string }>()
  for (const sheet of input.drawingSet.sheets) {
    for (const source of sheet.sources) {
      const current = verifiedSources.get(source.requirement)
      verifiedSources.set(source.requirement, {
        label: source.label,
        available: current ? current.available && source.available : source.available,
        verified: current ? current.verified && source.verified : source.verified,
        detail: source.detail ?? current?.detail ?? '—',
      })
    }
  }
  const sourceRows = [...verifiedSources.values()].map((source) => [
    source.label,
    source.detail,
    source.available ? 'есть' : 'нет',
    source.verified ? 'проверено' : 'не проверено',
  ])
  const generalNotes = [
    'Плановое положение сети формируется только по подтверждённым полилиниям оси и пространственным ограничениям исходного проекта.',
    'Отметки земли принимаются из топографической поверхности; отметки лотка, уклоны и диаметры — из текущего расчёта.',
    'Планы, профили, ведомости и спецификации используют одну инженерную модель и пересчитываются совместно после изменения входных данных.',
    'Неподтверждённые исходные данные не заменяются значениями из эталонного альбома и блокируют зависимые листы.',
    'Окончательные проектные решения подлежат проверке ответственным инженером и согласованию в установленном порядке.',
  ]
  return {
    pageBreak: 'before',
    stack: [
      {
        table: {
          widths: [920, 70],
          body: [[
            { text: 'Общие данные', bold: true, fontSize: 13 },
            { text: 'Лист 2', alignment: 'right', fontSize: 9 },
          ]],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 8],
      },
      {
        columns: [
          {
            width: 640,
            stack: [
              { text: 'Общие указания', bold: true, fontSize: 11, margin: [0, 0, 0, 6] },
              { ul: generalNotes, fontSize: 8.5, margin: [0, 0, 0, 10] },
              { text: 'Основные показатели', bold: true, fontSize: 11, margin: [0, 2, 0, 6] },
              basicTable(['Показатель', 'Значение'], [
                ['Система', input.system === 'storm' ? 'ливневая канализация К2' : 'бытовая канализация К1'],
                ['Участки сети', input.network.pipes.length],
                ['Протяжённость, м', input.schedule.totalPipeLengthM.toFixed(2)],
                ['Расход на выпуске, л/с', input.outletFlowLps.toFixed(2)],
                ['Точки топографической съёмки', input.surveyPoints.length],
                ['Скважины с координатами', spatialBoreholes.length],
                ['Карточки пересечений', crossings.length],
                ['Хэш расчётных исходных данных', input.drawingSet.inputHash],
              ], [260, '*']),
              { text: 'Готовность источников', bold: true, fontSize: 11, margin: [0, 10, 0, 6] },
              basicTable(['Раздел', 'Состав', 'Наличие', 'Проверка'], sourceRows, [145, '*', 65, 82]),
            ],
          },
          {
            width: '*',
            stack: [{ svg: generalDataOverviewSvg(input), fit: [370, 430] }],
          },
        ],
        columnGap: 18,
      },
    ],
  }
}

function sheetPage(sheet: WorkingDrawingSheet, body: PdfNode[], format: AlbumPageFormat): PdfNode {
  const designation = `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`
  const header = {
    table: {
      widths: ['*', 90],
      body: [[
        { text: sheet.title, bold: true, fontSize: 12 },
        { text: designation, alignment: 'right', fontSize: 9 },
      ]],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8],
  }
  return {
    section: {
      stack: [
        header,
        ...body,
      ],
    },
    pageSize: pdfPageSize(format),
    pageOrientation: pdfPageOrientation(format),
    pageMargins: PAGE_MARGINS,
  }
}

function servicePage(page: WorkingDrawingAlbumPage, section: PdfNode): PdfNode {
  const normalizedSection = { ...section }
  delete normalizedSection.pageBreak
  return {
    section: normalizedSection,
    pageSize: pdfPageSize(page.pageFormat),
    pageOrientation: pdfPageOrientation(page.pageFormat),
    pageMargins: PAGE_MARGINS,
  }
}

/**
 * Диагональный знак «ДЕМО — не для производства».
 *
 * Ставится ТОЛЬКО на альбом, собранный на учебных данных. В режиме измерения
 * сходства его быть не должно: знак лёг бы поверх графики и отравил
 * попиксельное сравнение с эталоном, то есть испортил бы само число, ради
 * которого сборка и делается.
 *
 * Знак идёт фоном, под содержимым листа: он обязан читаться, но не закрывать
 * ни графику, ни штамп. Прозрачность и наклон подобраны так, чтобы надпись
 * была видна на просвет и не спорила с чертежом.
 */
const DEMO_WATERMARK_TEXT = 'ДЕМО — не для производства'

function demoWatermark(pageSize: { width: number; height: number }): PdfNode {
  const angleDeg = -Math.atan2(pageSize.height, pageSize.width) * 180 / Math.PI
  return {
    text: DEMO_WATERMARK_TEXT,
    color: '#c62828',
    opacity: 0.16,
    bold: true,
    fontSize: Math.max(28, Math.round(pageSize.width / 22)),
    alignment: 'center',
    absolutePosition: { x: 0, y: pageSize.height / 2 - 30 },
    width: pageSize.width,
    // Наклон по диагонали листа: знак пересекает поле, а не строку.
    angle: angleDeg,
  } as PdfNode
}

function engineeringFrame(_currentPage: number, pageSize: { width: number; height: number }): PdfNode {
  return {
    canvas: [{
      type: 'rect',
      x: 14,
      y: 14,
      w: Math.max(0, pageSize.width - 28),
      h: Math.max(0, pageSize.height - 28),
      lineWidth: 0.8,
      lineColor: '#222',
    }],
  }
}

/**
 * Основная надпись по форме 3 ГОСТ Р 21.101-2020, прижатая к правому нижнему
 * углу листа — как требует п. 5.2. Прежний вариант был таблицей из пяти
 * колонок без граф изменений и подписей; форма 3 обязательна для листов
 * основного комплекта рабочих чертежей.
 */
function engineeringStamp(
  input: ProjectAlbumInput,
  designation: string,
  currentPage: number,
  totalPages: number,
): PdfNode {
  const sheet = input.drawingSet.manifest.pages[currentPage - 1]
  return {
    margin: [0, 0, 30, 8],
    alignment: 'right',
    columns: [
      { text: '', width: '*' },
      {
        width: 'auto',
        ...buildTitleBlock({
          designation: `${input.projectCode} ${designation}`,
          objectName: input.projectName,
          sheetTitle: sheet?.title ?? input.projectName,
          stage: 'Р',
          sheetNumber: currentPage,
          // Графа 8 заполняется только на первом листе.
          totalSheets: currentPage === 1 ? totalPages : undefined,
          organisation: input.organisation,
          signatories: input.signatories,
        }),
      },
    ],
  }
}

function rangeFor(sheets: WorkingDrawingSheet[], kind: WorkingDrawingSheet['kind']): string {
  const matches = sheets.filter((sheet) => sheet.kind === kind)
  if (matches.length === 0) return '—'
  const code = matches[0].documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'
  return matches.length === 1
    ? `${code}/${matches[0].sheetNumber}`
    : `${code}/${matches[0].sheetNumber}–${matches[matches.length - 1].sheetNumber}`
}

function drawingSheetBody(input: ProjectAlbumInput, sheet: WorkingDrawingSheet, format: AlbumPageFormat): PdfNode[] {
  const viewport = drawingViewport(format)
  if (sheet.kind === 'plan') return [{ svg: planSvg(input, sheet, viewport.canvasWidth, viewport.svgUnitsPerMm), fit: [viewport.fitWidth, viewport.fitHeight] }]
  if (sheet.kind === 'network_plan') return [{ svg: networkPlanSvg(input, sheet), fit: [viewport.fitWidth, viewport.fitHeight] }]
  if (sheet.kind === 'profile') {
    // Лист профиля без интервала — это лист, включённый в состав комплекта, для
    // которого ещё нет данных: например, профиль существующего участка
    // примыкания до загрузки нивелировки. Рисовать нечего, но и обрушивать
    // сборку всего альбома одним незаполненным листом нельзя — печатается лист,
    // честно называющий, чего в нём нет. То же правило, что у плана без
    // подосновы и у защитной сетки без конструкции.
    if (!sheet.interval) {
      return [
        {
          text: 'ЛИСТ НЕ ЗАПОЛНЕН: данных для профиля нет.',
          fontSize: 12, bold: true, color: '#8a4c00', margin: [0, 0, 0, 6],
        },
        {
          text: sheet.blockers[0]?.message
            ?? 'Профиль строится по станциям с отметками; станции не заданы.',
          fontSize: 9, margin: [0, 0, 0, 8],
        },
      ]
    }
    return [{ svg: profileSvg(input, sheet, viewport.canvasWidth, viewport.svgUnitsPerMm), fit: [viewport.fitWidth, viewport.fitHeight] }]
  }
  if (sheet.kind === 'material_table') {
    const range = sheet.dataRange ?? { start: 0, end: input.schedule.manholes.length, total: input.schedule.manholes.length }
    const rows = input.schedule.manholes.slice(range.start, range.end)
    const selectedByLabel = new Map(input.manholeConstructions.map((item) => [item.manholeLabel, item]))
    return [
      { text: 'Количества сформированы из текущей расчётной ведомости и подтверждённого каталога конструкций.', fontSize: 9, margin: [0, 0, 0, 10] },
      basicTable(['Колодец', 'Пикет', 'Глубина, мм', 'Ø трубы, мм', 'Конструкция'], rows.map((row) => [row.label, row.picket, row.depthMm, row.pipeDiameterMm, selectedByLabel.get(row.label)?.typeCode ?? 'не подобрано']), [90, 100, 90, 90, 130]),
    ]
  }
  if (sheet.kind === 'detail') {
    if (sheet.variant === 'protective_grid') {
      const design = input.drawingSet.protectiveGridDesign
      if (!design || !design.verified) {
        // Лист входит в состав комплекта, но чертить нечего: конструкция
        // изделия не подтверждена. Раньше здесь бросалось исключение, и один
        // незаполненный лист обрушивал сборку ВСЕГО альбома — при том что
        // прочие незавершённые листы выпускаются со своим стоп-фактором. Тот
        // же приём, что у плана без подосновы: лист печатается и честно
        // говорит, чего в нём нет.
        return [
          {
            text: 'ЛИСТ НЕ ЗАПОЛНЕН: конструкция защитной сетки не подтверждена.',
            fontSize: 12, bold: true, color: '#8a4c00', margin: [0, 0, 0, 6],
          },
          {
            text: 'Габариты, шаг прутка и количество задаются в составе проектного комплекта '
              + 'и берутся из каталога конструкций. Пока их нет, чертить нечего, и лист '
              + 'остаётся в ведомости незаполненным — он не выдаётся за готовый.',
            fontSize: 9, margin: [0, 0, 0, 8],
          },
        ]
      }
      const drawingWidth = Math.min(650, 320 * design.overallWidthMm / Math.max(design.overallHeightMm, 1))
      const drawingHeight = Math.min(320, 650 * design.overallHeightMm / Math.max(design.overallWidthMm, 1))
      const x0 = 80
      const y0 = 50
      const verticalBars = Math.max(0, Math.floor(design.overallWidthMm / design.barSpacingMm) - 1)
      const horizontalBars = Math.max(0, Math.floor(design.overallHeightMm / design.barSpacingMm) - 1)
      const vertical = Array.from({ length: verticalBars }, (_, index) => {
        const x = x0 + (index + 1) * design.barSpacingMm / design.overallWidthMm * drawingWidth
        return `<line x1="${x.toFixed(2)}" y1="${y0}" x2="${x.toFixed(2)}" y2="${(y0 + drawingHeight).toFixed(2)}" stroke="#111" stroke-width="1"/>`
      }).join('')
      const horizontal = Array.from({ length: horizontalBars }, (_, index) => {
        const y = y0 + (index + 1) * design.barSpacingMm / design.overallHeightMm * drawingHeight
        return `<line x1="${x0}" y1="${y.toFixed(2)}" x2="${(x0 + drawingWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#111" stroke-width="1"/>`
      }).join('')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="430" viewBox="0 0 900 430"><rect width="900" height="430" fill="white"/><rect x="${x0}" y="${y0}" width="${drawingWidth.toFixed(2)}" height="${drawingHeight.toFixed(2)}" fill="none" stroke="#111" stroke-width="4"/>${vertical}${horizontal}<text x="${x0}" y="${(y0 + drawingHeight + 28).toFixed(2)}" font-family="Roboto" font-size="16">Габарит ${xmlText(design.overallWidthMm)}×${xmlText(design.overallHeightMm)} мм; шаг ${xmlText(design.barSpacingMm)} мм</text></svg>`
      return [
        { text: 'Геометрия листа построена только по подтверждённым параметрам изделия.', fontSize: 9, margin: [0, 0, 0, 8] },
        { svg, fit: [760, 320], margin: [0, 0, 0, 8] },
        basicTable(
          ['Параметр', 'Значение'],
          [
            ['Количество', `${design.quantity.toFixed(3)} шт.`],
            ['Рама / стержни', `${design.frameProfile} / ${design.barProfile}`],
            ['Материал / покрытие', `${design.material} / ${design.coating}`],
            ['Крепление', design.fixing],
            ['Источник', design.source],
          ],
          [160, '*'],
        ),
      ]
    }
    return [
      { text: 'Реестр карточек пересечений и готовность исходных данных', fontSize: 10, bold: true, margin: [0, 0, 0, 10] },
      basicTable(
        ['Источник', 'Состав', 'Наличие', 'Проверка'],
        sheet.sources.map((source) => [source.label, source.detail ?? '—', source.available ? 'есть' : 'нет', source.verified ? 'проверено' : 'не проверено']),
        [180, '*', 80, 100],
      ),
    ]
  }
  if (sheet.kind === 'specification') {
    const componentTotals = new Map<string, { name: string; unit: string; code: string; quantity: number }>()
    for (const construction of input.manholeConstructions) {
      for (const component of construction.components) {
        const key = `${component.catalogCode ?? ''}\u0000${component.name}\u0000${component.unit}`
        const current = componentTotals.get(key)
        componentTotals.set(key, {
          name: component.name,
          unit: component.unit,
          code: component.catalogCode ?? '—',
          quantity: (current?.quantity ?? 0) + component.quantity,
        })
      }
    }
    const rows = [
      ...input.schedule.pipes.map((row) => [row.designation, row.agskCode || '—', 'м', row.lengthM.toFixed(2)]),
      ...[...componentTotals.values()].map((row) => [row.name, row.code, row.unit, row.quantity.toFixed(3)]),
    ]
    const range = sheet.dataRange ?? { start: 0, end: rows.length, total: rows.length }
    if (range.total !== rows.length) {
      throw new Error(`Лист ${sheet.sheetNumber}: реестр спецификации устарел (${range.total} строк, модель ${rows.length}).`)
    }
    const selectedRows = rows.slice(range.start, range.end)
    return [
      { text: 'Спецификация пересчитана из текущей инженерной модели и активных каталогов.', fontSize: 9, margin: [0, 0, 0, 10] },
      basicTable(
        ['Поз.', 'Наименование', 'Код', 'Ед.', 'Количество'],
        selectedRows.map((row, index) => [range.start + index + 1, ...row]),
        [45, '*', 100, 55, 90],
      ),
    ]
  }
  throw new Error(`Тип листа ${sheet.kind} ещё не поддерживается экспортом.`)
}

function drawingRegisterColumns(sheets: WorkingDrawingSheet[]): PdfNode {
  const rows = sheets.map((sheet) => [
    `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`,
    sheet.title,
    sheet.status,
  ])
  const chunks = Array.from({ length: Math.max(1, Math.ceil(rows.length / 18)) }, (_, index) =>
    rows.slice(index * 18, (index + 1) * 18))
  return {
    columns: chunks.map((chunk) => ({
      width: '*',
      stack: [basicTable(['Лист', 'Наименование', 'Статус'], chunk, [72, '*', 75])],
    })),
    columnGap: 12,
    margin: [0, 12, 0, 4],
  }
}

export function buildProjectSheetDoc(input: ProjectAlbumInput, sheetId: string): PdfNode {
  const sheet = input.drawingSet.sheets.find((item) => item.id === sheetId)
  if (!sheet) throw new Error('Лист не найден в текущем реестре.')
  if (sheet.status !== 'VERIFIED') throw new Error(
    `Лист ${sheet.sheetNumber} нельзя выпустить как отдельный финальный документ со статусом ${sheet.status}.`,
  )
  const page = manifestPageForSheet(input, sheet)
  return {
    pageSize: pdfPageSize(page.pageFormat),
    pageOrientation: pdfPageOrientation(page.pageFormat),
    pageMargins: PAGE_MARGINS,
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content: [{
      stack: [
        {
          table: {
            widths: ['*', 90],
            body: [[
              { text: sheet.title, bold: true, fontSize: 12 },
              { text: `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`, alignment: 'right', fontSize: 9 },
            ]],
          },
          layout: 'noBorders',
          margin: [0, 0, 0, 8],
        },
        ...drawingSheetBody(input, sheet, page.pageFormat),
      ],
    }],
    background: engineeringFrame,
    footer: engineeringStamp(
      input,
      `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}`,
      1,
      1,
    ),
    info: { title: `${input.projectCode} — ${sheet.title}`, subject: 'Отдельный рабочий лист', creator: 'AquaScheme' },
  }
}

/**
 * Кто просит альбом.
 *
 * `release` — экранный выпуск. Шлюз прежний и не ослаблен ни на йоту: пока хоть
 * один лист не `VERIFIED`, альбома не будет.
 *
 * `benchmark` — измерение сходства с эталоном. Пока альбом не собирается,
 * показателя не существует вовсе, и инструмент не мерит прогресс, а лишь
 * подтверждает финиш. Ровно та же болезнь уже лечилась в самом
 * `visual-benchmark.mjs`, где несовпадение числа страниц прекращало работу до
 * всякого измерения.
 *
 * Водяного знака в этом режиме НЕТ намеренно: он отравил бы попиксельное
 * сравнение, ради которого альбом и собирается. Отличимость обеспечивается
 * иначе — статусом каждого листа в метаданных PDF.
 */
export type AlbumBuildMode =
  /** Инженерный выпуск: требует VERIFIED на каждом листе. Правило не ослаблено. */
  | 'release'
  /**
   * Демонстрационная сборка на учебных данных.
   *
   * Требует не подтверждения, а РАСЧЁТА: все листы не ниже CALCULATED. Демо
   * обязано показывать продукт, и запрет выпуска этому не мешает — он запрещает
   * выпуск, а не просмотр. Каждый лист несёт водяной знак.
   */
  | 'demo'
  /** Сборка для измерения сходства. Знака нет: он отравил бы сравнение. */
  | 'benchmark'

/**
 * Собирает альбом. Режим `benchmark` доступен только через
 * `shared/benchmarkAlbum.ts`; из экранов приложения он недостижим, и это
 * закреплено проверкой.
 */
export function buildAlbumDocument(input: ProjectAlbumInput, mode: AlbumBuildMode): PdfNode {
  if (mode === 'release' && !input.drawingSet.summary.finalExportAllowed) {
    throw new Error(`Финальный выпуск запрещён: заблокировано ${input.drawingSet.summary.blocked}, устарело ${input.drawingSet.summary.stale}.`)
  }
  // Демо собирается по расчёту, а не по подтверждению: подтвердить учебные
  // данные нельзя и не нужно. Заблокированный лист не собирается и здесь.
  if (mode === 'demo' && !input.drawingSet.summary.draftExportAllowed) {
    throw new Error(`Демо-альбом не собран: заблокировано ${input.drawingSet.summary.blocked}, устарело ${input.drawingSet.summary.stale}.`)
  }
  const totalSheets = input.drawingSet.manifest.pdfPageCount
  const serviceManifestPages = input.drawingSet.manifest.pages.filter((page) => !page.sheetId)
  if (serviceManifestPages.length !== 3) throw new Error('Манифест альбома должен содержать три служебных страницы.')
  const serviceContent: PdfNode[] = [
    {
      stack: [
        { text: 'РАБОЧАЯ ДОКУМЕНТАЦИЯ', alignment: 'center', bold: true, fontSize: 21, margin: [0, 100, 0, 25] },
        { text: input.projectName, alignment: 'center', fontSize: 18, margin: [70, 0, 70, 30] },
        { text: `НАРУЖНЫЕ СЕТИ КАНАЛИЗАЦИИ · ${input.system === 'storm' ? 'К2' : 'К1'}`, alignment: 'center', bold: true, fontSize: 15 },
        { text: input.projectCode, alignment: 'center', fontSize: 28, bold: true, color: '#173f9f', margin: [0, 42, 0, 0] },
        { text: `Хэш исходных данных: ${input.drawingSet.inputHash}`, alignment: 'center', fontSize: 9, color: '#666', margin: [0, 18, 0, 0] },
      ],
    },
    {
      pageBreak: 'before',
      stack: [
        { text: 'Ведомость рабочих чертежей', bold: true, fontSize: 14, margin: [0, 0, 0, 12] },
        basicTable(['Листы', 'Раздел', 'Количество'], [
          ['PDF 1', 'Титульный лист рабочего комплекта', 1],
          ['MAIN/1–2', 'Ведомость рабочих чертежей и общие данные', 2],
          [rangeFor(input.drawingSet.sheets, 'plan'), 'Планы трассы по фактической оси DWG', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'plan').length],
          [rangeFor(input.drawingSet.sheets, 'network_plan'), 'Сводный план всей подтверждённой топологии сети', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'network_plan').length],
          [rangeFor(input.drawingSet.sheets, 'profile'), 'Продольные профили по расчётным отметкам', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'profile').length],
          [rangeFor(input.drawingSet.sheets, 'material_table'), 'Ведомости колодцев и материалов', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'material_table').length],
          [rangeFor(input.drawingSet.sheets, 'detail'), 'Пересечения и конструктивные решения', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'detail').length],
          [rangeFor(input.drawingSet.sheets, 'specification'), 'Спецификации оборудования и материалов', input.drawingSet.sheets.filter((sheet) => sheet.kind === 'specification').length],
        ], [80, '*', 75]),
        drawingRegisterColumns(input.drawingSet.sheets),
        { text: `\nВсего: ${totalSheets} листов. Расчётный расход на выпуске: ${input.outletFlowLps.toFixed(2)} л/с. Протяжённость: ${input.schedule.totalPipeLengthM.toLocaleString('ru-RU')} м.`, fontSize: 10 },
        { text: `\nИсточник плановой геометрии: ${input.network.pipes.length} участков сети, ${input.drawingSet.mainPath.length} вершин оси. Источник рельефа: ${input.surveyPoints.length} точек. Значения эталонного проекта в расчёты не подставлялись.`, fontSize: 9 },
      ],
    },
    generalDataPage(input),
  ]

  const content: PdfNode[] = serviceContent.map((section, index) => servicePage(serviceManifestPages[index], section))

  for (const sheet of input.drawingSet.sheets) {
    const page = manifestPageForSheet(input, sheet)
    content.push(sheetPage(sheet, drawingSheetBody(input, sheet, page.pageFormat), page.pageFormat))
  }

  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: PAGE_MARGINS,
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content,
    /*
     * Фон листа. В демо-сборке к рамке добавляется водяной знак; в режиме
     * измерения сходства — никогда, иначе знак отравил бы сравнение.
     */
    background: (currentPage: number, pageSize: { width: number; height: number }) => (
      mode === 'demo'
        ? { stack: [engineeringFrame(currentPage, pageSize), demoWatermark(pageSize)] }
        : engineeringFrame(currentPage, pageSize)
    ),
    footer: (currentPage: number) => {
      if (currentPage === 1) return { text: '' }
      const page = input.drawingSet.manifest.pages[currentPage - 1]
      const designation = page?.documentSetCode && page.sheetNumber !== null
        ? `${page.documentSetCode}/${page.sheetNumber}`
        : `PDF ${currentPage}`
      return engineeringStamp(input, designation, currentPage, totalSheets)
    },
    info: {
      title: `${input.projectCode} — ${input.projectName}`,
      subject: mode === 'benchmark'
        ? `Сборка для измерения сходства, НЕ ВЫПУСК, ${totalSheets} листов`
        : `Расчётный комплект рабочих чертежей, ${totalSheets} листов`,
      creator: 'AquaScheme',
      // Статус каждого листа — в метаданных. Ни один лист сборки для измерения
      // не выдаётся за выпущенный: посмотревший файл видит, что перед ним.
      ...(mode === 'benchmark'
        ? {
          keywords: [
            'benchmark',
            `finalExportAllowed=${input.drawingSet.summary.finalExportAllowed}`,
            ...input.drawingSet.sheets.map((sheet) =>
              `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}=${sheet.status}`),
          ].join('; '),
        }
        : {}),
    },
  }
}

/**
 * Экранный выпуск. Поведение не менялось: без `finalExportAllowed` — исключение.
 */
export function buildProjectAlbumDoc(input: ProjectAlbumInput): PdfNode {
  return buildAlbumDocument(input, 'release')
}
