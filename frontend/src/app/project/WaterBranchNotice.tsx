import { useTranslation } from 'react-i18next'
import { NORM_REGISTRY, unverifiedClauses, waterBranchNormStatus } from '@aquascheme/engine'

/**
 * Проект В1 при выключенном флаге объясняет себя.
 *
 * Раньше разделы просто исчезали. Проект открывался, но был пуст, и почему —
 * не говорилось нигде: отсутствие было выражено ПУСТОТОЙ, а не названо. По
 * меркам проекта это та же молчаливая подстановка, что и ноль вместо отметки,
 * только на экране. Инженер видел проект, который «сломался».
 *
 * Здесь одно состояние вместо исчезнувших разделов: почему закрыто, что с
 * данными, когда вернётся и где снимается причина. Числа берутся из реестра
 * (`waterBranchNormStatus`), а не пишутся в текст: сверят пункт — счётчик
 * уменьшится сам.
 *
 * Второго флага не заводится, нового стоп-фактора тоже: причина уже есть в
 * общей карте — `NORMS_REQUIRE_REVIEW`, — и адрес берётся оттуда же, откуда его
 * берут все прочие причины на листах.
 */
export function WaterBranchNotice() {
  const { t } = useTranslation()
  const status = waterBranchNormStatus(unverifiedClauses(), NORM_REGISTRY.length)
  return (
    <section className="panel" id="water-branch-unavailable" data-water-branch-unavailable="true">
      <h2>{t('project.waterBranch.title')}</h2>
      <p className="stat-line warn" data-water-branch-reason="true">
        {t('project.waterBranch.reason', {
          applicable: status.applicableToWater,
          unverified: status.unverifiedClauses,
          registry: status.registryClauses,
        })}
      </p>
      {/* Данные — первое, о чём спрашивает владелец, увидевший пустой экран. */}
      <p className="stat-line ok" data-water-branch-data="true">{t('project.waterBranch.dataIntact')}</p>
      <p className="stat-line" data-water-branch-export="true">{t('project.waterBranch.exportBlocked')}</p>
      <p className="stat-line">{t('project.waterBranch.returns')}</p>
      {/* Адрес причины — из общей карты разделов, а не выдуман для этого экрана. */}
      <p className="hint">
        {t('project.waterBranch.whereFixed', { section: status.target.title, action: status.target.action })}
        {' '}
        <a href={`#${status.target.anchor}`}>{t('project.waterBranch.openSection')}</a>
      </p>
      <p className="hint mono" data-water-branch-code="true">{status.code}</p>
    </section>
  )
}
