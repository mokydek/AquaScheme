import type { RouteConstraintInput, RoutePoint, RouteSegment } from '@aquascheme/engine'
import type { DxfLayerRole } from '@aquascheme/engine/dxfread'
import type { PlanLineRole } from './planStyles'

/**
 * Роль слоя чертежа → роль линии на листе.
 *
 * ТАБЛИЦА ОДНА. Раньше соответствия не было вовсе: разбор чертежа раскладывал
 * линии по ролям, а отрисовщик про роли не знал и выводил весь чертёж стилем
 * подосновы — 0,127 мм чёрным. Существующая сеть, красные линии и дороги
 * появлялись на листе вторым проходом, из именованных наборов, поверх уже
 * нарисованной чёрной копии самих себя. Отсюда и двойная линия, и чёрный цвет
 * под цветной.
 *
 * Соответствие держится ЗДЕСЬ, а не в двух местах и не в трёх: у листа плана,
 * у ситуационной схемы и у сводного плана сети одна таблица, и разъехаться им
 * негде. Стили ролей листа не переизмеряются — они в `planStyles`.
 *
 * `null` означает «не рисуется». Это не «нет стиля», а решение: слой помечен
 * инженером как ненужный, и выводить его на лист нельзя.
 */
export const PLAN_ROLE_BY_LAYER_ROLE: Readonly<Record<DxfLayerRole, PlanLineRole | null>> = {
  // ГОСТ 21.704 п.3.9 абз. 4: существующие сети — сплошной тонкой линией.
  utility: 'existingUtility',
  // Красная линия: собственный измеренный стиль, подписывается словами.
  redLine: 'redLine',
  // Здание и сооружение — один стиль: ГОСТ 21.704 п.3.9 их не разделяет, и
  // разбор чертежа складывает их в один набор контуров (`buildingFootprints`).
  building: 'existingBuilding',
  structure: 'existingBuilding',
  road: 'road',
  // ЖЕЛЕЗНАЯ ДОРОГА РИСУЕТСЯ КАК АВТОМОБИЛЬНАЯ — это решение, а не совпадение.
  // Условный знак пути (шпальная штриховка) даётся ГОСТ 21.204/21.302, а ни
  // одного из них в `docs/norms` нет. Придумать штриховку — значит выдать
  // выдуманный знак за нормативный. Пока документа нет, путь выводится тем же
  // стилем полосы движения: линия на месте и в габарите, знак не подделан.
  // Само разделение в данных сохранено: `railwayLines` остаётся отдельным
  // набором, и как только знак появится, менять придётся только эту строку.
  railway: 'road',
  hydrography: 'water',
  corridor: 'corridor',
  protectionZone: 'corridor',
  forbiddenZone: 'corridor',
  approvedCrossing: 'corridor',
  // ТОПООСНОВА, А НЕ ГОРИЗОНТАЛЬ. Роли `contour`/`contourIndex` принадлежат
  // горизонталям, ПОСТРОЕННЫМ по отметкам съёмки (`albumContours`): у них есть
  // сечение, отметка и подпись. Линия слоя рельефа с чертежа — это то, что
  // нарисовал топограф; выдать её за построенную горизонталь значило бы
  // приписать ей отметку, которой у неё нет.
  terrain: 'topobase',
  terrainBreakline: 'topobase',
  candidateRoute: 'topobase',
  guideAxis: 'topobase',
  parcel: 'topobase',
  ignore: null,
  // Слой не разобран. Линия выводится подосновой — терять её нельзя, на ней
  // может стоять что угодно, — но лист об этом ГОВОРИТ: сколько линий вышло
  // ролью «не разобрано», написано в примечании под листом.
  unknown: 'topobase',
}

/**
 * Роли, у которых замкнутая линия МОЖЕТ стать кольцом.
 *
 * Список нужен только для проверки: он говорит, у каких ролей разбор чертежа
 * вообще строит кольца. Решение по КОНКРЕТНОЙ линии принимает разбор и
 * записывает его в саму линию признаком `drawnAsRing` — по роли и `closed`
 * восстановить его нельзя. Замкнутый контур из трёх точек кольцом не станет, и
 * мелкий замкнутый значок на слое коридора тоже: разбор отсеивает кольца
 * меньше 30 м как условные знаки, а не как полосу отвода. Догадка по роли
 * стёрла бы такие линии с листа молча.
 */
