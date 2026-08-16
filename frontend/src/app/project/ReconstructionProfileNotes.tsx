import { useTranslation } from 'react-i18next'
import type { ReconstructionProfile } from '@aquascheme/engine'

/**
 * Что дала перезакладка профиля от измеренных лотков.
 *
 * ДВИЖОК СЧИТАЛ ЭТО И РАНЬШЕ, А ЭКРАН НЕ ПОКАЗЫВАЛ. На объекте Станкевича
 * `layReconstructionProfile` находит четыре участка, где измеренные отметки
 * лотка дают уклон ПРОТИВ течения — от −11,04 до −28,27 ‰, — составляет по
 * каждому сообщение с нормой и действием, и всё это оставалось в возвращаемом
 * значении: ни один вид его не читал. Инженер видел глубины 2,91…4,50 м и не
 * знал, что четыре участка из тринадцати не текут.
 *
 * Отсюда и вопрос владельцу внизу: программа не может решить за него, ошибка
 * это в отметках или объект действительно так уложен. Но обязана спросить.
 */
export function ReconstructionProfileNotes({
  reconstruction,
}: {
  reconstruction?: ReconstructionProfile | null
}) {
  const { t } = useTranslation()
  if (!reconstruction) return null
  const { conflicts, shallow, tied, reason, tieNodeIds } = reconstruction
  const clean = conflicts.length === 0 && shallow.length === 0
  return (
    <div data-reconstruction-notes="true">
      <h5>{t('project.gravity.reconstruction.title')}</h5>
      <p className={`stat-line${tied && clean ? ' ok' : ' warn'}`} data-reconstruction-reason="true">
        {reason}
      </p>
      {tieNodeIds.length > 0 && (
        <p className="hint">{t('project.gravity.reconstruction.ties', { count: tieNodeIds.length })}</p>
      )}

      {conflicts.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('project.gravity.reconstruction.thSection')}</th>
                  <th scope="col" className="num">{t('project.gravity.reconstruction.thLength')}</th>
                  <th scope="col" className="num">{t('project.gravity.reconstruction.thSlope')}</th>
                  <th scope="col" className="num">{t('project.gravity.reconstruction.thNorm')}</th>
                  <th scope="col">{t('project.gravity.reconstruction.thWhat')}</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((conflict: ReconstructionProfile['conflicts'][number]) => (
                  <tr key={`${conflict.fromNodeId}-${conflict.toNodeId}`} data-slope-conflict={conflict.kind}>
                    <td>{conflict.fromNodeId} → {conflict.toNodeId}</td>
                    <td className="num">{conflict.lengthM.toFixed(2)}</td>
                    {/* Знак сохраняется: минус здесь и есть весь смысл строки. */}
                    <td className="num warn">{(conflict.actualSlope * 1000).toFixed(2)}</td>
                    <td className="num">
                      {(conflict.minSlope * 1000).toFixed(2)}…{(conflict.maxSlope * 1000).toFixed(2)}
                    </td>
                    <td>{conflict.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
            Вопрос владельцу. Программа не вправе решать за него, ошибка это в
            отметках или объект так уложен: и то и другое встречается, а
            последствия разные — в первом случае правятся исходные данные, во
            втором проектируется перекачка.
          */}
          <p className="stat-line warn" data-reconstruction-question="true">
            {t('project.gravity.reconstruction.question', { count: conflicts.length })}
          </p>
        </>
      )}

      {shallow.length > 0 && (
        <p className="stat-line warn" data-reconstruction-shallow="true">
          {t('project.gravity.reconstruction.shallow', {
            nodes: shallow.map((station: ReconstructionProfile['shallow'][number]) => station.nodeId).join(', '),
            depth: Math.min(...shallow.map((station: ReconstructionProfile['shallow'][number]) => station.depthM)).toFixed(2),
            required: Math.max(...shallow.map((station: ReconstructionProfile['shallow'][number]) => station.requiredDepthM)).toFixed(2),
          })}
        </p>
      )}
    </div>
  )
}
