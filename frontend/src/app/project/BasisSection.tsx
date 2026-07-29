import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../shared/supabase'
import { useAuth } from '../../shared/auth'
import type { DatasetRow } from '../../shared/datasets'
import { saveBasisFile } from '../../shared/basisFiles'
import { formatAppError } from '../../shared/errorFormatting'
import { Panel } from './Panel'

/** Initial permitting documents. Files are private project inputs in Storage. */

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

type BasisContent = {
  files: Record<string, string>
  referenceFiles?: string[]
  mode?: 'synthetic'
  note?: string
  project?: { name: string; code: string; stage: string; customer: string; customerBin: string; apzNumber: string; apzDate: string; address: string }
}

type BasisRowState = {
  status: 'saving' | 'saved' | 'error' | 'refreshError'
  fileName: string
  detail?: string
}

function failureDetail(t: ReturnType<typeof useTranslation>['t'], error: unknown): string {
  const formatted = formatAppError(error)
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate?.code === 'string' ? candidate.code : ''
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''
  if (code === '23514') return `${t('project.basis.migrationNeeded')} ${formatted}`
  if (message.includes('bucket')) return `${t('project.basis.bucketMissing')} ${formatted}`
  return `${t('project.saveError')}: ${formatted}`
}

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
  const [rowStates, setRowStates] = useState<Record<string, BasisRowState>>({})

  useEffect(() => {
    setBusyId(null)
    setRowStates({})
  }, [projectId])

  const content = (dataset?.content ?? { files: {} }) as BasisContent
  const files = content.files ?? {}
  const displayedFiles = { ...files }
  for (const [itemId, state] of Object.entries(rowStates)) {
    if (state.status === 'saved' || state.status === 'refreshError') displayedFiles[itemId] = state.fileName
  }
  const referenceFiles = content.referenceFiles ?? []
  const uploadedCount = BASIS_ITEMS.filter((i) => displayedFiles[i.id]).length

  const onFile = async (itemId: string, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!session) {
      setRowStates((current) => ({
        ...current,
        [itemId]: {
          status: 'error',
          fileName: file.name,
          detail: 'Сессия пользователя недоступна. Войдите снова и повторите выбор файла.',
        },
      }))
      input.value = ''
      return
    }
    setBusyId(itemId)
    setRowStates((current) => ({
      ...current,
      [itemId]: { status: 'saving', fileName: file.name },
    }))
    try {
      // Supabase Storage keys allow only a safe ASCII subset, so a Cyrillic /
      // spaced / comma filename (e.g. «...ОС 3-4, 3-3, 3-8 (1).pdf») is rejected
      // with 400. Use a deterministic ASCII key and keep the original name only
      // for display in the dataset.
      const ext = (file.name.includes('.') ? file.name.split('.').pop() ?? '' : '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 8)
        .toLowerCase()
      const path = `${session.user.id}/${projectId}/basis_${itemId}${ext ? `.${ext}` : ''}`
      const upload = await supabase.storage
        .from('source-files')
        .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' })
      if (upload.error) throw upload.error
      await saveBasisFile(projectId, itemId, file.name, {
        ...content,
        files: displayedFiles,
      })
      setRowStates((current) => ({
        ...current,
        [itemId]: { status: 'saved', fileName: file.name },
      }))
      try {
        await onSaved()
      } catch (error) {
        setRowStates((current) => ({
          ...current,
          [itemId]: {
            status: 'refreshError',
            fileName: file.name,
            detail: formatAppError(error),
          },
        }))
      }
    } catch (error) {
      setRowStates((current) => ({
        ...current,
        [itemId]: {
          status: 'error',
          fileName: file.name,
          detail: failureDetail(t, error),
        },
      }))
    } finally {
      setBusyId(null)
      // A native file input represents only the current local selection, not
      // persisted Storage state. Clear it so the same file can be selected
      // again; the durable file name and outcome remain visible in this row.
      input.value = ''
    }
  }

  return (
    <Panel title={t('project.basis.title')} status={uploadedCount === BASIS_ITEMS.length ? 'filled' : uploadedCount > 0 ? 'default' : 'empty'}>
      <p className="hint">{t('project.basis.hint')}</p>
      <p className="stat-line">{t('project.basis.progress', { count: uploadedCount, total: BASIS_ITEMS.length })}</p>
      {content.mode === 'synthetic' && (
        <p className="notice">{content.note ?? 'Синтетическое демо не содержит исходных документов и не разрешает инженерный выпуск.'}</p>
      )}
      {content.project && (
        <div className="kv-list" style={{ marginTop: 12 }}>
          <div className="kv"><span className="kv-label">Объект</span><span className="kv-value">{content.project.name}</span></div>
          <div className="kv"><span className="kv-label">Шифр / стадия</span><span className="kv-value">{content.project.code} · {content.project.stage}</span></div>
          <div className="kv"><span className="kv-label">Заказчик</span><span className="kv-value">{content.project.customer} · БИН {content.project.customerBin}</span></div>
          <div className="kv"><span className="kv-label">АПЗ</span><span className="kv-value">№{content.project.apzNumber} от {content.project.apzDate}</span></div>
          <div className="kv"><span className="kv-label">Адрес</span><span className="kv-value">{content.project.address}</span></div>
        </div>
      )}
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
            {BASIS_ITEMS.map((item) => {
              const state = rowStates[item.id]
              const storedFileName = displayedFiles[item.id]
              return (
                <tr key={item.id} className={storedFileName ? undefined : 'row-warn'}>
                  <td>{item.label}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    <div>{storedFileName ?? t('project.basis.missing')}</div>
                    {state?.status === 'saving' && (
                      <div className="stat-line" role="status" aria-live="polite" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="button-spinner" aria-hidden="true" />
                        Сохраняется «{state.fileName}»… Не закрывайте страницу.
                      </div>
                    )}
                    {state?.status === 'saved' && (
                      <div className="stat-line ok" role="status" aria-live="polite" style={{ marginTop: 4 }}>
                        {t('project.basis.saved')}: {state.fileName}. Нативное поле выбора очищено автоматически — это не ошибка, файл остаётся сохранённым в проекте.
                      </div>
                    )}
                    {state?.status === 'refreshError' && (
                      <div className="notice" role="status" aria-live="polite" style={{ marginTop: 4 }}>
                        Файл «{state.fileName}» сохранён, но экран не удалось обновить: {state.detail}. Обновите страницу; сброс нативного поля выбора не означает потерю файла.
                      </div>
                    )}
                    {state?.status === 'error' && (
                      <div className="notice error" role="alert" style={{ marginTop: 4 }}>
                        Не удалось сохранить «{state.fileName}». {state.detail} Нативное поле выбора сброшено; после устранения ошибки выберите файл повторно.
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      id={`basis-${projectId}-${item.id}`}
                      name={`basis-${projectId}-${item.id}`}
                      className="file-input"
                      type="file"
                      aria-label={`${item.label}: выбрать файл`}
                      disabled={busyId !== null}
                      onChange={(e) => void onFile(item.id, e)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {referenceFiles.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>{t('project.basis.references', { count: referenceFiles.length })}</summary>
          <ul className="mono" style={{ fontSize: 11, lineHeight: 1.6 }}>
            {referenceFiles.map((name) => <li key={name}>{name}</li>)}
          </ul>
          <p className="hint">{t('project.basis.referencesHint')}</p>
        </details>
      )}
      <p className="hint" style={{ marginTop: 8 }}>{t('project.basis.dwgNote')}</p>
    </Panel>
  )
}
