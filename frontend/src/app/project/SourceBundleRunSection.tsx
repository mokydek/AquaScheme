import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent } from 'react'
import { buildReconstructionFromSurvey } from '@aquascheme/engine'
import type { ReconstructionFromSurvey } from '@aquascheme/engine'
import { routeUpload } from '../../shared/upload'
import { Panel } from './Panel'

/**
 * Прогон комплекта исходных данных объекта.
 *
 * Отвечает на один вопрос: что выдаст программа, если положить в неё съёмку
 * реального объекта, и чем это отличается от того, что записано в документах.
 *
 * Эталонные величины вводятся отдельно и в расчёт не подставляются: они нужны
 * только для сравнения. Подгонять по ним расчёт нельзя — расхождение это
 * находка, а не ошибка ввода, и решение по нему принимает инженер.
 *
 * Данные объекта здесь не хранятся и в репозиторий не попадают: файл читается
 * в браузере, эталон вводится руками.
 */

interface Reference {
  lengthM?: number
  manholes?: number
  diameterMm?: number
}

function Delta({ ours, reference }: { ours: number | null; reference?: number }) {
  const { t } = useTranslation()
  if (ours === null || reference === undefined || !Number.isFinite(reference)) {
    return <span className="hint">{t('project.bundleRun.noReference')}</span>
  }
  const delta = ours - reference
  const percent = reference !== 0 ? (delta / reference) * 100 : 0
  if (Math.abs(delta) < 1e-9) return <span className="ok">{t('project.bundleRun.matches')}</span>
  return (
    <span className="warn">
      {delta > 0 ? '+' : ''}{delta.toFixed(2)} ({percent > 0 ? '+' : ''}{percent.toFixed(1)}%)
    </span>
  )
}

export function SourceBundleRunSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReconstructionFromSurvey | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [diameterMm, setDiameterMm] = useState<number | null>(null)
  const [reference, setReference] = useState<Reference>({})

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // DWG принимается тоже: routeUpload сам отправляет его в конвертер и
      // возвращает уже DXF, поэтому в списке ожидаемых видов его нет.
      const routed = await routeUpload(file, ['dxf'])
      const { parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
      const data = parseDxfNetwork(routed.text ?? await routed.file.text())
      // Диаметр берётся из технических условий, а не из съёмки: в съёмке он
      // относится к существующей трубе, а проектируется по ТУ.
      setResult(buildReconstructionFromSurvey(data, {
        designDiameterMm: diameterMm ?? 0,
        system: 'sewer',
      }))
      setFileName(file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const chainCount = result?.network?.nodes?.length ?? null
  const lengthM = result ? result.totalLengthM : null

  return (
    <Panel title={t('project.bundleRun.title')} status={result ? 'filled' : 'empty'}>
      <p className="hint">{t('project.bundleRun.hint')}</p>

      <div className="form-grid">
        <label className="field" htmlFor={`bundle-diameter-${projectId}`}>
          <span className="field-label">{t('project.bundleRun.diameter')}</span>
          <input
            id={`bundle-diameter-${projectId}`}
            name={`bundle-diameter-${projectId}`}
            className="input"
            type="number"
            min={0}
            step={50}
            value={diameterMm ?? ''}
            disabled={busy}
            onChange={(event) => {
              const value = Number(event.target.value)
              setDiameterMm(Number.isFinite(value) && value > 0 ? value : null)
            }}
          />
        </label>
        <label className="field" htmlFor={`bundle-ref-length-${projectId}`}>
          <span className="field-label">{t('project.bundleRun.refLength')}</span>
          <input
            id={`bundle-ref-length-${projectId}`}
            name={`bundle-ref-length-${projectId}`}
            className="input"
            type="number"
            min={0}
            step={0.01}
            value={reference.lengthM ?? ''}
            disabled={busy}
            onChange={(event) => setReference((prev) => ({
              ...prev,
              lengthM: event.target.value === '' ? undefined : Number(event.target.value),
            }))}
          />
        </label>
        <label className="field" htmlFor={`bundle-ref-manholes-${projectId}`}>
          <span className="field-label">{t('project.bundleRun.refManholes')}</span>
          <input
            id={`bundle-ref-manholes-${projectId}`}
            name={`bundle-ref-manholes-${projectId}`}
            className="input"
            type="number"
            min={0}
            step={1}
            value={reference.manholes ?? ''}
            disabled={busy}
            onChange={(event) => setReference((prev) => ({
              ...prev,
              manholes: event.target.value === '' ? undefined : Number(event.target.value),
            }))}
          />
        </label>
      </div>

      <div className="section-actions">
        <input
          id={`bundle-file-${projectId}`}
          name={`bundle-file-${projectId}`}
          className="file-input"
          type="file"
          accept=".dwg,.dxf"
          aria-label={t('project.bundleRun.fileLabel')}
          disabled={busy || diameterMm === null}
          onChange={(event) => void onFile(event)}
        />
      </div>
      {diameterMm === null && <p className="stat-line warn">{t('project.bundleRun.needDiameter')}</p>}
      {error && <p className="notice error">{error}</p>}

      {result && (
        <>
          <p className="stat-line">{t('project.bundleRun.file', { name: fileName ?? '' })}</p>
          <p className="stat-line">{result.reason}</p>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('project.bundleRun.thMetric')}</th>
                  <th scope="col" className="num">{t('project.bundleRun.thOurs')}</th>
                  <th scope="col" className="num">{t('project.bundleRun.thReference')}</th>
                  <th scope="col">{t('project.bundleRun.thDelta')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('project.bundleRun.metricLength')}</td>
                  <td className="num">{lengthM === null ? '—' : lengthM.toFixed(2)}</td>
                  <td className="num">{reference.lengthM ?? '—'}</td>
                  <td><Delta ours={lengthM} reference={reference.lengthM} /></td>
                </tr>
                <tr>
                  <td>{t('project.bundleRun.metricManholes')}</td>
                  <td className="num">{chainCount ?? '—'}</td>
                  <td className="num">{reference.manholes ?? '—'}</td>
                  <td><Delta ours={chainCount} reference={reference.manholes} /></td>
                </tr>
                <tr>
                  <td>{t('project.bundleRun.metricCrossings')}</td>
                  <td className="num">{result.crossings?.length ?? 0}</td>
                  <td className="num">—</td>
                  <td><span className="hint">{t('project.bundleRun.noReference')}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/*
            Отброшенные камеры показываются рядом с блокерами намеренно: на
            реальном объекте именно они и объясняли нехватку колодцев, а по
            одному лишь блокеру это выглядело как пробел в съёмке.
          */}
          {result.existing?.detachedCount ? (
            <p className="stat-line warn">
              {t('project.bundleRun.detached', { count: result.existing.detachedCount })}
            </p>
          ) : null}

          <h5>{t('project.bundleRun.blockers')}</h5>
          {result.blockers.length === 0
            ? <p className="stat-line ok">{t('project.bundleRun.noBlockers')}</p>
            : result.blockers.map((blocker) => (
              <p className="notice error" key={blocker}>{blocker}</p>
            ))}
        </>
      )}
    </Panel>
  )
}
