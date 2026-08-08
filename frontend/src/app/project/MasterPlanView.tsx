import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { compareWithMasterPlan } from '@aquascheme/engine'
import type { PlanSegment, SchemeComparisonRow } from '@aquascheme/engine'

/**
 * Сверка проекта со схемой генплана.
 *
 * Задание на проектирование требует принять схему генплана за основу и
 * обосновывать отклонения расчётом. Расчёт при этом ведёт себя честно: если по
 * расходу нужен другой диаметр, он его и подберёт. Без сверки такое расхождение
 * всплывает только на экспертизе — сравнить своими глазами два десятка участков
 * с бумажной схемой инженер, разумеется, может, но именно этого он и не делает.
 *
 * Расхождение здесь не ошибка и не правится само: `compareWithMasterPlan`
 * возвращает разницу в шагах ряда, а решение — за инженером.
 */

export interface MasterPlanContent {
  segments?: PlanSegment[]
}

export interface MasterPlanPipe {
  id: string
  diameterMm: number
  parallelLines?: number
  flowLps?: number
  /** Диаметр принят наименьшим из ряда, потому что расчётного расхода нет. */
  diameterAdoptedWithoutFlow?: boolean
}

/** Строки, о которых генплан молчит, отделены от настоящих расхождений. */
const DEVIATIONS = new Set(['stepDiffers', 'linesDiffer', 'missingInDesign'])

export function MasterPlanView({
  pipes,
  content,
  onChange,
  disabled = false,
  fieldPrefix,
  error,
}: {
  pipes: MasterPlanPipe[]
  content: MasterPlanContent
  onChange: (next: MasterPlanContent) => void
  disabled?: boolean
  /** Префикс идентификаторов полей: на странице может быть несколько таблиц. */
  fieldPrefix: string
  /** Ошибка сохранения. Без неё введённый диаметр просто исчезал бы при
   * следующей загрузке, и причину было бы негде увидеть. */
  error?: string | null
}) {
  const { t } = useTranslation()
  const segments = content.segments ?? []
  const planById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  )

  const comparison = useMemo(
    () => compareWithMasterPlan(
      pipes.map((pipe) => ({
        id: pipe.id,
        designDiameterMm: pipe.diameterMm,
        parallelLines: pipe.parallelLines,
        designFlowLps: pipe.flowLps,
        // Диаметр, принятый от безысходности, с генпланом не сравнивается:
        // расхождение говорило бы не о проекте, а об отсутствии расхода.
        diameterAdoptedWithoutFlow: pipe.diameterAdoptedWithoutFlow === true,
      })),
      segments,
    ),
    [pipes, segments],
  )

  const upsert = (id: string, next: PlanSegment | null) => {
    const rest = segments.filter((segment) => segment.id !== id)
    onChange({ segments: next ? [...rest, next] : rest })
  }

  /**
   * Диаметр обнулили — строка генплана снимается целиком: ноль как диаметр
   * означал бы, что генплан назначил ноль, а он просто не назначил ничего.
   */
  const setDiameter = (id: string, value: number) => {
    const current = planById.get(id)
    upsert(id, value > 0 ? { ...current, id, planDiameterMm: value } : null)
  }

  /** Число ниток без диаметра генплана смысла не имеет: строки ещё нет. */
  const setLines = (id: string, value: number) => {
    const current = planById.get(id)
    if (!current) return
    upsert(id, value > 1
      ? { ...current, parallelLines: value }
      : { id: current.id, planDiameterMm: current.planDiameterMm })
  }

  const byId = new Map(comparison.rows.map((row) => [row.id, row]))
  const deviations = comparison.rows.filter((row) => DEVIATIONS.has(row.verdict))
  // Участки генплана, которых в проекте нет: строки без соответствующей трубы,
  // поэтому в таблицу ввода они не попадают и показываются отдельно.
  const missing = comparison.rows.filter((row) => row.verdict === 'missingInDesign')

  const verdictLabel = (row: SchemeComparisonRow) =>
    t(`project.masterPlan.verdict.${row.verdict}`)

  return (
    <details style={{ marginTop: 12 }}>
      <summary className="field-label">
        {segments.length === 0
          ? t('project.masterPlan.titleEmpty')
          : t('project.masterPlan.title', {
            deviations: deviations.length,
            covered: segments.length,
          })}
      </summary>
      <p className="hint">{t('project.masterPlan.hint')}</p>

      {segments.length > 0 && (
        <p className={deviations.length > 0 ? 'stat-line warn' : 'stat-line'}>
          {deviations.length > 0
            ? t('project.masterPlan.summaryDiffers', {
              deviations: deviations.length,
              matched: comparison.matched,
            })
            : t('project.masterPlan.summaryAgrees', { matched: comparison.matched })}
        </p>
      )}

      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.masterPlan.thSegment')}</th>
              <th scope="col" className="num">{t('project.masterPlan.thDesign')}</th>
              <th scope="col" className="num">{t('project.masterPlan.thPlan')}</th>
              <th scope="col" className="num">{t('project.masterPlan.thPlanLines')}</th>
              <th scope="col">{t('project.masterPlan.thVerdict')}</th>
            </tr>
          </thead>
          <tbody>
            {pipes.map((pipe) => {
              const plan = planById.get(pipe.id)
              const row = byId.get(pipe.id)
              const fieldId = `${fieldPrefix}-plan-${encodeURIComponent(pipe.id)}`
              return (
                <tr key={pipe.id}>
                  <td className="mono">{pipe.id}</td>
                  <td className="num">{pipe.diameterMm}</td>
                  <td className="num">
                    <input
                      id={fieldId}
                      name={fieldId}
                      className="input input-sm"
                      type="number"
                      min={0}
                      step={50}
                      aria-label={t('project.masterPlan.planAria', { segment: pipe.id })}
                      disabled={disabled}
                      value={plan?.planDiameterMm ?? ''}
                      onChange={(event) => setDiameter(pipe.id, Number(event.target.value))}
                    />
                  </td>
                  <td className="num">
                    <input
                      id={`${fieldId}-lines`}
                      name={`${fieldId}-lines`}
                      className="input input-sm"
                      type="number"
                      min={1}
                      step={1}
                      aria-label={t('project.masterPlan.linesAria', { segment: pipe.id })}
                      disabled={disabled || !plan}
                      value={plan?.parallelLines ?? ''}
                      onChange={(event) => setLines(pipe.id, Math.floor(Number(event.target.value)))}
                    />
                  </td>
                  <td className={row && DEVIATIONS.has(row.verdict) ? 'warn' : ''}>
                    {!plan
                      ? t('project.masterPlan.verdict.noPlanRow')
                      : `${verdictLabel(row!)}${row!.stepDelta ? t('project.masterPlan.stepDelta', { delta: row!.stepDelta > 0 ? `+${row!.stepDelta}` : row!.stepDelta }) : ''}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <p className="stat-line warn">
          {t('project.masterPlan.missing', { list: missing.map((row) => row.id).join(', ') })}
        </p>
      )}

      {error && <p className="notice">{error}</p>}
      <p className="hint">{t('project.masterPlan.migrationHint')}</p>
    </details>
  )
}
