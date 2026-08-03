import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReconstructionFromSurvey } from '@aquascheme/engine'
import type { DxfLayerRole, DxfNetworkData } from '@aquascheme/engine/dxfread'
import { DxfLayerRoleTable } from './DxfLayerRoleTable'
import { saveDataset } from '../../shared/datasets'
import { replaceNetwork } from '../../shared/network'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { Panel } from './Panel'

/**
 * Reconstruction laid out from a topographic survey. Replacing a street sewer
 * is the case where the survey already carries the design geometry: the run
 * follows the existing chambers, their invert labels are the profile and the
 * drawn utilities are the crossings. The design bore is asked for separately
 * because technical conditions state it — inferring it from the line being
 * replaced would quietly redesign the project.
 */
export function ReconstructionSurveySection({
  projectId,
  system,
  onSaved,
}: {
  projectId: string
  system: 'sewer' | 'storm'
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [diameterMm, setDiameterMm] = useState('')
  const [clearanceM, setClearanceM] = useState('')
  const [roadWidthM, setRoadWidthM] = useState('')
  const [result, setResult] = useState<ReconstructionFromSurvey | null>(null)
  // Разобранный чертёж держится отдельно, чтобы просвет можно было уточнить
  // без повторной загрузки файла: разбор дороже пересборки в несколько раз.
  const [parsed, setParsed] = useState<DxfNetworkData | null>(null)
  // Роли, назначенные инженером: без них нераспознанные слои блокируют выпуск,
  // а снять блок на этом пути было негде.
  const [roleOverrides, setRoleOverrides] = useState<Partial<Record<string, DxfLayerRole>>>({})
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<'saved' | 'saveError' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const diameter = Number(diameterMm)
  const diameterReady = Number.isFinite(diameter) && diameter > 0
  const clearance = Number(clearanceM)
  const clearanceReady = clearanceM.trim() !== '' && Number.isFinite(clearance) && clearance > 0
  const roadWidth = Number(roadWidthM)
  const roadWidthReady = roadWidthM.trim() !== '' && Number.isFinite(roadWidth) && roadWidth > 0

  const rebuild = async (
    data: DxfNetworkData,
    overrides: Partial<Record<string, DxfLayerRole>> = roleOverrides,
  ) => {
    const { buildReconstructionFromSurvey } = await import('@aquascheme/engine/reconstruction-from-survey')
    setResult(buildReconstructionFromSurvey(data, {
      designDiameterMm: diameter,
      system,
      roleOverrides: overrides,
      // Без величины из ТУ отбор не выполняется: подставлять её нельзя.
      ...(clearanceReady ? { requiredClearanceM: clearance } : {}),
      // Ширина проезжей части: без неё переход под дорогой выявляется, но
      // длина футляра не заполняется — умолчание было бы догадкой в проекте.
      ...(roadWidthReady ? { roadWidthM: roadWidth } : {}),
    }))
  }

  /** Назначение роли слою пересобирает проект: роль меняет и подоснову, и сети. */
  const onLayerRole = async (layer: string, role: DxfLayerRole) => {
    const next = { ...roleOverrides, [layer]: role }
    setRoleOverrides(next)
    if (!parsed) return
    setBusy(true)
    try {
      await rebuild(parsed, next)
    } catch (error) {
      setMessage(uploadErrorText(t, error) ?? t('upload.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage(null)
    setNotice(null)
    setSaveError(null)
    setBusy(true)
    try {
      const routed = await routeUpload(file, ['dxf'])
      const { parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
      const data = parseDxfNetwork(routed.text ?? '')
      setParsed(data)
      await rebuild(data)
      setFileName(file.name)
    } catch (error) {
      setMessage(uploadErrorText(t, error) ?? t('upload.unknown'))
      setResult(null)
      setParsed(null)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  /** Пересборка по уже разобранному чертежу — по уходу фокуса, не на каждый знак. */
  const onClearanceCommitted = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      await rebuild(parsed)
    } catch (error) {
      setMessage(uploadErrorText(t, error) ?? t('upload.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const levelled = result
    ? result.crossings.filter((crossing) => crossing.existingElevationM !== undefined).length
    : 0

  /**
   * Writes the run into the project: the spot heights become the topography
   * dataset and the chamber chain becomes the engineering network, so the rest
   * of the pipeline works on it. Topography is saved first because that call
   * marks the route stale; the network then lands with its own status.
   *
   * Вместе с ними сохраняется и route_constraints. Без него лист плана
   * оставался без подосновы и печатался со штампом «НЕПОЛНЫЙ ПЛАН», а карточки
   * пересечений — вся работа по нивелировке — до альбома вообще не доходили.
   * Координаты уже в системе чертежа, что и топосъёмка с сетью, поэтому
   * переноса нет.
   */
  const save = async () => {
    if (!result || result.network.nodes.length < 2) return
    setSaving(true)
    setNotice(null)
    setSaveError(null)
    try {
      const { buildDxfCadContext } = await import('../../shared/dxfContext')
      const source = result.constraints
      const identity = (point: { x: number; y: number }) => ({ x: point.x, y: point.y })
      const ring = (points: Array<{ x: number; y: number }>) => points.map(identity)
      const unresolvedLayers = Object.entries(source.roles)
        .filter(([, role]) => role === 'unknown')
        .map(([name]) => name)
      await saveDataset(projectId, 'route_constraints', {
        // Геопривязка живёт здесь же: набор рабочих чертежей читает её из
        // route_constraints, и без неё все плановые листы блокировались, хотя
        // координатная сетка чертежа подписана и разобрана.
        georeference: result.georeference,
        corridorRings: source.corridorRings.map(ring),
        guideLines: source.guideAxis,
        redLines: source.redLines,
        utilityLines: source.utilityLines,
        roadLines: [...source.roadLines, ...source.railwayLines],
        waterLines: source.hydrography,
        hardObstacleRings: source.buildingFootprints.map(ring),
        forbiddenRings: source.forbiddenZoneRings.map(ring),
        parcelRings: source.parcelRings.map(ring),
        protectionZoneRings: source.protectionZoneRings.map(ring),
        approvedCrossingRings: source.approvedCrossingRings.map(ring),
        surveyPoints: result.surveyPoints,
        crossings: result.crossings,
        unresolvedLayers,
        ...buildDxfCadContext(source, identity),
        completeness: unresolvedLayers.length > 0
          ? 'blocked-unresolved-layers'
          : 'reviewed-dxf-classification',
      }, {
        roles: source.roles,
        origin: 'reconstruction-from-survey',
        crossingTriage: result.crossingTriage?.summary ?? null,
        depthBands: result.depthBands.reason,
      }, fileName)

      if (result.surveyPoints.length > 0) {
        const zs = result.surveyPoints.map((point) => point.z)
        await saveDataset(
          projectId,
          'topography',
          { points: result.surveyPoints },
          {
            total: result.surveyPoints.length,
            accepted: result.surveyPoints.length,
            zMin: Math.min(...zs),
            zMax: Math.max(...zs),
            source: 'reconstruction-survey',
          },
          fileName,
        )
      }
      await replaceNetwork(projectId, result.network, {
        status: 'calculated',
        // The pipeline's own blockers travel with the route so the reasons the
        // set is not releasable stay attached to it.
        warnings: result.blockers,
        report: {
          origin: 'reconstruction-from-survey',
          designDiameterMm: diameter,
          chamberCount: result.network.nodes.length,
          totalLengthM: result.totalLengthM,
          crossings: result.crossings.length,
          crossingsLevelled: levelled,
          // Отбор на вскрытие уходит в отчёт вместе с сетью: без него неясно,
          // почему выпуск заблокирован именно на стольких пересечениях.
          crossingsNeedLevelling: result.crossingTriage?.needLevelling.length ?? null,
          requiredClearanceM: clearanceReady ? clearance : null,
          depthBandsFromSurvey: result.depthBands.reason,
          grid: result.grid.reason,
        },
      })
      setNotice('saved')
      await onSaved()
    } catch (error) {
      setNotice('saveError')
      setSaveError(error instanceof Error ? error.message : null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title={t('project.reconstruction.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.reconstruction.hint')}</p>

      <div className="section-actions">
        <label htmlFor={`reconstruction-${projectId}-diameter`}>
          {t('project.reconstruction.diameter')}
        </label>
        <input
          id={`reconstruction-${projectId}-diameter`}
          name={`reconstruction-${projectId}-diameter`}
          type="number"
          min="100"
          step="50"
          inputMode="numeric"
          value={diameterMm}
          onChange={(event) => setDiameterMm(event.target.value)}
        />
      </div>

      <div className="section-actions">
        <label htmlFor={`reconstruction-${projectId}-clearance`}>
          {t('project.reconstruction.clearance')}
        </label>
        <input
          id={`reconstruction-${projectId}-clearance`}
          name={`reconstruction-${projectId}-clearance`}
          type="number"
          min="0"
          step="0.05"
          inputMode="decimal"
          value={clearanceM}
          onChange={(event) => setClearanceM(event.target.value)}
          onBlur={() => void onClearanceCommitted()}
        />
      </div>
      <p className="hint">{t('project.reconstruction.clearanceHint')}</p>

      <div className="section-actions">
        <label htmlFor={`reconstruction-${projectId}-road-width`}>
          Ширина проезжей части, м
        </label>
        <input
          id={`reconstruction-${projectId}-road-width`}
          name={`reconstruction-${projectId}-road-width`}
          type="number"
          min="0"
          step="0.5"
          inputMode="decimal"
          value={roadWidthM}
          onChange={(event) => setRoadWidthM(event.target.value)}
          onBlur={() => { if (parsed) void rebuild(parsed) }}
        />
      </div>
      <p className="hint">
        Нужна для длины футляра на переходе под дорогой: ширина плюс запас 5 м с каждой стороны.
        В топосъёмке ширины нет, поэтому без неё переход выявляется, но длина футляра не заполняется
        и позиция в спецификацию не попадает.
      </p>

      <div className="section-actions">
        <input
          id={`reconstruction-${projectId}-file`}
          name={`reconstruction-${projectId}-file`}
          className="file-input"
          type="file"
          accept=".dxf,.dwg"
          disabled={!diameterReady || busy}
          aria-label={`${t('project.reconstruction.title')}: DXF/DWG`}
          onChange={(event) => void onFile(event)}
        />
      </div>
      {!diameterReady && <p className="hint">{t('project.reconstruction.needDiameter')}</p>}
      {busy && <p className="stat-line">{t('project.reconstruction.working')}</p>}
      {message && <p className="notice error">{message}</p>}

      {result && (
        <div className="parse-report">
          <p className="stat-line">{fileName}</p>
          <p className="stat-line">{result.reason}</p>
          <p className="stat-line">
            {t('project.reconstruction.grid', {
              pitch: result.grid.pitchX ?? 0,
              rotation: (result.grid.rotationDeg ?? 0).toFixed(2),
            })}
          </p>
          <p className="stat-line">
            {t('project.reconstruction.terrain', { count: result.surveyPoints.length })}
          </p>
          <p className="stat-line">
            {t('project.reconstruction.crossings', {
              count: result.crossings.length,
              levelled,
            })}
          </p>

          {Object.keys(result.depthBands.bands).length > 0 && (
            <p className="stat-line">
              {t('project.reconstruction.depthBands', {
                count: Object.keys(result.depthBands.bands).length,
              })}
            </p>
          )}

          {result.crossingTriage && (
            <>
              <p className="stat-line">
                {t('project.reconstruction.triage', {
                  need: result.crossingTriage.needLevelling.length,
                  total: result.crossings.length,
                  cleared: result.crossingTriage.items
                    .filter((item) => item.verdict === 'clears_by_margin').length,
                  levelled: result.crossingTriage.items
                    .filter((item) => item.verdict === 'levelled').length,
                })}
              </p>
              {result.crossingTriage.conflicts.length > 0 && (
                <p className="stat-line warn">
                  {t('project.reconstruction.triageConflicts', {
                    count: result.crossingTriage.conflicts.length,
                  })}
                </p>
              )}
            </>
          )}

          {result.existing.pipeLabels.length > 0 && (
            <p className="stat-line">
              {t('project.reconstruction.existingPipes', {
                list: [...new Set(result.existing.pipeLabels
                  .map((label) => `${label.material} ${label.diameterMm}`))].join(', '),
              })}
            </p>
          )}

          {result.blockers.map((blocker) => (
            <p className="stat-line warn" key={blocker}>{blocker}</p>
          ))}

          {parsed && (
            <DxfLayerRoleTable
              idPrefix={`reconstruction-${projectId}`}
              layers={parsed.layers}
              roles={result.constraints.roles}
              onChange={(layer, role) => void onLayerRole(layer, role)}
              disabled={busy}
            />
          )}

          <div className="section-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving || result.network.nodes.length < 2}
              onClick={() => void save()}
            >
              {t('project.reconstruction.save')}
            </button>
          </div>
          <p className="hint">{t('project.reconstruction.saveHint')}</p>
          {notice && (
            <p className={`notice ${notice === 'saved' ? 'info' : 'error'}`}>
              {t(`project.${notice}`)}{saveError ? `: ${saveError}` : ''}
            </p>
          )}

          {result.network.nodes.length > 0 && (
            <table className="data-table">
              <caption>{t('project.reconstruction.chambers')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('project.reconstruction.chamber')}</th>
                  <th scope="col">{t('project.reconstruction.picket')}</th>
                  <th scope="col">{t('project.reconstruction.rim')}</th>
                  <th scope="col">{t('project.reconstruction.invert')}</th>
                  <th scope="col">{t('project.reconstruction.depth')}</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.manholes.map((manhole, index) => (
                  <tr key={manhole.label}>
                    <td>{manhole.label}</td>
                    <td>{manhole.picket}</td>
                    <td>{result.profile.stations[index].groundElevationM.toFixed(2)}</td>
                    <td>{result.profile.stations[index].invertElevationM.toFixed(2)}</td>
                    <td>{(manhole.depthMm / 1000).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Panel>
  )
}
