import type { WorkingDrawingSet, WorkingDrawingStatus } from './working-drawings'

/**
 * Готовность проекта к выпуску одним списком.
 *
 * Шлюз набора рабочих чертежей знает всё, что мешает выпуску, но раскладывает
 * это по листам: чтобы понять, чего не хватает проекту, надо было пролистать
 * весь альбом и сложить замечания в голове. Один и тот же стоп-фактор при этом
 * повторяется на десятке листов — план, профиль и спецификация упираются в одну
 * и ту же отсутствующую величину.
 *
 * Здесь замечания сводятся по коду: сколько листов держит каждая причина и в
 * каком разделе её снимают. Ничего нового не вычисляется — иначе экран
 * готовности разошёлся бы со шлюзом, а расходиться им нельзя.
 */

export interface ReadinessIssue {
  code: string
  message: string
  /** Сколько листов держит эта причина. */
  sheetCount: number
  /** Блокирует выпуск или только предупреждает. */
  blocking: boolean
  /** Раздел интерфейса, где причину снимают; пусто — раздел неизвестен. */
  section?: string
  /** Якорь раздела для перехода по ссылке. */
  anchor?: string
  /** Что сделать в этом разделе, чтобы причина ушла. */
  action?: string
}

export interface ProjectReadiness {
  /** Листов всего и по состояниям. */
  sheetCount: number
  byStatus: Record<WorkingDrawingStatus, number>
  /** Доля листов, пригодных к выпуску (VERIFIED), в процентах. */
  verifiedPercent: number
  issues: ReadinessIssue[]
  blockingIssueCount: number
  reason: string
}

/**
 * Куда идти и что там сделать.
 *
 * Подпись «идите в раздел X» рядом с замечанием бесполезна дважды: она
 * бесполезна, если расходится с тем, что на экране, и бесполезна, если не
 * говорит, ЧТО именно там сделать. Поэтому у каждой причины три части —
 * раздел, якорь для перехода и действие, — и ведутся они здесь, а не в каждом
 * компоненте по отдельности.
 *
 * Якорь обязателен: без него «раздел» остаётся текстом, который владелец ищет
 * прокруткой. Соответствие якорей настоящим разделам страницы проверяется
 * тестом отрисовки.
 */
export interface ReadinessTarget {
  /** Раздел интерфейса, где причину снимают. */
  title: string
  /** Якорь раздела на странице проекта — цель ссылки-перехода. */
  anchor: string
  /** Что именно там сделать. Не «проверьте», а действие. */
  action: string
}

