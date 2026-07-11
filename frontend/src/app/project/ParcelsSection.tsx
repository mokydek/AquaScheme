import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParcelKind, Vec2 } from '@aquascheme/engine'
import type { BuildingRow } from '../../shared/datasets'
import { deleteParcel, insertParcel } from '../../shared/parcels'
import type { ParcelRow } from '../../shared/parcels'
import { Panel } from './Panel'

interface DraftState {
  kind: ParcelKind
  vertices: Vec2[]
}

export function ParcelsSection({
  projectId,
  parcels,
  buildings,
  draft,
  violationCount,
  onStartDraw,
  onCancelDraw,
  onFinishDraw,
  onChanged,
  onCheck,
}: {
  projectId: string
  parcels: ParcelRow[]
  buildings: BuildingRow[]
  draft: DraftState | null
  violationCount: number | null
  onStartDraw: (kind: ParcelKind) => void
  onCancelDraw: () => void
  onFinishDraw: () => Promise<void>
  onChanged: () => Promise<void>
  onCheck: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'imported' | 'invalid' | 'error' | null>(null)

  const labelOfBuilding = (id: string | null) =>
    id ? (buildings.find((b) => b.id === id)?.label ?? '—') : '—'

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    try {
      const text = await file.text()
      let rings: Vec2[][] = []
      if (/\.dxf$/i.test(file.name)) {
        const { parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
        const data = parseDxfNetwork(text)
        rings = data.segments
          .filter((s) => (s.layer ?? '').toUpperCase() === 'PARCELS')
          .map((s) => s.points)
          .filter((pts) => pts.length >= 4)
      } else {
        const parsed = JSON.parse(text) as { features?: Array<{ geometry?: { type?: string; coordinates?: number[][][] } }> }
        for (const feature of parsed.features ?? []) {
          const g = feature.geometry
          if (g?.type === 'Polygon' && Array.isArray(g.coordinates?.[0])) {
            rings.push(g.coordinates[0].map((c) => ({ x: c[0], y: c[1] })))
          }
        }
      }
      if (rings.length === 0) {
        setNotice('invalid')
        return
      }
      for (const ring of rings) await insertParcel(projectId, 'parcel', ring, null)
      setNotice('imported')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const remove = async (parcelId: string) => {
    await deleteParcel(parcelId)
    await onChanged()
  }

  return (
    <Panel title={t('project.parcels.title')} status={parcels.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.parcels.hint')}</p>

      <div className="section-actions">
        <input className="file-input" type="file" accept=".geojson,.json,.dxf" disabled={busy || draft !== null} onChange={(e) => void onFile(e)} />
      </div>

      {draft ? (
        <div className="section-actions">
          <span className="stat-line" style={{ marginTop: 0 }}>
            {t('project.parcels.drawing', {
              kind: t(`project.parcels.kind.${draft.kind}`),
              count: draft.vertices.length,
            })}
          </span>
          <button type="button" className="btn btn-sm" disabled={draft.vertices.length < 3} onClick={() => void onFinishDraw()}>
            {t('project.parcels.finish')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelDraw}>
            {t('project.parcels.cancel')}
          </button>
        </div>
      ) : (
        <div className="section-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStartDraw('parcel')}>
            {t('project.parcels.drawParcel')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStartDraw('right_of_way')}>
            {t('project.parcels.drawRow')}
          </button>
        </div>
      )}

      {notice === 'imported' && <span className="stat-line ok">{t('project.parcels.imported')}</span>}
      {notice === 'invalid' && <p className="notice error">{t('project.parcels.invalid')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}

      {parcels.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('project.parcels.thKind')}</th>
                <th>{t('project.parcels.thBuilding')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p.id}>
                  <td>{t(`project.parcels.kind.${p.kind}`)}</td>
                  <td>{p.kind === 'parcel' ? labelOfBuilding(p.building_id) : '—'}</td>
                  <td>
                    <button type="button" className="link-btn" onClick={() => void remove(p.id)}>
                      {t('project.parcels.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={parcels.length === 0} onClick={onCheck}>
          {t('project.parcels.check')}
        </button>
        {violationCount !== null && (
          <span className={`stat-line${violationCount === 0 ? ' ok' : ' warn'}`} style={{ marginTop: 0 }}>
            {violationCount === 0
              ? t('project.parcels.noViolations')
              : t('project.parcels.violations', { count: violationCount })}
          </span>
        )}
      </div>
    </Panel>
  )
}
