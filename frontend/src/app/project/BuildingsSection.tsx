import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { parseBuildingsCsv } from '@aquascheme/engine'
import { supabase } from '../../shared/supabase'
import type { BuildingRow } from '../../shared/datasets'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { Panel } from './Panel'

interface DraftBuilding {
  label: string
  x: string
  y: string
  floors: string
  residents: string
}

const EMPTY_DRAFT: DraftBuilding = { label: '', x: '', y: '', floors: '', residents: '' }

export function BuildingsSection({
  projectId,
  buildings,
  onChanged,
  mode = 'buildings',
}: {
  projectId: string
  buildings: BuildingRow[]
  onChanged: () => Promise<void>
  /**
   * 'buildings' — dwellings with residents (water supply). 'inflows' — storm
   * inflow points (treatment plants ОС) whose flow is entered directly in
   * L/s: a rain collector is fed by catchment discharge, NOT by residents, so
   * the storeys field is hidden and the residents column becomes «Расход, л/с».
   */
  mode?: 'buildings' | 'inflows'
}) {
  const { t } = useTranslation()
  const inflow = mode === 'inflows'
  const tr = (key: string, opts?: Record<string, unknown>) =>
    inflow ? t(`project.inflows.${key}`, opts) : t(`project.buildings.${key}`, opts)
  const [draft, setDraft] = useState<DraftBuilding>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const invalidateRoute = async () => {
    if (inflow) await supabase.from('projects').update({ route_status: 'stale' }).eq('id', projectId)
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice(null)
    setBusy(true)
    try {
      const routed = await routeUpload(file, ['csv'])
      const parsed = parseBuildingsCsv(routed.text ?? '')
      if (parsed.buildings.length === 0) {
        setNotice({ kind: 'error', text: tr('issues', { count: parsed.issues.length }) })
        return
      }
      await supabase.from('buildings').delete().eq('project_id', projectId)
      const { error } = await supabase.from('buildings').insert(
        parsed.buildings.map((b) => ({
          project_id: projectId,
          label: b.label ?? null,
          x: b.x,
          y: b.y,
          floors: b.floors,
          residents: b.residents,
          design_flow_lps: inflow ? b.residents : null,
        })),
      )
      if (error) throw error
      await invalidateRoute()
      const parts = [tr('replaced', { count: parsed.buildings.length })]
      if (parsed.issues.length > 0) {
        parts.push(tr('issues', { count: parsed.issues.length }))
      }
      setNotice({ kind: 'info', text: parts.join('. ') })
      await onChanged()
    } catch (error) {
      const message = uploadErrorText(t, error)
      setNotice({ kind: 'error', text: message ?? t('project.saveError') })
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const addBuilding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice(null)
    const x = Number(draft.x.replace(',', '.'))
    const y = Number(draft.y.replace(',', '.'))
    // Inflow points have no storeys; L/s is persisted in its own unit-safe field.
    const floors = inflow ? 1 : Number(draft.floors)
    const residents = Number(draft.residents.replace(',', '.'))
    const valid =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isInteger(floors) &&
      floors >= 1 &&
      Number.isFinite(residents) &&
      residents >= 0
    if (!valid) {
      setNotice({ kind: 'error', text: tr('invalidRow') })
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('buildings').insert({
        project_id: projectId,
        label: draft.label.trim() || null,
        x,
        y,
        floors,
        residents: Math.round(residents),
        specific_demand_lpd: null,
        design_flow_lps: inflow ? residents : null,
      })
      if (error) throw error
      await invalidateRoute()
      setDraft(EMPTY_DRAFT)
      await onChanged()
    } catch {
      setNotice({ kind: 'error', text: t('project.saveError') })
    } finally {
      setBusy(false)
    }
  }

  const removeBuilding = async (id: string) => {
    await supabase.from('buildings').delete().eq('id', id)
    await invalidateRoute()
    await onChanged()
  }

  const setField = (field: keyof DraftBuilding) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }))

  return (
    <Panel title={tr('title')} status={buildings.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{tr('hint')}</p>
      <div className="section-actions">
        <input
          className="file-input"
          type="file"
          accept=".csv,.txt"
          onChange={(e) => void onFile(e)}
        />
      </div>
      {buildings.length === 0 ? (
        <p className="stat-line">{tr('emptyList')}</p>
      ) : (
        <>
          <p className="stat-line">{tr('count', { count: buildings.length })}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{tr('thLabel')}</th>
                  <th className="num">{tr('thX')}</th>
                  <th className="num">{tr('thY')}</th>
                  {!inflow && <th className="num">{tr('thFloors')}</th>}
                  <th className="num">{tr('thResidents')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {buildings.map((b) => (
                  <tr key={b.id}>
                    <td>{b.label ?? ''}</td>
                    <td className="num">{b.x}</td>
                    <td className="num">{b.y}</td>
                    {!inflow && <td className="num">{b.floors}</td>}
                    <td className="num">{inflow ? (b.design_flow_lps ?? b.specific_demand_lpd ?? b.residents ?? '') : (b.residents ?? '')}</td>
                    <td>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void removeBuilding(b.id)}
                      >
                        {tr('delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <form className="add-row" onSubmit={(e) => void addBuilding(e)}>
        <input
          className="input input-sm"
          placeholder={tr('thLabel')}
          value={draft.label}
          onChange={setField('label')}
        />
        <input
          className="input input-sm"
          placeholder={tr('thX')}
          value={draft.x}
          onChange={setField('x')}
          required
        />
        <input
          className="input input-sm"
          placeholder={tr('thY')}
          value={draft.y}
          onChange={setField('y')}
          required
        />
        {!inflow && (
          <input
            className="input input-sm"
            placeholder={tr('thFloors')}
            value={draft.floors}
            onChange={setField('floors')}
            required
          />
        )}
        <input
          className="input input-sm"
          placeholder={tr('thResidents')}
          value={draft.residents}
          onChange={setField('residents')}
          required
        />
        <button className="btn btn-sm" type="submit" disabled={busy}>
          {tr('add')}
        </button>
      </form>
      {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
    </Panel>
  )
}