export const RING_DRAWN_LAYER_ROLES: ReadonlySet<DxfLayerRole> = new Set<DxfLayerRole>([
  'building', 'structure', 'protectionZone', 'forbiddenZone',
  'approvedCrossing', 'parcel', 'corridor', 'hydrography',
])

/**
 * Значение поля роли, пришедшее из хранилища.
 *
 * Роль, которой нет в таблице, — не роль: набор мог быть записан другой
 * редакцией, а могло и просто испортиться. Такая линия объявляется
 * неразобранной, и лист об этом скажет. Подставить ей «что-нибудь похожее»
 * значило бы нарисовать чужой стиль и промолчать об этом.
 */
export function layerRoleOrUnknown(value: unknown): DxfLayerRole {
  return typeof value === 'string' && value in PLAN_ROLE_BY_LAYER_ROLE ? value as DxfLayerRole : 'unknown'
}

/** Линия листа: геометрия, роль отрисовки и обозначение слоя съёмки. */
export interface PlanSourceLine {
  points: RoutePoint[]
  role: PlanLineRole
  /** Обозначение слоя в съёмке — из него берётся буквенная марка сети. */
  layer?: string
}

export interface PlanSourceLines {
  lines: PlanSourceLine[]
  /**
   * Откуда взята линейная графика листа.
   *
   * `drawing` — полный контур чертежа: каждая линия со своей ролью.
   * `named-sets` — полного контура в наборе нет, и лист собран из именованных
   * наборов (сети, красные линии, дороги). Это НЕ равнозначная замена: в
   * именованные наборы попадает только разобранное, и всё остальное — бордюры,
   * отмостки, подписи съёмки — на лист не выйдет. Ветка названа и попадает в
   * примечание листа, чтобы неполнота была видна, а не подразумевалась.
   * `none` — линий нет вовсе.
   */
  origin: 'drawing' | 'named-sets' | 'none'
  /** Линии со слоёв, роль которых не разобрана. Выводятся подосновой. */
  unknownRoleLines: number
  /** Замкнутые контуры, выведенные кольцом и потому не повторённые линией. */
  ringLines: number
  /** Линии слоёв, помеченных «не выводить». */
  ignoredLines: number
}

/**
 * Линейная графика листа — ОДНИМ СПИСКОМ, для плана и для схемы.
 *
 * До этого лист собирал линии из двух источников сразу: сначала весь контур
 * чертежа стилем подосновы, потом поверх — именованные наборы своими стилями.
 * Каждая линия существующей сети выходила на лист дважды: чёрной 0,127 мм и
 * оранжевой поверх неё. Здесь источник ОДИН, и линия попадает в список ровно
 * один раз.
 */
export function planSourceLines(constraints: RouteConstraintInput | null | undefined): PlanSourceLines {
  const context = constraints?.cadContextLines ?? []
  if (context.length > 0) {
    const lines: PlanSourceLine[] = []
    let unknownRoleLines = 0
    let ringLines = 0
    let ignoredLines = 0
    for (const line of context) {
      const layerRole = layerRoleOrUnknown(line.role)
      if (line.drawnAsRing === true) { ringLines += 1; continue }
      const role = PLAN_ROLE_BY_LAYER_ROLE[layerRole]
      if (role === null) { ignoredLines += 1; continue }
      if (layerRole === 'unknown') unknownRoleLines += 1
      lines.push({ points: line.points, role, layer: line.layer })
    }
    return { lines, origin: 'drawing', unknownRoleLines, ringLines, ignoredLines }
  }
  const lines = namedSetLines(constraints)
  return {
    lines,
    origin: lines.length > 0 ? 'named-sets' : 'none',
    unknownRoleLines: 0,
    ringLines: 0,
    ignoredLines: 0,
  }
}

/**
 * Линии ИМЕНОВАННЫХ наборов со своими ролями.
 *
 * Разбор чертежа, кроме полного контура, раскладывает разобранное по наборам:
 * существующие сети, красные линии, дороги, гидрография. Соответствие «набор →
 * роль» держится ЗДЕСЬ и нигде больше: им пользуется и запасная ветвь
 * `planSourceLines`, когда полного контура в наборе нет, и обзорная врезка
 * листа «Общие данные», которой полный контур не нужен вовсе — на четырёхстах
 * единицах холста четырнадцать тысяч линий дали бы чёрное пятно.
 *
 * Порядок тот же, что у отрисовки: подоснова первой, предмет чертежа последним.
 */
