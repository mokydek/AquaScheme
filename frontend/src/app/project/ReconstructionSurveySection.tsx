import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReconstructionFromSurvey } from '@aquascheme/engine'
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
}: {
  projectId: string
  system: 'sewer' | 'storm'
}) {
  const { t } = useTranslation()
  const [diameterMm, setDiameterMm] = useState('')
  const [result, setResult] = useState<ReconstructionFromSurvey | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const diameter = Number(diameterMm)
  const diameterReady = Number.isFinite(diameter) && diameter > 0

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage(null)
    setBusy(true)
    try {
      const routed = await routeUpload(file, ['dxf'])
      const [{ parseDxfNetwork }, { buildReconstructionFromSurvey }] = await Promise.all([
        import('@aquascheme/engine/dxfread'),
        import('@aquascheme/engine/reconstruction-from-survey'),
      ])
      setResult(buildReconstructionFromSurvey(parseDxfNetwork(routed.text ?? ''), {
        designDiameterMm: diameter,
        system,
      }))
      setFileName(file.name)
    } catch (error) {
      setMessage(uploadErrorText(t, error) ?? t('upload.unknown'))
      setResult(null)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const levelled = result
    ? result.crossings.filter((crossing) => crossing.existingElevationM !== undefined).length
    : 0

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
