import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../shared/supabase'
import { useAuth } from '../../shared/auth'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { Panel } from './Panel'

/**
 * Initial permitting documents (исходно-разрешительная документация). The
 * checklist mirrors the input set of the reference водосбросной коллектор
 * project: задание на проектирование, АПЗ, ПДП, акт выбора трассы, схема
 * сетей от генплана, топосъёмка, отчёт ИГИ, вертикальная планировка, ТУ.
 * Files are stored in the source-files bucket; the checklist is a dataset.
 */

export const BASIS_ITEMS = [
  { id: 'assignment', label: 'Задание на проектирование (ТЗ)' },
  { id: 'apz', label: 'Архитектурно-планировочное задание (АПЗ)' },
  { id: 'pdp', label: 'Проект детальной планировки (ПДП) района' },
  { id: 'route_act', label: 'Акт выбора трассы' },
  { id: 'genplan_scheme', label: 'Схема сетей от генплана (с диаметрами)' },
  { id: 'topo', label: 'Топографическая съёмка М1:500' },
  { id: 'geology', label: 'Отчёт об инженерно-геологических изысканиях' },
  { id: 'vertical', label: 'Схема вертикальной планировки' },
  { id: 'tu', label: 'Технические условия (ТУ)' },
] as const

type BasisContent = { files: Record<string, string> }

export function BasisSection({
  projectId,
  dataset,
  onSaved,
}: {
  projectId: string
  dataset?: DatasetRow
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<'saved' | 'error' | 'migrationNeeded' | null>(null)

  const files = ((dataset?.content ?? { files: {} }) as BasisContent).files ?? {}
  const uploadedCount = BASIS_ITEMS.filter((i) => files[i.id]).length

  const onFile = async (itemId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !session) return
    setBusyId(itemId)
    setNotice(null)
    try {
      const path = `${session.user.id}/${projectId}/basis_${itemId}_${file.name}`
      const upload = await supabase.storage
        .from('source-files')
        .upload(path, file, { upsert: true })
      if (upload.error) throw upload.error
      await saveDataset(projectId, 'basis', { files: { ...files, [itemId]: file.name } })
      setNotice('saved')
      await onSaved()
    } catch (error) {
      const code = (error as { code?: string })?.code
      setNotice(code === '23514' ? 'migrationNeeded' : 'error')
    } finally {
      setBusyId(null)
      event.target.value = ''
    }
  }

  return (
    <Panel title={t('project.basis.title')} status={uploadedCount === BASIS_ITEMS.length ? 'filled' : uploadedCount > 0 ? 'default' : 'empty'}>
      <p className="hint">{t('project.basis.hint')}</p>
      <p className="stat-line">{t('project.basis.progress', { count: uploadedCount, total: BASIS_ITEMS.length })}</p>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('project.basis.thDoc')}</th>
              <th>{t('project.basis.thFile')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {BASIS_ITEMS.map((item) => (
              <tr key={item.id} className={files[item.id] ? undefined : 'row-warn'}>
                <td>{item.label}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {files[item.id] ?? t('project.basis.missing')}
                </td>
                <td>
                  <input
                    className="file-input"
                    type="file"
                    disabled={busyId !== null}
                    onChange={(e) => void onFile(item.id, e)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notice === 'saved' && <p className="stat-line ok">{t('project.basis.saved')}</p>}
      {notice === 'migrationNeeded' && <p className="notice error">{t('project.basis.migrationNeeded')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.saveError')}</p>}
      <p className="hint" style={{ marginTop: 8 }}>{t('project.basis.dwgNote')}</p>
    </Panel>
  )
}
