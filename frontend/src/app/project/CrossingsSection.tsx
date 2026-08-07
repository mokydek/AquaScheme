import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { crossingClearance } from '@aquascheme/engine'
import type { CrossingRecord } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetRow } from '../../shared/datasets'
import { Panel } from './Panel'

/**
 * Карточки фактических пересечений.
 *
 * Съёмка даёт пикет, вид сети, отметку — если её кто-то снял — и проектный
 * лоток. Владельца сети, способ производства работ и согласование съёмка не
 * содержит: они приходят из технических условий и переписки с владельцем, и
 * заявляет их инженер. До появления этой секции заполнить их было негде, и
 * стоп-фактор CROSSING_CARD_INCOMPLETE был недостижим.
 *
 * Отдельная роль у отметки существующей сети: отбор на вскрытие называет
 * пересечения, где исход зависит от факта, — сюда и вносятся результаты
 * контрольного вскрытия, когда оно выполнено.
 *
 * Просвет не вводится, а считается: это разность отметок, и отдельное поле для
 * него позволило бы записать в проект величину, противоречащую собственным
 * отметкам карточки.
 */

type Notice = 'saved' | 'saveError' | null

const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

const show = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '' : String(value)

/**
 * Просвет от проектной трубы до пересекаемой сети.
 *
 * Формула одна на весь проект — `crossingClearance` в движке: до этого она жила
 * в трёх копиях, и разбор съёмки считал по лотку вместо верха трубы.
 */
function clearanceOf(row: CrossingRecord, designDiameterMm: number | undefined): number | undefined {
  return crossingClearance({
    existingElevationM: row.existingElevationM,
    designInvertElevationM: row.designInvertElevationM,
    designDiameterMm,
  })?.clearanceM
}