const SECTION_BY_CODE: Record<string, ReadinessTarget> = {
  TOPOGRAPHY_MISSING: { title: 'Топосъёмка', anchor: 'topography', action: 'Загрузите файл съёмки (DXF или GeoJSON) с отметками земли' },
  GEOREFERENCE_MISSING: { title: 'Импорт чертежа: система координат', anchor: 'import', action: 'Укажите систему координат чертежа либо подтвердите привязку по координатной сетке' },
  DWG_LAYERS_UNRESOLVED: { title: 'Импорт чертежа: роли слоёв', anchor: 'import', action: 'Назначьте роль каждому нераспознанному слою в таблице ролей' },
  PLAN_TOPOBASE_MISSING: { title: 'Импорт чертежа: подоснова', anchor: 'import', action: 'Загрузите подоснову: без неё план выходит на пустом листе' },
  FREEZING_DEPTH_UNVERIFIED: { title: 'Геология: глубина промерзания', anchor: 'geology', action: 'Подтвердите одну глубину промерзания из кандидатов отчёта — с грунтом и цитатой' },
  GEOLOGY_COVERAGE_UNVERIFIED: { title: 'Геология: покрытие трассы', anchor: 'geology', action: 'Добавьте скважины вдоль трассы либо подтвердите, что имеющихся достаточно' },
  SPATIAL_GEOLOGY_MISSING: { title: 'Геология: скважины с координатами', anchor: 'geology', action: 'Привяжите скважины к координатам — с чертежа изысканий или из таблицы отчёта' },
  CATALOG_MISSING: { title: 'Каталог труб и материалов', anchor: 'catalog', action: 'Загрузите каталог по шаблону или оставьте активным встроенный ряд' },
  MANHOLE_CONSTRUCTION_MISSING: { title: 'Параметрический каталог колодцев', anchor: 'manhole-catalog', action: 'Заведите конструкции колодцев с предельными глубинами' },
  MANHOLE_SCHEDULE_MISSING: { title: 'Самотёчный расчёт', anchor: 'gravity', action: 'Запустите расчёт: ведомость колодцев строится по его результату' },
  MANHOLE_SCHEDULE_INCOMPLETE: { title: 'Самотёчный расчёт', anchor: 'gravity', action: 'Подберите конструкцию колодцам, оставшимся без позиции каталога' },
  DELIVERABLE_REQUIREMENTS_MISSING: { title: 'Состав проектного комплекта', anchor: 'deliverables', action: 'Задайте состав комплекта: какие разделы и листы выпускаются' },
  BASIN_PRESENTATION_UNDECIDED: { title: 'Состав проектного комплекта', anchor: 'deliverables', action: 'Выберите представление профиля: одной лентой или по бассейнам' },
  DELIVERABLE_REQUIREMENTS_UNVERIFIED: { title: 'Состав проектного комплекта', anchor: 'deliverables', action: 'Подтвердите состав комплекта с указанием источника требования' },
  DELIVERABLE_SOURCE_MISSING: { title: 'Состав проектного комплекта', anchor: 'deliverables', action: 'Назовите источник требования к составу: задание, ТУ или норматив' },
  PROTECTIVE_GRID_DESIGN_MISSING: { title: 'Состав проектного комплекта: защитная сетка', anchor: 'deliverables', action: 'Задайте решение по защитной сетке' },
  EXISTING_SECTION_PROFILE_MISSING: { title: 'Топосъёмка: существующий участок примыкания', anchor: 'topography', action: 'Добавьте отметки существующего участка примыкания' },
  PROTECTIVE_GRID_DESIGN_INCOMPLETE: { title: 'Состав проектного комплекта: защитная сетка', anchor: 'deliverables', action: 'Дозаполните решение по защитной сетке' },
  PROTECTIVE_GRID_DESIGN_UNVERIFIED: { title: 'Состав проектного комплекта: защитная сетка', anchor: 'deliverables', action: 'Подтвердите решение по защитной сетке с источником' },
  CROSSING_CARDS_MISSING: { title: 'Карточки пересечений', anchor: 'crossings', action: 'Создайте карточки для пересечений, отобранных триажем' },
  CROSSING_CARD_INCOMPLETE: { title: 'Карточки пересечений', anchor: 'crossings', action: 'Дозаполните карточки: отметка, диаметр и материал пересекаемой сети' },
  CROSSING_DETAIL_SOURCE_MISSING: { title: 'Карточки пересечений', anchor: 'crossings', action: 'Назовите источник данных о пересекаемой сети: вскрытие, съёмка или эксплуатирующая организация' },
  CROSSING_CLEARANCE_INSUFFICIENT: { title: 'Карточки пересечений', anchor: 'crossings', action: 'Разведите сети по высоте или примите футляр: требуемый просвет не выдержан' },
  NORMS_REQUIRE_REVIEW: { title: 'Нормативный реестр', anchor: 'norms-registry', action: 'Сверьте неподтверждённые пункты с официальными редакциями' },
  SPECIFICATION_SOURCE_MISSING: { title: 'Спецификация', anchor: 'export', action: 'Назовите источник позиций спецификации: каталог проекта или ГОСТ' },
  STORM_RUNOFF_NOT_VERIFIED: { title: 'Дождевая канализация: водосборы', anchor: 'drainage', action: 'Подтвердите расчёт стока по каждому водосбору' },
  GRAVITY_RUN_INFEASIBLE: { title: 'Самотёчный расчёт: осуществимость', anchor: 'gravity', action: 'Подтвердите разбивку на бассейны с перекачкой либо измените трассу' },
  GRAVITY_RUN_SPLIT_INTO_BASINS: { title: 'Самотёчный расчёт: разбивка на бассейны подтверждена', anchor: 'gravity', action: 'Проверьте места перекачек и глубины после разбивки' },
  HYDRAULICS_NOT_VERIFIED: { title: 'Самотёчный расчёт', anchor: 'gravity', action: 'Задайте приток по зданиям: без расчётного расхода наполнение и скорость не проверяются' },
  ROUTE_STALE: { title: 'Ситуационная схема: пересчитать трассу', anchor: 'situation', action: 'Пересчитайте трассу: исходные данные изменились после последнего прогона' },
  ROUTE_BLOCKED: { title: 'Ситуационная схема: стоп-факторы', anchor: 'situation', action: 'Снимите стоп-факторы трассировки, перечисленные в схеме' },
  ROUTE_PRELIMINARY: { title: 'Ситуационная схема: стоп-факторы', anchor: 'situation', action: 'Доведите исходные данные трассы до подтверждённых: расчёт пока предварительный' },
  ROUTE_INPUT_BLOCKER: { title: 'Ситуационная схема: стоп-факторы', anchor: 'situation', action: 'Заполните исходное данное, которого не хватает трассировке' },
  NETWORK_GEOMETRY_MISSING: { title: 'Ситуационная схема', anchor: 'situation', action: 'Постройте сеть: узлов и участков для чертежа пока нет' },
  NETWORK_ALIGNMENT_MISSING: { title: 'Ситуационная схема', anchor: 'situation', action: 'Свяжите узлы сети с осью трассы' },
  PLAN_GEOMETRY_MISSING: { title: 'Ситуационная схема', anchor: 'situation', action: 'Соберите непрерывную ось трассы: план строится по ней' },
  PROFILE_DATA_MISSING: { title: 'Самотёчный расчёт', anchor: 'gravity', action: 'Запустите расчёт: профиль строится по его отметкам' },
  PROFILE_ALIGNMENT_MISSING: { title: 'Самотёчный расчёт', anchor: 'gravity', action: 'Свяжите станции профиля с узлами сети' },
  PROFILE_BRANCHES_MISSING: { title: 'Самотёчный расчёт: ветви', anchor: 'gravity', action: 'Постройте профили ветвей: у сети есть боковые ветви без листа' },
  BRANCH_PROFILE_UNVERIFIED: { title: 'Самотёчный расчёт: ветви', anchor: 'gravity', action: 'Уберите замечания расчёта на участках ветви' },
}