export function namedSetLines(constraints: RouteConstraintInput | null | undefined): PlanSourceLine[] {
  const named: Array<[PlanLineRole, ReadonlyArray<RouteSegment> | undefined]> = [
    ['topobase', constraints?.terrainLines],
    ['topobase', constraints?.guideLines],
    ['existingBuilding', constraints?.hardObstacles],
    ['road', constraints?.roadLines],
    ['water', constraints?.waterLines],
    ['existingUtility', constraints?.utilityLines],
    ['redLine', constraints?.redLines],
  ]
  return named.flatMap(([role, segments]) =>
    (segments ?? []).map((segment) => ({ points: segment.points, role, layer: segment.layer })))
}

/**
 * Порог, ниже которого роль не прореживается.
 *
 * Прореживание было общим на весь чертёж: линии складывались в один список и
 * прорежались одним шагом. На съёмке Станкевича это разоряло редкие роли — из
 * 53 красных линий, 26 линий гидрографии и 2 дорог до листа доходила примерно
 * каждая третья, потому что рядом лежали тринадцать тысяч линий подосновы.
 * Между тем именно редкая линия и есть предмет чертежа: красную линию нельзя
 * «проредить», её либо соблюдают, либо нет.
 *
 * Сто — не измеренная величина, а граница «редкой» роли: сотня линий на листе
 * читается целиком и места почти не занимает. Величина инженерная, не
 * нормативная, и относится к оформлению, а не к расчёту.
 */
export const UNTHINNED_ROLE_LINES = 100

/** Сколько линий роли доходит до листа и сколько отброшено. */
export interface RoleLineBudget {
  role: PlanLineRole
  /** Пришло в окно листа. */
  arrived: number
  /** Выведено. */
  drawn: number
  /** Отброшено прореживанием. */
  thinned: number
}

/**
 * Раздача общего предела линий по ролям.
 *
 * Общий потолок сохраняется: сумма выведенного не больше `total`. Редкие роли
 * (меньше `UNTHINNED_ROLE_LINES`) проходят целиком, остаток делится между
 * массовыми ролями пропорционально их количеству — крупнейший остаток
 * добирает разницу округления, чтобы сумма сошлась точно.
 *
 * Если одни только редкие роли не помещаются в потолок, пропорционально
 * делится весь потолок: молча выкинуть массовую роль целиком нельзя, а
 * притвориться, что места хватило, — тем более.
 */
export function allocatePlanLineBudget(
  counts: ReadonlyMap<PlanLineRole, number>,
  total: number,
): Map<PlanLineRole, number> {
  const entries = [...counts.entries()].filter(([, count]) => count > 0)
  const arrived = entries.reduce((sum, [, count]) => sum + count, 0)
  const quota = new Map<PlanLineRole, number>()
  if (arrived <= total) {
    for (const [role, count] of entries) quota.set(role, count)
    return quota
  }
  const small = entries.filter(([, count]) => count < UNTHINNED_ROLE_LINES)
  const smallTotal = small.reduce((sum, [, count]) => sum + count, 0)
  const mass = entries.filter(([, count]) => count >= UNTHINNED_ROLE_LINES)
  const shared = smallTotal <= total ? total - smallTotal : total
  const shareAmong = smallTotal <= total ? mass : entries
  if (smallTotal <= total) for (const [role, count] of small) quota.set(role, count)
  const shareTotal = shareAmong.reduce((sum, [, count]) => sum + count, 0)
  if (shareTotal === 0) return quota
  const exact = shareAmong.map(([role, count]) => ({ role, count, want: (count / shareTotal) * shared }))
  let given = 0
  for (const item of exact) {
    const value = Math.min(item.count, Math.floor(item.want))
    quota.set(item.role, value)
    given += value
  }
  // Остаток округления — ролям с наибольшей дробной частью, пока он не кончится.
  const byRemainder = [...exact].sort((a, b) => (b.want % 1) - (a.want % 1))
  let left = shared - given
  for (const item of byRemainder) {
    if (left <= 0) break
    const current = quota.get(item.role) ?? 0
    if (current >= item.count) continue
    quota.set(item.role, current + 1)
    left -= 1
  }
  return quota
}
