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
 * Где снимают стоп-фактор. Соответствие ведётся здесь, а не в каждом
 * компоненте: подпись «идите в раздел X» рядом с замечанием бесполезна, если
 * она расходится с тем, что на экране.
 */
const SECTION_BY_CODE: Record<string, string> = {
  TOPOGRAPHY_MISSING: 'Топосъёмка',
  GEOREFERENCE_MISSING: 'Импорт чертежа: система координат',
  DWG_LAYERS_UNRESOLVED: 'Импорт чертежа: роли слоёв',
  PLAN_TOPOBASE_MISSING: 'Импорт чертежа: подоснова',
  FREEZING_DEPTH_UNVERIFIED: 'Геология: глубина промерзания',
  GEOLOGY_COVERAGE_UNVERIFIED: 'Геология: покрытие трассы',
  SPATIAL_GEOLOGY_MISSING: 'Геология: скважины с координатами',
  CATALOG_MISSING: 'Каталог труб и материалов',
  MANHOLE_CONSTRUCTION_MISSING: 'Параметрический каталог колодцев',
  MANHOLE_SCHEDULE_MISSING: 'Самотёчный расчёт',
  MANHOLE_SCHEDULE_INCOMPLETE: 'Самотёчный расчёт',
  DELIVERABLE_REQUIREMENTS_MISSING: 'Состав проектного комплекта',
  DELIVERABLE_REQUIREMENTS_UNVERIFIED: 'Состав проектного комплекта',
  DELIVERABLE_SOURCE_MISSING: 'Состав проектного комплекта',
  PROTECTIVE_GRID_DESIGN_MISSING: 'Состав проектного комплекта: защитная сетка',
  PROTECTIVE_GRID_DESIGN_INCOMPLETE: 'Состав проектного комплекта: защитная сетка',
  PROTECTIVE_GRID_DESIGN_UNVERIFIED: 'Состав проектного комплекта: защитная сетка',
  CROSSING_CARDS_MISSING: 'Карточки пересечений',
  CROSSING_CARD_INCOMPLETE: 'Карточки пересечений',
  CROSSING_DETAIL_SOURCE_MISSING: 'Карточки пересечений',
  CROSSING_CLEARANCE_INSUFFICIENT: 'Карточки пересечений',
  NORMS_REQUIRE_REVIEW: 'Нормативный реестр',
  SPECIFICATION_SOURCE_MISSING: 'Спецификация',
  STORM_RUNOFF_NOT_VERIFIED: 'Дождевая канализация: водосборы',
  GRAVITY_RUN_INFEASIBLE: 'Самотёчный расчёт: осуществимость',
  GRAVITY_RUN_SPLIT_INTO_BASINS: 'Самотёчный расчёт: разбивка на бассейны подтверждена',
  HYDRAULICS_NOT_VERIFIED: 'Самотёчный расчёт',
  ROUTE_STALE: 'Ситуационная схема: пересчитать трассу',
  ROUTE_BLOCKED: 'Ситуационная схема: стоп-факторы',
  ROUTE_PRELIMINARY: 'Ситуационная схема: стоп-факторы',
  ROUTE_INPUT_BLOCKER: 'Ситуационная схема: стоп-факторы',
  NETWORK_GEOMETRY_MISSING: 'Ситуационная схема',
  NETWORK_ALIGNMENT_MISSING: 'Ситуационная схема',
  PLAN_GEOMETRY_MISSING: 'Ситуационная схема',
  PROFILE_DATA_MISSING: 'Самотёчный расчёт',
  PROFILE_ALIGNMENT_MISSING: 'Самотёчный расчёт',
  PROFILE_BRANCHES_MISSING: 'Самотёчный расчёт: ветви',
  BRANCH_PROFILE_UNVERIFIED: 'Самотёчный расчёт: ветви',
}

/** Коды, для которых раздел известен. Проверяется тестом против самого шлюза. */
export const READINESS_SECTIONS: Readonly<Record<string, string>> = SECTION_BY_CODE

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
          ...(SECTION_BY_CODE[issue.code] ? { section: SECTION_BY_CODE[issue.code] } : {}),
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
