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
import { STANKEVICHA_KIT_SLOTS, emptyKitState, runKit, verifyKitAgainstStored } from '../../shared/kitWizard'
import type { KitSlotDefinition, KitSlotState, KitState, KitStoredCheck } from '../../shared/kitWizard'
import { saveBasisFile } from '../../shared/basisFiles'
import { loadDatasetContent } from '../../shared/datasets'
import { formatAppError } from '../../shared/errorFormatting'
import { trainingScreensEnabled } from '../../shared/features'
import { KitWizardPanel } from './KitWizardPanel'

/**
 * Слоты, у которых в этом виде есть разбор.
 *
 * Объявлено списком и связано двумя проверками. Тест сверяет список с составом
 * комплекта, а тип `PARSING_HANDLERS` требует обработчик на каждый пункт
 * списка. Без этой пары слот, объявленный разбираемым и оставшийся без
 * обработчика, молча уходил в ветку basis-файла — «разобрано» превращалось в
 * «отложено» так, что заметить это можно было только глазами.
 */
export const PARSED_KIT_SLOT_IDS = [
  'topobaseFull', 'surveyStankevicha', 'technicalConditions', 'surveyReport', 'geologyReport',
] as const

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
  /**
   * Проект, в который мастер складывает basis-файлы. ОБЯЗАТЕЛЕН.
   *
   * Был необязательным — и это стоило всего пути загрузки объекта. На живом
   * сайте `ProjectPage` рисовал `<StankevichaDemoView />` без проекта, слоты
   * принимали файлы, а прогон отвечал «Проект не открыт: сохранять basis-файл
   * некуда» — пять раз подряд, на странице открытого проекта. TypeScript
   * молчал: проп объявлен необязательным. Проверки монтировали компонент
   * напрямую и тоже молчали: они не видят места вызова.
   *
   * Обязательность — не формальность, а перенос проверки к компилятору:
   * мастер комплекта без проекта не имеет смысла, и теперь его нельзя вызвать
   * без него. Отсутствие выражено типом, а не сообщением об ошибке после того,
   * как пользователь выбрал пять файлов.
   */
  projectId: string
  /** Подтверждённый в секции ТУ диаметр — мастер лишь показывает результат. */
  confirmedDiameter?: { valueMm: number; source: string } | null
}) {
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
  const parseSurvey = (slot: KitSlotDefinition) => async (file: File): Promise<KitSlotState> => {
    const { parseDxfNetwork, classifyDxfConstraints } = await import('@aquascheme/engine/dxfread')
    const data = parseDxfNetwork(await file.text())
    if (!data.ok) throw new Error(t('project.kit.dxfUnreadable'))
    const constraints = classifyDxfConstraints(data, {}) as unknown as {
      roles?: Record<string, string>
      textEntities?: unknown[]
      surveyPoints?: unknown[]
    }
    const roles = Object.values(constraints.roles ?? {})
    /*
      Съёмка попадает и в реестр ИРД, а не только в разбор. Слот разбирал DXF
      и НИЧЕГО не записывал в набор документов: раздел ИРД показывал
      «Топографическая съёмка — не загружено» на проекте, куда её только что
      загрузили. Обе формы съёмки — один документ ИРД, и записанной остаётся
      последняя загруженная: перезапись здесь такая же, как в самом реестре.
    */
    await saveBasisFile(projectId, slot.basisItemId, file.name, {})
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
  const acceptConditions = (slot: KitSlotDefinition) => async (file: File): Promise<KitSlotState> => {
    await saveBasisFile(projectId, slot.basisItemId, file.name, {})
    if (!confirmedDiameter) return { kind: 'stored', fileName: file.name, parsedAtStage: 1 }
    return {
      kind: 'parsed',
      fileName: file.name,
      counters: [{ label: t('project.kit.counterDiameter'), value: confirmedDiameter.valueMm }],
    }
  }

  /**
   * Акт технического обследования: слот считает, подтверждает секция.
   *
   * Тот же уговор, что и с ТУ. Экран подтверждения величин акта уже есть в
   * секции «Существующая сеть и АТО», и второй такой же стал бы вторым
   * источником правды. Слот показывает, СКОЛЬКО величин нашлось в документе, —
   * этого хватает, чтобы владелец увидел, что файл прочитан, а не проглочен.
   */
  const acceptSurveyReport = (slot: KitSlotDefinition) => async (file: File): Promise<KitSlotState> => {
    const { loadPdfTextByPage } = await import('../../shared/pdfText')
    const pages = (await loadPdfTextByPage(file)).map((page, index) => ({
      page: index + 1,
      text: page.items.map((item) => item.str).join(' '),
    }))
    if (pages.every((page) => page.text.trim() === '')) {
      throw new Error(t('project.existing.act.noTextLayer'))
    }
    const { countSurveyActValues, extractSurveyActFacts } = await import('@aquascheme/engine')
    const facts = extractSurveyActFacts(pages)
    /*
      Величины кладутся В ЗАПИСЬ BASIS-ФАЙЛА, а не пересчитываются заново.
      Раньше слот их извлекал, считал и ВЫБРАСЫВАЛ: на экране оставалось
      «величин 10», а ни Ø450, ни 458,94 м, ни глубин 3,7…5,2 м никто не видел.
      Извлечённая и никому не показанная величина равна неизвлечённой.

      Запись одна, и она после разбора: документ без текстового слоя роняет
      слот выше, и незачем оставлять в реестре имя файла, из которого ничего
      не прочитано.
    */
    // Разбор кладётся как есть: `extracted.survey_act` И ЕСТЬ величины акта,
    // без ещё одного слоя с тем же именем.
    await saveBasisFile(projectId, slot.basisItemId, file.name, {}, { ...facts })
    return {
      kind: 'parsed',
      fileName: file.name,
      counters: [
        { label: t('project.kit.counterActValues'), value: countSurveyActValues(facts) },
        { label: t('project.kit.counterPages'), value: pages.length },
      ],
    }
  }

  /**
   * Геологический отчёт: слот его РАЗБИРАЕТ, а не только складывает.
   *
   * Слот был объявлен `basis` с пометкой «разбор — этап 3», и этап третий не
   * наступил. При этом всё для разбора давно написано и лежало без дела:
   * `docxText` достаёт текст из DOCX, `parseGeologyReportSummary` читает из
   * него кандидатов промерзания с грунтом и цитатой, описания ИГЭ и УГВ.
   * Шесть настоящих документов объекта ложились в проект и не сдвигали расчёт.
   *
   * ИЗВЛЕЧЁННОЕ ≠ ПОДТВЕРЖДЁННОЕ. Результат кладётся В ЗАПИСЬ BASIS-ФАЙЛА,
   * рядом с самим документом, а не в набор геологии: в наборе живут величины,
   * подтверждённые инженером, и затирать их разбором нельзя. Раздел геологии
   * читает предложение оттуда и показывает его кандидатами — выбор и
   * подтверждение остаются за инженером.
   */
  const parseGeologyReport = (slot: KitSlotDefinition) => async (file: File): Promise<KitSlotState> => {
    const { docxText } = await import('../../shared/docxText')
    const { parseGeologyReportSummary } = await import('@aquascheme/engine')
    const text = docxText(new Uint8Array(await file.arrayBuffer()))
    if (text.trim() === '') {
      // Молчаливое «сохранено» скрыло бы, что документ не прочитан.
      throw new Error(t('project.kit.docxNoText'))
    }
    const summary = parseGeologyReportSummary(text)
    await saveBasisFile(projectId, slot.basisItemId, file.name, {}, {
      // Предложение разбора: величины с цитатами, без единого выбора.
      freezingDepthCandidates: summary.freezingDepthCandidates,
      ige: summary.ige,
      groundwater: summary.groundwater,
      maxAggressiveness: summary.maxAggressiveness,
    })
    return {
      kind: 'parsed',
      fileName: file.name,
      counters: [
        { label: t('project.kit.counterFreezingCandidates'), value: summary.freezingDepthCandidates.length },
        { label: t('project.kit.counterIge'), value: summary.ige.length },
        { label: t('project.kit.counterChars'), value: text.length },
      ],
    }
  }

  const storeAsBasis = (slot: KitSlotDefinition) => async (file: File): Promise<KitSlotState> => {
    await saveBasisFile(projectId, slot.basisItemId, file.name, {})
    return { kind: 'stored', fileName: file.name, parsedAtStage: slot.parsedAtStage ?? 2 }
  }

  // Полная топооснова и съёмка Станкевича идут одним разбором: это DXF одного
  // вида, и второго конвейера для них не заводится.
  const PARSING_HANDLERS: Record<
    (typeof PARSED_KIT_SLOT_IDS)[number], (slot: KitSlotDefinition) => (file: File) => Promise<KitSlotState>
  > = {
    topobaseFull: parseSurvey,
    surveyStankevicha: parseSurvey,
    technicalConditions: acceptConditions,
    surveyReport: acceptSurveyReport,
    geologyReport: parseGeologyReport,
  }

  const handlers: Record<string, (file: File) => Promise<KitSlotState>> = Object.fromEntries(
    STANKEVICHA_KIT_SLOTS.map((slot) => {
      // Обработчик получает СЛОТ, а не только файл: имя, под которым документ
      // ложится в базу, объявлено в реестре слотов и берётся оттуда. Иначе
      // ключ пришлось бы повторять в каждом обработчике — и он разошёлся бы.
      const parsing = (PARSING_HANDLERS as Record<
        string, ((slot: KitSlotDefinition) => (file: File) => Promise<KitSlotState>) | undefined
      >)[slot.id]
      if (slot.handling !== 'parsed') return [slot.id, storeAsBasis(slot)]
      // Слот объявлен разбираемым, а разбирать нечем. Это дефект сборки, а не
      // повод тихо сохранить файл basis-файлом и отчитаться «отложено».
      if (!parsing) {
        return [slot.id, async () => { throw new Error(t('project.kit.handlerMissing', { slot: slot.id })) }]
      }
      return [slot.id, parsing(slot)]
    }),
  )

  const pick = (slotId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setPicked((current) => ({ ...current, [slotId]: file }))
  }

  /**
   * Прогон и СВЕРКА С БАЗОЙ. Второе — не украшение первого.
   *
   * Мастер отчитывался по числу вызовов, вернувшихся без исключения: шесть
   * успехов при одном ключе в наборе. Теперь после прогона набор `basis`
   * перечитывается, и слот, чьего документа в базе нет, становится ошибкой с
   * причиной. Не удалась сама перечитка — слот не заполнен и не потерян, а
   * «не подтверждён»: врать в обе стороны одинаково нельзя.
   */
  const run = async () => {
    const next = await runKit(picked, handlers, STANKEVICHA_KIT_SLOTS, (id, value) => {
      setBusySlotId(id)
      setKit((current) => ({ ...current, [id]: value }))
    })
    let stored: KitStoredCheck
    try {
      const content = await loadDatasetContent(projectId, 'basis')
      const files = (content as { files?: Record<string, unknown> } | null)?.files
      stored = {
        kind: 'read',
        itemIds: typeof files === 'object' && files !== null ? Object.keys(files) : [],
      }
    } catch (cause) {
      stored = { kind: 'failed', reason: t('project.kit.checkFailed', { reason: formatAppError(cause) }) }
    }
    setKit(verifyKitAgainstStored(next, stored, t('project.kit.notInDatabase')))
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

      {/*
        Ниже — УЧЕБНАЯ выжимка: сравнение величин выжимки с документами. Она
        показывает, что расчёт сходится, но проектом не является и в продовой
        навигации не нужна. Мастер комплекта выше — наоборот, рабочий путь
        загрузки настоящего объекта, и он остаётся всегда.
      */}
      {trainingScreensEnabled() && (
      <>
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
          freezing: GEO.freezingDepthCandidates.map((c) => c.valueM.toFixed(2)).join(' / '),
        })}
      </p>
      <p className="stat-line">{t('project.stankevicha.customer', { customer: TU.customer })}</p>
      </>
      )}
    </div>
  )
}
