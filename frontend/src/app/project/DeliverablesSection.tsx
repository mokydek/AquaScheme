import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProtectiveGridDesign, WorkingDrawingDeliverableRequirements } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { Panel } from './Panel'

/**
 * Утверждённый состав проектного комплекта.
 *
 * Ни один из этих признаков из чертежей не выводится: их называет задание на
 * проектирование. Пока состав не заявлен и не подтверждён, выпуск запрещён —
 * набор рабочих чертежей ставит стоп-фактор DELIVERABLE_REQUIREMENTS_MISSING.
 * До появления этой секции задать состав было негде, и стоп-фактор висел на
 * каждом проекте, снять его было нельзя.
 *
 * Конструкция защитной сетки спрашивается здесь же: лист сетки требуется
 * заданием, а без подтверждённых размеров изделия его выпустить нельзя, и
 * отметка «лист нужен» без формы создала бы ровно такой же недостижимый
 * стоп-фактор.
 *
 * Данные ложатся в route_constraints рядом с подосновой, откуда их и читает
 * набор листов. Запись идёт слиянием: содержимое набора замещается целиком, и
 * простое сохранение стёрло бы CAD-подоснову.
 */

type Notice = 'saved' | 'saveError' | null

const EMPTY_GRID: ProtectiveGridDesign = {
  quantity: 0,
  overallWidthMm: 0,
  overallHeightMm: 0,
  barSpacingMm: 0,
  frameProfile: '',
  barProfile: '',
  material: '',
  coating: '',
  fixing: '',
  source: '',
  verified: false,
}

