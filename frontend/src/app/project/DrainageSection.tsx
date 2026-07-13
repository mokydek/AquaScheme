import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { computeConsumption, NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { DemandBuildingInput, NormativeParams } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { BuildingRow, DatasetRow } from '../../shared/datasets'
import {
  fetchWaterSourceDemand,
  listWaterProjects,
  setWaterSource,
} from '../../shared/drainage'
import type { DrainageContent, WaterProjectRef } from '../../shared/drainage'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'

/**
 * Drainage consumption for a sewer project (requirements update 3, change 4).
 * Specific wastewater discharge equals specific water demand without
 * irrigation. If the project is linked to a water project, its flows are
 * pulled from there automatically (the single source of truth) and marked
 * "требует пересчёта" when the water calc changes; otherwise the flows are
 * computed from the project's own buildings with the same defaults. The
 * gravity solver (K1) is not implemented yet — this feeds it a single
 * consumption source.
 */
export function DrainageSection({
  projectId,
  buildings,
  normsDataset,
  drainageDataset,
  waterSourceProjectId,
  onChanged,
}: {
  projectId: string
  buildings: BuildingRow[]
  normsDataset: DatasetRow | undefined
  drainageDataset: DatasetRow | undefined
  waterSourceProjectId: string | null
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (drainageDataset?.content ?? null) as DrainageContent | null
  const [waterProjects, setWaterProjects] = useState<WaterProjectRef[]>([])
  const [sourceBuildings, setSourceBuildings] = useState<DemandBuildingInput[] | null>(null)
  const [latestCalcAt, setLatestCalcAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listWaterProjects(projectId).then(setWaterProjects)
  }, [projectId])

  // Pull the linked water project's buildings and its latest calc timestamp.
  useEffect(() => {
    if (!waterSourceProjectId) {
      setSourceBuildings(null)
      setLatestCalcAt(null)
      return
    }
    void fetchWaterSourceDemand(waterSourceProjectId).then((r) => {
      setSourceBuildings(r.buildings)
      setLatestCalcAt(r.latestCalcAt)
    })
  }, [waterSourceProjectId])

  const linked = waterSourceProjectId !== null
  const params: NormativeParams = { ...NORMATIVE_DEFAULTS, ...((normsDataset?.content ?? {}) as Partial<NormativeParams>) }

  const demandBuildings: DemandBuildingInput[] = useMemo(() => {
    if (linked) return sourceBuildings ?? []
    return buildings.map((b) => ({ id: b.id, residents: b.residents ?? 0, specificDemandLpd: b.specific_demand_lpd ?? undefined }))
  }, [linked, sourceBuildings, buildings])

  const consumption = useMemo(() => computeConsumption(demandBuildings, params), [demandBuildings, params])

  // Stale when the source water calc is newer than the accepted snapshot.
  const stale = linked && latestCalcAt !== null && content?.snapshotCalcAt !== latestCalcAt

  const persistSnapshot = async (snapshotCalcAt: string | null) => {
    const next: DrainageContent = { waterSourceProjectId, snapshotCalcAt }
    await saveDataset(projectId, 'drainage', next)
  }

  const onSelectSource = async (waterProjectId: string | null) => {
    setBusy(true)
    try {
      await setWaterSource(projectId, waterProjectId)
      if (waterProjectId) {
        const r = await fetchWaterSourceDemand(waterProjectId)
        await persistSnapshot(r.latestCalcAt)
      } else {
        await persistSnapshot(null)
      }
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const acceptCurrent = async () => {
    setBusy(true)
    try {
      await persistSnapshot(latestCalcAt)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const rows: Array<{ key: string; value: string }> = [
    { key: 'residents', value: String(consumption.water.totalResidents) },
    { key: 'daily', value: consumption.drainageDailyM3.toFixed(2) },
    { key: 'flow', value: consumption.drainageFlowLps.toFixed(2) },
  ]

  return (
    <Panel title={t('project.drainage.title')} status={demandBuildings.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.drainage.hint')}</p>

      <label className="field" style={{ maxWidth: 420 }}>
        <span className="field-label">{t('project.drainage.source')}</span>
        <select
          className="input"
          value={waterSourceProjectId ?? ''}
          disabled={busy}
          onChange={(e) => void onSelectSource(e.target.value || null)}
        >
          <option value="">{t('project.drainage.standalone')}</option>
          {waterProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {linked ? (
        <p className="stat-line ok" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {t('project.drainage.fromWater')} <NormBadge refs={['drainage.equalsWater']} />
        </p>
      ) : (
        <p className="stat-line" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {t('project.drainage.ownBuildings')} <NormBadge refs={['drainage.equalsWater']} />
        </p>
      )}

      {stale && (
        <div className="section-actions">
          <span className="stat-line warn" style={{ marginTop: 0 }}>{t('project.drainage.stale')}</span>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void acceptCurrent()}>
            {t('project.drainage.accept')}
          </button>
        </div>
      )}

      {demandBuildings.length === 0 ? (
        <p className="stat-line">{t('project.drainage.empty')}</p>
      ) : (
        <div className="kv-list">
          {rows.map((row) => (
            <div className="kv" key={row.key}>
              <span className="kv-label">{t(`project.drainage.${row.key}`)}</span>
              <span className="kv-value">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      <p className="hint" style={{ marginTop: 12 }}>{t('project.drainage.solverSoon')}</p>
    </Panel>
  )
}
