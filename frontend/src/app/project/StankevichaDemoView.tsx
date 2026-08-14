import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  STANKEVICHA_CHAMBERS,
  STANKEVICHA_CONDITIONS as TU,
  STANKEVICHA_GEOLOGY as GEO,
  STANKEVICHA_MIN_MAIN_DEPTH_M,
  stankevichaChainLengthM,
} from '../../shared/stankevichaDemo'
import { STANKEVICHA_KIT_SLOTS, emptyKitState, runKit } from '../../shared/kitWizard'
import type { KitSlotState, KitState } from '../../shared/kitWizard'
import { saveBasisFile } from '../../shared/basisFiles'
import { KitWizardPanel } from './KitWizardPanel'

/**
 * Демонстрация на настоящем объекте.
 *
 * Учебная сеть показывает, что расчёт работает. Настоящий объект показывает
 * то, чего она показать не может: где программа расходится с документами и на
 * чём стоит шлюз выпуска. Поэтому расхождение здесь выведено первой строкой, а
 * не спрятано в подвале.
 *
 * Величины производные, исходники объекта в репозиторий не входят.
 */
export function StankevichaDemoView({
  projectId,
  confirmedDiameter = null,
}: {
  /** Без него basis-файлы сохранять некуда: слот скажет об этом ошибкой. */
  projectId?: string
  /** Подтверждённый в секции ТУ диаметр — мастер лишь показывает результат. */
  confirmedDiameter?: { valueMm: number; source: string } | null
} = {}) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<Record<string, File | undefined>>({})
  const [kit, setKit] = useState<KitState>(() => emptyKitState())
  const [busySlotId, setBusySlotId] = useState<string | null>(null)

  /**
   * Разбор съёмки — тот же конвейер, что и для подосновы коллектора.
   *
   * Второго разбора DXF в проекте нет и не заводится: счётчики слота берутся
   * из тех же `parseDxfNetwork` и `classifyDxfConstraints`, а нераспознанные
   * слои идут в существующую таблицу ролей.
   */
  const parseSurvey = async (file: File): Promise<KitSlotState> => {
    const { parseDxfNetwork, classifyDxfConstraints } = await import('@aquascheme/engine/dxfread')
    const data = parseDxfNetwork(await file.text())
    if (!data.ok) throw new Error(t('project.kit.dxfUnreadable'))
    const constraints = classifyDxfConstraints(data, {}) as unknown as {
      roles?: Record<string, string>
      textEntities?: unknown[]
      surveyPoints?: unknown[]
    }
    const roles = Object.values(constraints.roles ?? {})
    return {
      kind: 'parsed',
      fileName: file.name,
      counters: [
        { label: t('project.kit.counterLayers'), value: data.layers.length },
        { label: t('project.kit.counterRoledLayers'), value: roles.filter((role) => role !== 'unknown').length },
        { label: t('project.kit.counterPoints'), value: data.points.length },
        { label: t('project.kit.counterSegments'), value: data.segments.length },
        { label: t('project.kit.counterMarks'), value: constraints.textEntities?.length ?? 0 },
        { label: t('project.kit.counterElevations'), value: constraints.surveyPoints?.length ?? 0 },
      ],
    }
  }

  /**
   * ТУ мастер не подтверждает сам: экран подтверждения уже есть в секции
   * извлечения, и второй такой же стал бы вторым источником правды. Слот
   * принимает файл, а величину показывает тогда, когда владелец её подтвердит.
   */
  const acceptConditions = async (file: File): Promise<KitSlotState> => {
    if (!projectId) throw new Error(t('project.kit.noProject'))
    await saveBasisFile(projectId, 'stankevicha_technicalConditions', file.name, { fileName: file.name })
    if (!confirmedDiameter) return { kind: 'stored', fileName: file.name, parsedAtStage: 1 }
    return {
      kind: 'parsed',
      fileName: file.name,
      counters: [{ label: t('project.kit.counterDiameter'), value: confirmedDiameter.valueMm }],
    }
  }

  const storeAsBasis = (slotId: string, stage: number) => async (file: File): Promise<KitSlotState> => {
    if (!projectId) throw new Error(t('project.kit.noProject'))
    await saveBasisFile(projectId, `stankevicha_${slotId}`, file.name, { fileName: file.name })
    return { kind: 'stored', fileName: file.name, parsedAtStage: stage }
  }

  const handlers: Record<string, (file: File) => Promise<KitSlotState>> = Object.fromEntries(
    STANKEVICHA_KIT_SLOTS.map((slot) => [
      slot.id,
      // Полная топооснова и съёмка Станкевича идут одним разбором: это DXF
      // одного вида, и второго конвейера для них не заводится.
      slot.id === 'topobaseFull' || slot.id === 'surveyStankevicha'
        ? parseSurvey
        : slot.id === 'technicalConditions'
          ? acceptConditions
          : storeAsBasis(slot.id, slot.parsedAtStage ?? 2),
    ]),
  )

  const pick = (slotId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setPicked((current) => ({ ...current, [slotId]: file }))
  }

  const run = async () => {
    const next = await runKit(picked, handlers, STANKEVICHA_KIT_SLOTS, (id, value) => {
      setBusySlotId(id)
      setKit((current) => ({ ...current, [id]: value }))
    })
    setKit(next)
    setBusySlotId(null)
  }

  const lengthM = stankevichaChainLengthM()
  const deltaM = lengthM - TU.declaredLengthM
  const deltaPercent = (deltaM / TU.declaredLengthM) * 100
  const depths = STANKEVICHA_CHAMBERS.map((chamber) => chamber.depthM)

  return (
    <div>
      <p className="stat-line">{TU.objectName}</p>
      <KitWizardPanel
        state={kit}
        picked={Object.fromEntries(STANKEVICHA_KIT_SLOTS.map((slot) => [slot.id, picked[slot.id]?.name]))}
        busySlotId={busySlotId}
        onPick={pick}
        onRun={() => { void run() }}
      />
      <p className="hint" data-kit-seed-note="true">{t('project.kit.seedNote')}</p>
      <p className="hint">{t('project.stankevicha.sources')}</p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.stankevicha.thMetric')}</th>
              <th scope="col" className="num">{t('project.stankevicha.thDocuments')}</th>
              <th scope="col" className="num">{t('project.stankevicha.thProgram')}</th>
              <th scope="col">{t('project.stankevicha.thDelta')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('project.stankevicha.metricDiameter')}</td>
              <td className="num">{TU.designDiameterMm}</td>
              <td className="num">{TU.designDiameterMm}</td>
              <td><span className="ok">{t('project.stankevicha.matches')}</span></td>
            </tr>
            <tr>
              <td>{t('project.stankevicha.metricChambers')}</td>
              <td className="num">{TU.declaredChambers}</td>
              <td className="num">{STANKEVICHA_CHAMBERS.length}</td>
              <td>
                {STANKEVICHA_CHAMBERS.length === TU.declaredChambers
                  ? <span className="ok">{t('project.stankevicha.matches')}</span>
                  : <span className="warn">{STANKEVICHA_CHAMBERS.length - TU.declaredChambers}</span>}
              </td>
            </tr>
            <tr>
              <td>{t('project.stankevicha.metricLength')}</td>
              <td className="num">{TU.declaredLengthM}</td>
              <td className="num">{lengthM}</td>
              <td>
                <span className="warn">
                  {deltaM > 0 ? '+' : ''}{deltaM.toFixed(2)} ({deltaPercent > 0 ? '+' : ''}{deltaPercent.toFixed(1)}%)
                </span>
              </td>
            </tr>
            <tr>
              <td>{t('project.stankevicha.metricDepth')}</td>
              <td className="num">{TU.declaredDepthRangeM[0]}…{TU.declaredDepthRangeM[1]}</td>
              <td className="num">{Math.min(...depths).toFixed(2)}…{Math.max(...depths).toFixed(2)}</td>
              <td><span className="hint">{t('project.stankevicha.depthNote')}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="stat-line warn">{t('project.stankevicha.lengthGap')}</p>

      <p className="stat-line">
        {t('project.stankevicha.decisions', { depth: STANKEVICHA_MIN_MAIN_DEPTH_M })}
      </p>
      <p className="stat-line">
        {t('project.stankevicha.geology', {
          boreholes: GEO.boreholes,
          layers: GEO.layers.map((layer) => layer.code).join(', '),
          seismicity: GEO.seismicityPoints,
          freezing: GEO.freezingDepthM.suglinok,
        })}
      </p>
      <p className="stat-line">{t('project.stankevicha.customer', { customer: TU.customer })}</p>
    </div>
  )
}