export function DeliverablesSection({
  projectId,
  constraintsDataset,
  onSaved,
}: {
  projectId: string
  constraintsDataset: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (constraintsDataset?.content ?? {}) as {
    deliverableRequirements?: WorkingDrawingDeliverableRequirements
    protectiveGridDesign?: ProtectiveGridDesign
  }

  /**
   * Представление профиля при разбивке на бассейны и место напорной перемычки.
   *
   * Пустая строка означает «не выбрано», и это не то же самое, что вариант по
   * умолчанию: пока трасса разбита, а выбор не сделан, набор листов держит
   * стоп-фактор. Оба варианта по каждому вопросу законны, и назначать один из
   * них молча значило бы принять за инженера решение о составе альбома.
   */
  // Начальное значение берётся из набора данных, а не только из эффекта:
  // эффект выполняется после первой отрисовки, и сохранённый выбор на мгновение
  // показывался невыбранным. Эффект ниже остаётся — он ловит смену набора.
  const [basinLayout, setBasinLayout] = useState<'' | 'per_basin' | 'continuous'>(
    content.deliverableRequirements?.basinProfileLayout ?? '')
  const [pressureLink, setPressureLink] = useState<'' | 'same_sheet' | 'separate'>(
    content.deliverableRequirements?.pressureLinkSheets ?? '')
  const [crossingSheets, setCrossingSheets] = useState(false)
  const [gridSheet, setGridSheet] = useState(false)
  const [source, setSource] = useState('')
  const [verified, setVerified] = useState(false)
  const [grid, setGrid] = useState<ProtectiveGridDesign>(EMPTY_GRID)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    const requirements = content.deliverableRequirements
    setBasinLayout(requirements?.basinProfileLayout ?? '')
    setPressureLink(requirements?.pressureLinkSheets ?? '')
    setCrossingSheets(Boolean(requirements?.crossingDetailSheets))
    setGridSheet(Boolean(requirements?.protectiveGridDetail))
    setSource(requirements?.source ?? '')
    setVerified(Boolean(requirements?.verified))
    setGrid(content.protectiveGridDesign ?? EMPTY_GRID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraintsDataset?.id, constraintsDataset?.content])

  const setGridField = <K extends keyof ProtectiveGridDesign>(key: K, value: ProtectiveGridDesign[K]) => {
    setNotice(null)
    setGrid((previous) => ({ ...previous, [key]: value }))
  }

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const existing = (constraintsDataset?.content ?? {}) as Record<string, unknown>
      await saveDataset(
        projectId,
        'route_constraints',
        {
          ...existing,
          deliverableRequirements: {
            crossingDetailSheets: crossingSheets,
            protectiveGridDetail: gridSheet,
            // Невыбранное не сохраняется вовсе: ключ со значением '' выглядел
            // бы как сделанный выбор пустого варианта.
            ...(basinLayout === '' ? {} : { basinProfileLayout: basinLayout }),
            ...(pressureLink === '' ? {} : { pressureLinkSheets: pressureLink }),
            source: source.trim(),
            verified,
          },
          // Конструкцию храним только когда лист заявлен: иначе в проекте
          // осталась бы незаявленная спецификация изделия.
          ...(gridSheet ? { protectiveGridDesign: grid } : { protectiveGridDesign: null }),
        },
        (constraintsDataset?.meta ?? null),
        constraintsDataset?.file_name ?? null,
      )
      setNotice('saved')
      await onSaved()
    } catch {
      setNotice('saveError')
    } finally {
      setBusy(false)
    }
  }

  const numberField = (
    key: 'quantity' | 'overallWidthMm' | 'overallHeightMm' | 'barSpacingMm',
    label: string,
  ) => (
    <label className="field" htmlFor={`deliverables-grid-${key}`}>
      <span className="field-label">{label}</span>
      <input
        id={`deliverables-grid-${key}`}
        name={`deliverables-grid-${key}`}
        className="input"
        type="number"
        min="0"
        inputMode="numeric"
        value={grid[key] === 0 ? '' : String(grid[key])}
        onChange={(event) => setGridField(key, Number(event.target.value))}
      />
    </label>
  )

  const textField = (
    key: 'frameProfile' | 'barProfile' | 'material' | 'coating' | 'fixing' | 'source',
    label: string,
  ) => (
    <label className="field" htmlFor={`deliverables-grid-${key}`}>
      <span className="field-label">{label}</span>
      <input
        id={`deliverables-grid-${key}`}
        name={`deliverables-grid-${key}`}
        className="input"
        type="text"
        value={grid[key]}
        onChange={(event) => setGridField(key, event.target.value)}
      />
    </label>
  )

  return (
    <Panel
      anchor="deliverables"
      title={t('project.deliverables.title')}
      status={content.deliverableRequirements?.verified ? 'filled' : 'empty'}
    >
      <p className="hint">{t('project.deliverables.hint')}</p>

      <div className="form-grid">
        <label className="field" htmlFor="deliverables-source">
          <span className="field-label">{t('project.deliverables.source')}</span>
          <input
            id="deliverables-source"
            name="deliverables-source"
            className="input"
            type="text"
            placeholder={t('project.deliverables.sourcePlaceholder')}
            value={source}
            onChange={(event) => { setNotice(null); setSource(event.target.value) }}
          />
        </label>
      </div>

      {/*
        Два вопроса, на которые у практики два ответа. Спрашиваются здесь, а не
        в самотёчном расчёте, потому что это признаки СОСТАВА комплекта: от них
        зависит число листов и их нумерация, а не расчётные величины.
      */}
      <div className="form-grid">
        <label className="field" htmlFor="deliverables-basin-layout">
          <span className="field-label">{t('project.deliverables.basinLayout')}</span>
          <select
            id="deliverables-basin-layout"
            name="deliverables-basin-layout"
            className="input"
            value={basinLayout}
            onChange={(event) => {
              setNotice(null)
              setBasinLayout(event.target.value as '' | 'per_basin' | 'continuous')
            }}
          >
            <option value="">{t('project.deliverables.notChosen')}</option>
            <option value="per_basin">{t('project.deliverables.basinLayoutPerBasin')}</option>
            <option value="continuous">{t('project.deliverables.basinLayoutContinuous')}</option>
          </select>
        </label>
        <label className="field" htmlFor="deliverables-pressure-link">
          <span className="field-label">{t('project.deliverables.pressureLink')}</span>
          <select
            id="deliverables-pressure-link"
            name="deliverables-pressure-link"
            className="input"
            value={pressureLink}
            onChange={(event) => {
              setNotice(null)
              setPressureLink(event.target.value as '' | 'same_sheet' | 'separate')
            }}
          >
            <option value="">{t('project.deliverables.notChosen')}</option>
            <option value="same_sheet">{t('project.deliverables.pressureLinkSame')}</option>
            <option value="separate">{t('project.deliverables.pressureLinkSeparate')}</option>
          </select>
        </label>
      </div>
      <p className="hint">{t('project.deliverables.basinHint')}</p>

      <label className="field-inline" htmlFor="deliverables-crossing-sheets">
        <input
          id="deliverables-crossing-sheets"
          name="deliverables-crossing-sheets"
          type="checkbox"
          checked={crossingSheets}
          onChange={(event) => { setNotice(null); setCrossingSheets(event.target.checked) }}
        />
        <span>{t('project.deliverables.crossingSheets')}</span>
      </label>

      <label className="field-inline" htmlFor="deliverables-grid-sheet">
        <input
          id="deliverables-grid-sheet"
          name="deliverables-grid-sheet"
          type="checkbox"
          checked={gridSheet}
          onChange={(event) => { setNotice(null); setGridSheet(event.target.checked) }}
        />
        <span>{t('project.deliverables.gridSheet')}</span>
      </label>

      {gridSheet && (
        <>
          <p className="hint">{t('project.deliverables.gridHint')}</p>
          <div className="form-grid">
            {numberField('quantity', t('project.deliverables.grid.quantity'))}
            {numberField('overallWidthMm', t('project.deliverables.grid.width'))}
            {numberField('overallHeightMm', t('project.deliverables.grid.height'))}
            {numberField('barSpacingMm', t('project.deliverables.grid.spacing'))}
            {textField('frameProfile', t('project.deliverables.grid.frame'))}
            {textField('barProfile', t('project.deliverables.grid.bar'))}
            {textField('material', t('project.deliverables.grid.material'))}
            {textField('coating', t('project.deliverables.grid.coating'))}
            {textField('fixing', t('project.deliverables.grid.fixing'))}
            {textField('source', t('project.deliverables.grid.source'))}
          </div>
          <label className="field-inline" htmlFor="deliverables-grid-verified">
            <input
              id="deliverables-grid-verified"
              name="deliverables-grid-verified"
              type="checkbox"
              checked={grid.verified}
              onChange={(event) => setGridField('verified', event.target.checked)}
            />
            <span>{t('project.deliverables.grid.verified')}</span>
          </label>
        </>
      )}

      <label className="field-inline" htmlFor="deliverables-verified">
        <input
          id="deliverables-verified"
          name="deliverables-verified"
          type="checkbox"
          checked={verified}
          onChange={(event) => { setNotice(null); setVerified(event.target.checked) }}
        />
        <span>{t('project.deliverables.verified')}</span>
      </label>

      <div className="section-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !constraintsDataset}
          onClick={() => void save()}
        >
          {t('project.save')}
        </button>
      </div>
      {!constraintsDataset && <p className="hint">{t('project.deliverables.needConstraints')}</p>}
      {notice && (
        <p className={`notice ${notice === 'saved' ? 'info' : 'error'}`}>
          {t(`project.${notice}`)}
        </p>
      )}
    </Panel>
  )
}
