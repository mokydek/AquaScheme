import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent } from 'react'
import { buildReconstructionFromSurvey } from '@aquascheme/engine'
import type { ConditionsFromText, ReconstructionFromSurvey } from '@aquascheme/engine'
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
 * в браузере.
 *
 * Диаметр, длину и число колодцев инженер больше не вводит: они написаны в
 * техническом обследовании прямым текстом и читаются из него. Рядом с каждой
 * величиной показывается фрагмент документа, откуда она взята, — иначе
 * проверить прочтение нельзя, а верить программе на слово в проектном деле
 * нечему.
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
  const [conditions, setConditions] = useState<ConditionsFromText | null>(null)
  const [conditionsFile, setConditionsFile] = useState<string | null>(null)

  /**
   * Чтение документа. Скан без текстового слоя даёт пустой текст — об этом
   * говорится прямо, а не молчаливым «ничего не найдено».
   */
  const onConditions = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const { loadPdfTextByPage } = await import('../../shared/pdfText')
      const pages = /\.pdf$/i.test(file.name)
        ? await loadPdfTextByPage(file)
        : []
      const text = pages.length > 0
        ? pages.flatMap((page) => page.items.map((item) => item.str)).join(' ')
        : await file.text()
      if (text.trim() === '') {
        setError(t('project.bundleRun.noTextLayer'))
        setConditions(null)
        return
      }
      const { extractConditionsFromText } = await import('@aquascheme/engine')
      const found = extractConditionsFromText(text)
      setConditions(found)
      setConditionsFile(file.name)
      // Прочитанное подставляется в поля: инженер видит источник и может
      // поправить, но перепечатывать написанное в документе не должен.
      if (found.diameterMm) setDiameterMm(found.diameterMm.value)
      setReference((prev) => ({
        ...prev,
        lengthM: found.lengthM?.value ?? prev.lengthM,
        manholes: found.chambers?.value ?? prev.manholes,
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

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
        // Порог врезок не задаётся: программа находит его по разрыву в
        // распределении глубин и показывает основание. Границы объекта тоже
        // не спрашиваются — цепочка строится от верхового конца до выпуска.
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

      <div className="section-actions">
        <input
          id={`bundle-conditions-${projectId}`}
          name={`bundle-conditions-${projectId}`}
          className="file-input"
          type="file"
          accept=".pdf,.txt"
          aria-label={t('project.bundleRun.conditionsLabel')}
          disabled={busy}
          onChange={(event) => void onConditions(event)}
        />
      </div>
      {conditions && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th scope="col">{t('project.bundleRun.thRead')}</th>
              <th scope="col" className="num">{t('project.bundleRun.thValue')}</th>
              <th scope="col">{t('project.bundleRun.thQuote')}</th>
            </tr></thead>
            <tbody>
              {([
                ['readDiameter', conditions.diameterMm],
                ['readLength', conditions.lengthM],
                ['readChambers', conditions.chambers],
                ['readMaterial', conditions.material],
              ] as const).map(([key, found]) => (
                <tr key={key}>
                  <td>{t(`project.bundleRun.${key}`)}</td>
                  <td className="num">{found ? String(found.value) : '—'}</td>
                  <td className="hint">{found ? `«${found.quote}»` : t('project.bundleRun.notFound')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {conditions && conditions.ambiguous.length > 0 && (
        <p className="stat-line warn">
          {t('project.bundleRun.ambiguous', { list: conditions.ambiguous.join('; ') })}
        </p>
      )}
      {conditionsFile && <p className="stat-line">{t('project.bundleRun.conditionsFile', { name: conditionsFile })}</p>}

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

          {/*
            Отделённые врезки называются поимённо, с глубиной. Иначе порог
            выглядел бы как «убрало три штуки» без возможности проверить, те ли
            это камеры: суждение о принадлежности должно быть перепроверяемым.
          */}
          {result.existing?.laterals?.length ? (
            <p className="stat-line">
              {t('project.bundleRun.laterals', {
                count: result.existing.laterals.length,
                list: result.existing.laterals
                  .map((chamber) => chamber.depthM.toFixed(2))
                  .join(', '),
              })}
            </p>
          ) : null}

          {result.existing?.outsideBounds?.length ? (
            <p className="stat-line">
              {t('project.bundleRun.outsideBounds', { count: result.existing.outsideBounds.length })}
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
