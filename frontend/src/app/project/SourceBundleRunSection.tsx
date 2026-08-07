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
 * Сравнение с документом делает движок, а не эта секция: там оно покрыто
 * тестами и одинаково во всех путях. Подгонять расчёт под документ нельзя —
 * расхождение это находка, и решение по нему принимает инженер.
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

export function SourceBundleRunSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReconstructionFromSurvey | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [diameterMm, setDiameterMm] = useState<number | null>(null)
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
      // Прочитанное подставляется в поле диаметра: инженер видит источник и
      // может поправить, но перепечатывать написанное в документе не должен.
      // Длина и число колодцев в поля не идут вовсе — они уходят на сверку.
      if (found.diameterMm) setDiameterMm(found.diameterMm.value)
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
        // Прочитанный документ идёт не во вход расчёта, а на сверку: программа
        // считает всё по съёмке и сама сообщает, где расходится с отчётом.
        ...(conditions ? { document: conditions } : {}),
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

          {/*
            Длина оси и длина трубы разведены намеренно: спецификация заказывает
            вторую, и пока они были одним числом, трубы заказывалось больше на
            все камеры трассы.
          */}
          <p className="stat-line">{result.pipeLength.reason}</p>

          {/*
            Сверку с документом делает движок. Здесь только показ: величина,
            что вышло по чертежу, что написано в отчёте и в чём разница.
          */}
          {result.agreement && result.agreement.checks.length > 0 && (
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
                  {result.agreement.checks.map((check) => (
                    <tr key={check.quantity}>
                      <td>{check.quantity}</td>
                      <td className="num">{check.fromSurvey}</td>
                      <td className="num">{check.fromDocument}</td>
                      <td className={check.agrees ? 'ok' : 'warn'}>{check.note}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>{t('project.bundleRun.metricCrossings')}</td>
                    <td className="num">{result.crossings?.length ?? 0}</td>
                    <td className="num">—</td>
                    <td><span className="hint">{t('project.bundleRun.noReference')}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/*
            Главный вопрос реконструкции — годится ли существующий профиль под
            проектную трубу. Ответ считается по отметкам лотков без ввода.
          */}
          <h5>{t('project.bundleRun.slopes')}</h5>
          <p className={result.slopes.counter + result.slopes.belowMin === 0 ? 'stat-line ok' : 'stat-line warn'}>
            {result.slopes.summary}
          </p>
          <p className="hint">
            {t('project.bundleRun.minSlope', {
              value: (result.slopes.minSlope.value * 1000).toFixed(2),
              note: result.slopes.minSlope.note ?? '',
            })}
          </p>
          {result.slopes.spans.filter((span) => span.verdict !== 'ok').length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('project.bundleRun.thSpan')}</th>
                    <th scope="col" className="num">{t('project.bundleRun.thSpanLength')}</th>
                    <th scope="col">{t('project.bundleRun.thSpanVerdict')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.slopes.spans.filter((span) => span.verdict !== 'ok').map((span) => (
                    <tr key={span.pipeId}>
                      <td>{span.fromNodeId} → {span.toNodeId}</td>
                      <td className="num">{span.lengthM.toFixed(1)}</td>
                      <td className="warn">{span.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
