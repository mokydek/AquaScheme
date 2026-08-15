import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSituationSteps } from '@aquascheme/engine'
import type { SituationStepsInput } from '@aquascheme/engine'
import { buildSituationSchemeSvg } from '../../shared/projectAlbum'
import type { SituationSchemeInput } from '../../shared/projectAlbum'

/**
 * Ситуационная схема — по загруженной топооснове.
 *
 * Прежний вид рисовал схему сам: белый лист, синяя ломаная и «подоснова» из
 * координат зданий, — и показывал ноль из тринадцати тысяч линий загруженного
 * чертежа. Плюс проигрыватель с кнопкой «Нарисовать заново», который к чертежу
 * отношения не имел вовсе.
 *
 * Теперь схему строит тот же отрисовщик, что и плановые листы, теми же
 * измеренными стилями. Список шагов остался, но не как проигрыватель, а как
 * то, ради чего он и заводился: перечень слоёв с указанием, из чего каждый
 * нарисован и чего в проекте нет.
 */
export function SituationSchemeView({
  scheme,
  steps: stepsInput,
}: {
  scheme: SituationSchemeInput
  steps: SituationStepsInput
}) {
  const { t } = useTranslation()
  const built = useMemo(() => buildSituationSchemeSvg(scheme), [scheme])
  const steps = useMemo(() => buildSituationSteps(stepsInput), [stepsInput])

  // Топоосновы нет вовсе — рисовать нечего, и вместо выдуманной графики
  // называется раздел, где съёмка загружается.
  const withoutTopobase = built.missing.includes('topobase')

  return (
    <div data-situation-scheme-view="true">
      {withoutTopobase ? (
        <p className="notice error" data-scheme-empty="true">
          {t('project.scheme.needTopobase')}{' '}
          <a href="#import" data-scheme-jump="import">{t('project.scheme.needTopobaseSection')}</a>
        </p>
      ) : (
        <>
          <div
            className="table-wrap"
            data-scheme-svg="true"
            /*
              Схема — это SVG, собранный тем же отрисовщиком, что и лист
              альбома. Разметка вставляется как есть: она построена из данных
              проекта, а не пришла извне.
            */
            dangerouslySetInnerHTML={{ __html: built.svg }}
          />
          <p className="hint">
            {t('project.scheme.basis', {
              scale: built.scaleDenominator,
              lines: built.contextLines,
              dropped: built.droppedLines,
            })}
          </p>
        </>
      )}

      {/*
        Полоса отвода — отдельный слой, и её отсутствие схему не блокирует:
        на Станкевича её нет, а схема нужна. Пробел назван строкой с адресом.
      */}
      {built.missing.includes('corridor') && !withoutTopobase && (
        <p className="stat-line warn" data-scheme-missing="corridor">
          {t('project.scheme.noCorridor')}{' '}
          <a href="#parcels" data-scheme-jump="parcels">{t('project.scheme.noCorridorSection')}</a>
        </p>
      )}

      <ol className="kv-list" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {steps.map((step) => (
          <li key={step.id} className="kv" data-scheme-step={step.id}>
            <span className="kv-label">{t(`project.gravity.builder.step.${step.id}`)}</span>
            <span className={step.present ? 'kv-value' : 'kv-value warn'}>
              {t(`project.gravity.builder.source.${step.sourceKey}`, step.stats)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
