import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { placeFittings, selectMaterials } from '@aquascheme/engine'
import type { FittingsPlan, GeologyInput, MaterialSelection, SeismicInput } from '@aquascheme/engine'
import type { SizingResult } from '@aquascheme/engine/sizing'
import { supabase } from '../../shared/supabase'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import { Panel } from './Panel'

interface EquipmentContent {
  material: MaterialSelection
  fittings: FittingsPlan
}

const MATERIAL_LABELS: Record<string, string> = {
  PE100_SDR17: 'ПЭ100 SDR17',
  PE100_SDR11: 'ПЭ100 SDR11',
  DUCTILE_IRON: 'ВЧШГ',
  STEEL: 'Сталь',
  PVC: 'НПВХ',
}

export function EquipmentSection({
  projectId,
  geologyDataset,
  seismicDataset,
  equipmentDataset,
  nodes,
  pipes,
  lastRun,
  onChanged,
}: {
  projectId: string
  geologyDataset: DatasetRow | undefined
  seismicDataset: DatasetRow | undefined
  equipmentDataset: DatasetRow | undefined
  nodes: NodeRow[]
  pipes: PipeRow[]
  lastRun: SizingResult | null
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'done' | 'error' | 'migrationNeeded' | null>(null)

  const canRun = !!geologyDataset && !!seismicDataset && pipes.length > 0

  const run = async () => {
    if (!canRun || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const geology = geologyDataset?.content as GeologyInput
      const seismicity = seismicDataset?.content as SeismicInput
      const network = networkFromRows(nodes, pipes)

      const elevations = network.nodes.map((n) => n.groundElevation)
      const fallbackPressure =
        45 + (elevations.length > 0 ? Math.max(...elevations) - Math.min(...elevations) : 0)
      const maxPressureM = lastRun
        ? Math.max(...lastRun.nodes.filter((n) => n.kind !== 'source').map((n) => n.pressureM))
        : fallbackPressure

      const material = selectMaterials({ geology, seismicity, maxPressureM })
      const fittings = placeFittings(network)

      await saveDataset(projectId, 'equipment', { material, fittings } as unknown as Record<string, unknown>)

      // Mark fittings and well labels on the nodes for the map and exports.
      const fittingsByEngineId = new Map(fittings.items.map((i) => [i.nodeId, i.types]))
      const wellByEngineId = new Map(fittings.wells.map((w) => [w.nodeId, w.label]))
      const updates = nodes.flatMap((row) => {
        const engineId = row.label ?? row.id
        const types = fittingsByEngineId.get(engineId)
        const well = wellByEngineId.get(engineId)
        if (!types && !well && !row.meta?.fittings) return []
        return [
          {
            id: row.id,
            project_id: projectId,
            kind: row.kind,
            label: row.label,
            x: row.x,
            y: row.y,
            ground_elevation: row.ground_elevation,
            building_id: row.building_id,
            meta: { ...row.meta, fittings: types ?? [], wellLabel: well ?? null },
          },
        ]
      })
      if (updates.length > 0) {
        const upsert = await supabase.from('nodes').upsert(updates)
        if (upsert.error) throw upsert.error
      }

      const materialLabel = `${MATERIAL_LABELS[material.primary]} PN${material.pnBar}`
      const pipesUpdate = await supabase
        .from('pipes')
        .update({ material: materialLabel })
        .eq('project_id', projectId)
      if (pipesUpdate.error) throw pipesUpdate.error

      setNotice('done')
      await onChanged()
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      setNotice(code === '23514' ? 'migrationNeeded' : 'error')
    } finally {
      setBusy(false)
    }
  }

  const content = (equipmentDataset?.content ?? null) as EquipmentContent | null
  const material = content?.material
  const fittings = content?.fittings

  return (
    <Panel title={t('project.equipment.title')} status={content ? 'filled' : 'empty'}>
      <p className="hint">{t('project.equipment.hint')}</p>
      <div className="section-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canRun || busy}
          onClick={() => void run()}
        >
          {t('project.equipment.run')}
        </button>
        {!canRun && (
          <span className="stat-line warn" style={{ marginTop: 0 }}>
            {t('project.equipment.needData')}
          </span>
        )}
        {notice === 'done' && <span className="stat-line ok">{t('project.equipment.done')}</span>}
      </div>
      {notice === 'error' && <p className="notice error">{t('project.equipment.error')}</p>}
      {notice === 'migrationNeeded' && (
        <p className="notice error">{t('project.equipment.migrationNeeded')}</p>
      )}
      {material && fittings && (
        <>
          <div className="kv-list">
            <div className="kv">
              <span className="kv-label">{t('project.equipment.material')}</span>
              <span className="kv-value">
                {MATERIAL_LABELS[material.primary]} PN{material.pnBar},{' '}
                {t(`project.equipment.joints.${material.jointType}`)}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.alternative')}</span>
              <span className="kv-value">{MATERIAL_LABELS[material.alternative]}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.depth')}</span>
              <span className="kv-value">{material.burialDepthM.toFixed(2)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.counts.hydrants')}</span>
              <span className="kv-value">{fittings.counts.hydrants}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.counts.valves')}</span>
              <span className="kv-value">{fittings.counts.valves}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.counts.airValves')}</span>
              <span className="kv-value">{fittings.counts.airValves}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.counts.washouts')}</span>
              <span className="kv-value">{fittings.counts.washouts}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.equipment.counts.wells')}</span>
              <span className="kv-value">{fittings.counts.wells}</span>
            </div>
          </div>
          {material.needsCompensators && (
            <p className="stat-line warn">{t('project.equipment.compensators')}</p>
          )}
          <div style={{ marginTop: 16 }}>
            {material.reasons.map((reason) => (
              <p className="stat-line" key={reason}>
                {t(`project.equipment.reasons.${reason}`)}
              </p>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}
