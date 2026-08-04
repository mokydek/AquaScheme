import { useTranslation } from 'react-i18next'
import { structuresFromBlocks } from '@aquascheme/engine'
import type { DxfBlockEntity } from '@aquascheme/engine/dxfread'

/**
 * Сооружения существующих сетей, опознанные по именам блоков чертежа.
 *
 * На реальной топооснове Талдыколя 39 колодцев — канализации, ливневой и
 * водопровода — вставлены блоками на слое «0». Слой этот инженер помечает как
 * не инженерный, и по слою они не опознавались вовсе: ни в пересечения, ни в
 * модель существующих сетей они не попадали, хотя это измеренные положения.
 *
 * Нераспознанные имена показываются рядом и не отбрасываются: соглашение об
 * именах у каждой организации своё, и среди них может быть сооружение с
 * местным обозначением.
 */
export function BlockStructuresTable({ blocks }: { blocks: DxfBlockEntity[] }) {
  const { t } = useTranslation()
  if (blocks.length === 0) return null
  const result = structuresFromBlocks(blocks)
  const byKind = new Map<string, number>()
  for (const structure of result.structures) {
    byKind.set(structure.kind, (byKind.get(structure.kind) ?? 0) + 1)
  }

  return (
    <div style={{ marginTop: 12 }}>
      <h5>{t('project.blockStructures.title')}</h5>
      <p className={result.structures.length > 0 ? 'stat-line' : 'hint'}>{result.reason}</p>

      {byKind.size > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>{t('project.blockStructures.thKind')}</th>
              <th className="num">{t('project.blockStructures.thCount')}</th>
              <th>{t('project.blockStructures.thNames')}</th>
            </tr></thead>
            <tbody>{[...byKind].map(([kind, count]) => (
              <tr key={kind}>
                <td>{kind}</td>
                <td className="num">{count}</td>
                <td className="mono">
                  {[...new Set(result.structures.filter((s) => s.kind === kind).map((s) => s.blockName))].join(', ')}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {result.unrecognized.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="field-label">
            {t('project.blockStructures.unknownSummary', { count: result.unrecognized.length })}
          </summary>
          <p className="hint">{t('project.blockStructures.unknownHint')}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>
                <th>{t('project.blockStructures.thBlockName')}</th>
                <th className="num">{t('project.blockStructures.thCount')}</th>
                <th>{t('project.blockStructures.thLayer')}</th>
              </tr></thead>
              <tbody>{result.unrecognized.slice(0, 40).map((item) => (
                <tr key={item.blockName}>
                  <td className="mono">{item.blockName}</td>
                  <td className="num">{item.count}</td>
                  <td>{item.layer ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
