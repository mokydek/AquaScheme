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
  if (blocks.length === 0) return null
  const result = structuresFromBlocks(blocks)
  const byKind = new Map<string, number>()
  for (const structure of result.structures) {
    byKind.set(structure.kind, (byKind.get(structure.kind) ?? 0) + 1)
  }

  return (
    <div style={{ marginTop: 12 }}>
      <h5>Сооружения по именам блоков</h5>
      <p className={result.structures.length > 0 ? 'stat-line' : 'hint'}>{result.reason}</p>

      {byKind.size > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Вид сооружения</th><th className="num">Вставок</th><th>Имена блоков</th></tr></thead>
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
            Имена блоков без вида: {result.unrecognized.length}
          </summary>
          <p className="hint">
            Соглашение об именах у каждой организации своё. Эти вставки не отброшены и не угаданы — среди них
            может быть сооружение с местным обозначением.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Имя блока</th><th className="num">Вставок</th><th>Слой</th></tr></thead>
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