/** Коды, для которых раздел известен. Проверяется тестом против самого шлюза. */
export const READINESS_SECTIONS: Readonly<Record<string, ReadinessTarget>> = SECTION_BY_CODE

const EMPTY_STATUS: Record<WorkingDrawingStatus, number> = {
  BLOCKED: 0, PRELIMINARY: 0, CALCULATED: 0, VERIFIED: 0, STALE: 0,
}

export function summarizeReadiness(set: WorkingDrawingSet): ProjectReadiness {
  const sheets = set.sheets ?? []
  const byStatus = { ...EMPTY_STATUS }
  for (const sheet of sheets) {
    if (sheet.status in byStatus) byStatus[sheet.status] += 1
  }

  // Свод по коду: одна причина держит десяток листов, и десять одинаковых
  // строк на экране скрывают, что причин на самом деле три.
  const merged = new Map<string, ReadinessIssue>()
  for (const sheet of sheets) {
    for (const [issues, blocking] of [[sheet.blockers ?? [], true], [sheet.warnings ?? [], false]] as const) {
      for (const issue of issues) {
        const existing = merged.get(issue.code)
        if (existing) {
          existing.sheetCount += 1
          existing.blocking = existing.blocking || blocking
          continue
        }
        merged.set(issue.code, {
          code: issue.code,
          message: issue.message,
          sheetCount: 1,
          blocking,
          ...(SECTION_BY_CODE[issue.code]
            ? {
              section: SECTION_BY_CODE[issue.code].title,
              anchor: SECTION_BY_CODE[issue.code].anchor,
              action: SECTION_BY_CODE[issue.code].action,
            }
            : {}),
        })
      }
    }
  }

  const issues = [...merged.values()].sort((left, right) =>
    Number(right.blocking) - Number(left.blocking)
    || right.sheetCount - left.sheetCount
    || left.code.localeCompare(right.code))
  const blockingIssueCount = issues.filter((issue) => issue.blocking).length
  const verifiedPercent = sheets.length === 0
    ? 0
    : Math.round((byStatus.VERIFIED / sheets.length) * 1000) / 10

  return {
    sheetCount: sheets.length,
    byStatus,
    verifiedPercent,
    issues,
    blockingIssueCount,
    reason: sheets.length === 0
      ? 'Набор рабочих чертежей пуст: выпускать нечего.'
      : blockingIssueCount === 0
        ? `Стоп-факторов нет: ${byStatus.VERIFIED} из ${sheets.length} листов пригодны к выпуску.`
        : `Выпуск держат ${blockingIssueCount} причин(ы) на ${sheets.length} листах; `
          + `пригодны к выпуску ${byStatus.VERIFIED}. Наибольшая: ${issues[0].code} — ${issues[0].sheetCount} листов.`,
  }
}
