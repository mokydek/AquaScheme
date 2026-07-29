import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { parseGeoJsonNetwork, summarizeAct } from '@aquascheme/engine'
import type { ExistingMaterial, ImportSegment, PipeDecision, SurveyPoint } from '@aquascheme/engine'
import { supabase } from '../../shared/supabase'
import { useAuth } from '../../shared/auth'
import { replaceExisting, updateExistingPipe } from '../../shared/existing'
import type { ExistingPipeRow } from '../../shared/existing'
import { routeUpload, uploadErrorText } from '../../shared/upload'
import { Panel } from './Panel'

const MATERIALS: ExistingMaterial[] = ['steel', 'cast_iron', 'concrete', 'asbestos', 'pe', 'pvc', 'unknown']
const DECISIONS: PipeDecision[] = ['keep', 'rehabilitate', 'replace']

export function ExistingNetworkSection({
  projectId,
  existing,
  points,
  designedLengthM,
  onChanged,
}: {
  projectId: string
  existing: ExistingPipeRow[]
  points: SurveyPoint[]
  designedLengthM: number
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'imported' | 'invalid' | 'scan' | 'error' | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setNotice(null)
    setUploadMessage(null)
    try {
      const routed = await routeUpload(file, ['dxf', 'geojson'])
      let segments: ImportSegment[]
      if (routed.kind === 'dxf') {
        const { parseDxfNetwork } = await import('@aquascheme/engine/dxfread')
        segments = parseDxfNetwork(routed.text ?? '').segments
      } else {
        segments = parseGeoJsonNetwork(routed.text ?? '').segments
      }
      if (segments.length === 0) {
        setNotice('invalid')
        return
      }
      await replaceExisting(projectId, segments, points)
      setNotice('imported')
      await onChanged()
    } catch (error) {
      const message = uploadErrorText(t, error)
      if (message) setUploadMessage(message)
      else setNotice('error')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const patchPipe = async (row: ExistingPipeRow, patch: Parameters<typeof updateExistingPipe>[1]) => {
    await updateExistingPipe(row, patch)
    await onChanged()
  }

  const uploadScan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !session) return
    setBusy(true)
    setNotice(null)
    setUploadMessage(null)
    try {
      const routed = await routeUpload(file, ['pdf'])
      const path = `${session.user.id}/${projectId}/act_${routed.file.name}`
      const up = await supabase.storage.from('source-files').upload(path, routed.file, { upsert: true, contentType: 'application/pdf' })
      if (up.error) throw up.error
      await supabase.from('survey_acts').insert({ project_id: projectId, scan_path: path })
      setNotice('scan')
    } catch (error) {
      const message = uploadErrorText(t, error)
      if (message) setUploadMessage(message)
      else setNotice('error')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const summary = summarizeAct(
    existing.map((r) => ({ id: r.id, lengthM: r.length_m ?? 0, diameterMm: r.diameter_mm ?? undefined, decision: r.decision })),
  )

  return (
    <Panel title={t('project.existing.title')} status={existing.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.existing.hint')}</p>
      <div className="section-actions">
        <label className="stat-line" htmlFor="existing-network-file" style={{ marginTop: 0 }}>{t('project.existing.importLabel')}</label>
        <input id="existing-network-file" name="existing-network-file" className="file-input" type="file" accept=".dxf,.dwg,.geojson,.json" disabled={busy} onChange={(e) => void importFile(e)} />
      </div>
      <div className="section-actions">
        <label className="stat-line" htmlFor="existing-network-scan" style={{ marginTop: 0 }}>{t('project.existing.scanLabel')}</label>
        <input id="existing-network-scan" name="existing-network-scan" className="file-input" type="file" accept=".pdf" disabled={busy} onChange={(e) => void uploadScan(e)} />
      </div>

      {uploadMessage && <p className="notice error">{uploadMessage}</p>}
      {notice === 'imported' && <span className="stat-line ok">{t('project.existing.imported')}</span>}
      {notice === 'scan' && <span className="stat-line ok">{t('project.existing.scanDone')}</span>}
      {notice === 'invalid' && <p className="notice error">{t('project.existing.invalid')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}

      {existing.length > 0 && (
        <>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th className="num">{t('project.existing.thLength')}</th>
                  <th>{t('project.existing.thMaterial')}</th>
                  <th className="num">{t('project.existing.thYear')}</th>
                  <th className="num">{t('project.existing.thDiameter')}</th>
                  <th className="num">{t('project.existing.thWear')}</th>
                  <th className="num">{t('project.existing.thRoughness')}</th>
                  <th>{t('project.existing.thDecision')}</th>
                </tr>
              </thead>
              <tbody>
                {existing.map((row, i) => (
                  <tr key={row.id}>
                    <td>{i + 1}</td>
                    <td className="num">{(row.length_m ?? 0).toFixed(1)}</td>
                    <td>
                      <select
                        id={`existing-material-${encodeURIComponent(row.id)}`}
                        name={`existing-material-${encodeURIComponent(row.id)}`}
                        aria-label={`${t('project.existing.thMaterial')} ${i + 1}`}
                        className="input input-sm"
                        value={(row.material as ExistingMaterial) ?? 'unknown'}
                        onChange={(e) => void patchPipe(row, { material: e.target.value as ExistingMaterial })}
                      >
                        {MATERIALS.map((m) => (
                          <option key={m} value={m}>{t(`project.existing.material.${m}`)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input
                        id={`existing-year-${encodeURIComponent(row.id)}`}
                        name={`existing-year-${encodeURIComponent(row.id)}`}
                        aria-label={`${t('project.existing.thYear')} ${i + 1}`}
                        className="input input-sm"
                        style={{ width: 70 }}
                        defaultValue={row.laid_year ?? ''}
                        onBlur={(e) => void patchPipe(row, { laid_year: e.target.value ? Number(e.target.value) : null })}
                      />
                    </td>
                    <td className="num">
                      <input
                        id={`existing-diameter-${encodeURIComponent(row.id)}`}
                        name={`existing-diameter-${encodeURIComponent(row.id)}`}
                        aria-label={`${t('project.existing.thDiameter')} ${i + 1}`}
                        className="input input-sm"
                        style={{ width: 70 }}
                        defaultValue={row.diameter_mm ?? ''}
                        onBlur={(e) => void patchPipe(row, { diameter_mm: e.target.value ? Number(e.target.value) : null })}
                      />
                    </td>
                    <td className="num">
                      <input
                        id={`existing-wear-${encodeURIComponent(row.id)}`}
                        name={`existing-wear-${encodeURIComponent(row.id)}`}
                        aria-label={`${t('project.existing.thWear')} ${i + 1}`}
                        className="input input-sm"
                        style={{ width: 60 }}
                        defaultValue={row.wear_percent ?? ''}
                        onBlur={(e) => void patchPipe(row, { wear_percent: e.target.value ? Number(e.target.value) : null })}
                      />
                    </td>
                    <td className="num">{(row.roughness_mm ?? 0).toFixed(2)}</td>
                    <td>
                      <select
                        id={`existing-decision-${encodeURIComponent(row.id)}`}
                        name={`existing-decision-${encodeURIComponent(row.id)}`}
                        aria-label={`${t('project.existing.thDecision')} ${i + 1}`}
                        className="input input-sm"
                        value={row.decision}
                        onChange={(e) => void patchPipe(row, { decision: e.target.value as PipeDecision })}
                      >
                        {DECISIONS.map((d) => (
                          <option key={d} value={d}>{t(`project.existing.decision.${d}`)}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="kv-list">
            <div className="kv">
              <span className="kv-label">{t('project.existing.beforeLength')}</span>
              <span className="kv-value">{summary.totalLengthM.toFixed(0)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.existing.decision.keep')}</span>
              <span className="kv-value">{summary.keepLengthM.toFixed(0)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.existing.decision.rehabilitate')}</span>
              <span className="kv-value">{summary.rehabilitateLengthM.toFixed(0)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.existing.decision.replace')}</span>
              <span className="kv-value">{summary.replaceLengthM.toFixed(0)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.existing.afterLength')}</span>
              <span className="kv-value">{designedLengthM.toFixed(0)}</span>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}
