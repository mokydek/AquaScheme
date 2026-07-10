import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { computeNetworkDemand, NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { NormativeParams } from '@aquascheme/engine'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import { Panel } from './Panel'

export function DemandSection({
  buildings,
  normsDataset,
}: {
  buildings: BuildingRow[]
  normsDataset: DatasetRow | undefined
}) {
  const { t } = useTranslation()

  const demand = useMemo(() => {
    const params: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((normsDataset?.content ?? {}) as Partial<NormativeParams>),
    }
    return computeNetworkDemand(
      buildings.map((b) => ({ id: b.id, residents: b.residents ?? 0 })),
      params,
    )
  }, [buildings, normsDataset])

  const rows: Array<{ key: string; value: string }> = [
    { key: 'residents', value: String(demand.totalResidents) },
    { key: 'avgDaily', value: demand.avgDailyM3.toFixed(2) },
    { key: 'maxDaily', value: demand.maxDailyM3.toFixed(2) },
    { key: 'kHour', value: `${demand.kHourMax.toFixed(2)} (${demand.alphaMax.toFixed(2)} × ${demand.betaMax.toFixed(2)})` },
    { key: 'maxHourly', value: demand.maxHourlyM3h.toFixed(2) },
    { key: 'design', value: demand.designFlowLps.toFixed(2) },
    { key: 'withFire', value: demand.designFlowWithFireLps.toFixed(2) },
  ]

  return (
    <Panel title={t('project.demand.title')} status={buildings.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.demand.hint')}</p>
      {buildings.length === 0 ? (
        <p className="stat-line">{t('project.demand.empty')}</p>
      ) : (
        <div className="kv-list">
          {rows.map((row) => (
            <div className="kv" key={row.key}>
              <span className="kv-label">{t(`project.demand.${row.key}`)}</span>
              <span className="kv-value">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