export function CrossingsSection({
  projectId,
  constraintsDataset,
  designDiameterMm,
  onSaved,
}: {
  projectId: string
  constraintsDataset: DatasetRow | undefined
  /** Проектный диаметр: верх трубы считается от лотка. */
  designDiameterMm?: number
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const stored = useMemo(
    () => ((constraintsDataset?.content ?? {}) as { crossings?: CrossingRecord[] }).crossings ?? [],
    [constraintsDataset],
  )

  const [rows, setRows] = useState<CrossingRecord[]>(stored)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [bulkKind, setBulkKind] = useState('')
  const [bulkOwner, setBulkOwner] = useState('')
  const [bulkMethod, setBulkMethod] = useState('')
  const [bulkClearance, setBulkClearance] = useState('')

  useEffect(() => {
    setRows(stored)
    setNotice(null)
  }, [stored])

  const kinds = useMemo(() => [...new Set(rows.map((row) => row.kind))].sort(), [rows])

  const update = (id: string, patch: Partial<CrossingRecord>) => {
    setNotice(null)
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  /**
   * Владелец, способ и требуемый просвет у сетей одного вида совпадают: они из
   * одних технических условий. На 36 карточках построчный ввод этих трёх полей
   * — работа впустую.
   */
  const applyToKind = () => {
    setNotice(null)
    const clearance = numberOrUndefined(bulkClearance)
    setRows((previous) => previous.map((row) => (
      bulkKind !== '' && row.kind !== bulkKind ? row : {
        ...row,
        ...(bulkOwner.trim() !== '' ? { owner: bulkOwner.trim() } : {}),
        ...(bulkMethod.trim() !== '' ? { method: bulkMethod.trim() } : {}),
        ...(clearance !== undefined ? { requiredClearanceM: clearance } : {}),
      }
    )))
  }

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const existing = (constraintsDataset?.content ?? {}) as Record<string, unknown>
      await saveDataset(
        projectId,
        'route_constraints',
        {
          ...existing,
          // Просвет пересчитывается при записи, чтобы в проекте не осталось
          // величины, расходящейся с отметками карточки.
          crossings: rows.map((row) => {
            const clearanceM = clearanceOf(row, designDiameterMm)
            return clearanceM === undefined ? row : { ...row, clearanceM }
          }),
        },
        constraintsDataset?.meta ?? null,
        constraintsDataset?.file_name ?? null,
      )
      setNotice('saved')
      await onSaved()
    } catch {
      setNotice('saveError')
    } finally {
      setBusy(false)
    }
  }

  const incomplete = rows.filter((row) => !row.owner || !row.size || !row.source
    || !Number.isFinite(row.existingElevationM) || !Number.isFinite(row.requiredClearanceM)
    || !row.method || row.approved !== true).length

  if (rows.length === 0) {
    return (
      <Panel title={t('project.crossings.title')} status="empty">
        <p className="hint">{t('project.crossings.empty')}</p>
      </Panel>
    )
  }

  return (
    <Panel title={t('project.crossings.title')} status={incomplete === 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.crossings.hint')}</p>
      <p className="stat-line">
        {t('project.crossings.count', { total: rows.length, incomplete })}
      </p>
      {!(Number.isFinite(designDiameterMm) && (designDiameterMm as number) > 0) && (
        <p className="notice warn">{t('project.crossings.noDiameter')}</p>
      )}

      <details style={{ marginTop: 12 }}>
        <summary className="field-label">{t('project.crossings.bulk')}</summary>
        <p className="hint">{t('project.crossings.bulkHint')}</p>
        <div className="form-grid">
          <label className="field" htmlFor="crossings-bulk-kind">
            <span className="field-label">{t('project.crossings.kind')}</span>
            <select
              id="crossings-bulk-kind"
              name="crossings-bulk-kind"
              className="input"
              value={bulkKind}
              onChange={(event) => setBulkKind(event.target.value)}
            >
              <option value="">{t('project.crossings.allKinds')}</option>
              {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="crossings-bulk-owner">
            <span className="field-label">{t('project.crossings.owner')}</span>
            <input
              id="crossings-bulk-owner" name="crossings-bulk-owner" className="input" type="text"
              value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)}
            />
          </label>
          <label className="field" htmlFor="crossings-bulk-method">
            <span className="field-label">{t('project.crossings.method')}</span>
            <input
              id="crossings-bulk-method" name="crossings-bulk-method" className="input" type="text"
              value={bulkMethod} onChange={(event) => setBulkMethod(event.target.value)}
            />
          </label>
          <label className="field" htmlFor="crossings-bulk-clearance">
            <span className="field-label">{t('project.crossings.requiredClearance')}</span>
            <input
              id="crossings-bulk-clearance" name="crossings-bulk-clearance" className="input"
              type="number" step="0.05" min="0" inputMode="decimal"
              value={bulkClearance} onChange={(event) => setBulkClearance(event.target.value)}
            />
          </label>
        </div>
        <div className="section-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={applyToKind}>
            {t('project.crossings.apply')}
          </button>
        </div>
      </details>

      <div className="table-wrap" style={{ maxHeight: 460, marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('project.crossings.id')}</th>
              <th scope="col">{t('project.crossings.kind')}</th>
              <th scope="col" className="num">{t('project.crossings.station')}</th>
              <th scope="col">{t('project.crossings.owner')}</th>
              <th scope="col">{t('project.crossings.size')}</th>
              <th scope="col">{t('project.crossings.source')}</th>
              <th scope="col" className="num">{t('project.crossings.existing')}</th>
              <th scope="col" className="num">{t('project.crossings.invert')}</th>
              <th scope="col" className="num">{t('project.crossings.clearance')}</th>
              <th scope="col" className="num">{t('project.crossings.requiredClearance')}</th>
              <th scope="col">{t('project.crossings.method')}</th>
              <th scope="col">{t('project.crossings.approved')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clearance = clearanceOf(row, designDiameterMm)
              const short = (key: string) => `crossing-${encodeURIComponent(row.id)}-${key}`
              return (
                <tr key={row.id}>
                  <td className="mono">{row.id}</td>
                  <td>{row.kind}</td>
                  <td className="num">{row.stationM.toFixed(2)}</td>
                  <td>
                    <input
                      id={short('owner')} name={short('owner')} className="input input-sm" type="text"
                      aria-label={`${t('project.crossings.owner')}: ${row.id}`}
                      value={row.owner ?? ''}
                      onChange={(event) => update(row.id, { owner: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      id={short('size')} name={short('size')} className="input input-sm" type="text"
                      aria-label={`${t('project.crossings.size')}: ${row.id}`}
                      value={row.size ?? ''}
                      onChange={(event) => update(row.id, { size: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      id={short('source')} name={short('source')} className="input input-sm" type="text"
                      aria-label={`${t('project.crossings.source')}: ${row.id}`}
                      value={row.source ?? ''}
                      onChange={(event) => update(row.id, { source: event.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      id={short('existing')} name={short('existing')} className="input input-sm"
                      type="number" step="0.01" inputMode="decimal"
                      aria-label={`${t('project.crossings.existing')}: ${row.id}`}
                      value={show(row.existingElevationM)}
                      onChange={(event) => update(row.id, {
                        existingElevationM: numberOrUndefined(event.target.value),
                      })}
                    />
                  </td>
                  <td className="num">{show(row.designInvertElevationM)}</td>
                  <td className="num">{clearance === undefined ? '—' : clearance.toFixed(2)}</td>
                  <td className="num">
                    <input
                      id={short('required')} name={short('required')} className="input input-sm"
                      type="number" step="0.05" min="0" inputMode="decimal"
                      aria-label={`${t('project.crossings.requiredClearance')}: ${row.id}`}
                      value={show(row.requiredClearanceM)}
                      onChange={(event) => update(row.id, {
                        requiredClearanceM: numberOrUndefined(event.target.value),
                      })}
                    />
                  </td>
                  <td>
                    <input
                      id={short('method')} name={short('method')} className="input input-sm" type="text"
                      aria-label={`${t('project.crossings.method')}: ${row.id}`}
                      value={row.method ?? ''}
                      onChange={(event) => update(row.id, { method: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      id={short('approved')} name={short('approved')} type="checkbox"
                      aria-label={`${t('project.crossings.approved')}: ${row.id}`}
                      checked={row.approved === true}
                      onChange={(event) => update(row.id, { approved: event.target.checked })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>
          {t('project.save')}
        </button>
      </div>
      {notice && (
        <p className={`notice ${notice === 'saved' ? 'info' : 'error'}`}>{t(`project.${notice}`)}</p>
      )}
    </Panel>
  )
}
