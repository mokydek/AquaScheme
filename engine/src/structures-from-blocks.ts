import type { DxfBlockEntity } from './dxfread'

/**
 * Сооружения существующих сетей по имени блока чертежа.
 *
 * На реальной топооснове Талдыколя 39 существующих колодцев — `кол.Кан` 24,
 * `кол.Лив` 8, `кол.вод.` 7 — вставлены блоками на слое `0`. Слой этот инженер
 * помечает как не инженерный, и по слою они не опознаются вовсе; ни в
 * пересечения, ни в модель существующих сетей они не попадали, хотя это
 * измеренные положения реальных колодцев.
 *
 * Что здесь измерено, а что выведено, разделено намеренно. Точка вставки —
 * измеренная величина съёмки. Вид сооружения выведен из имени блока: имя
 * задаёт съёмщик, соглашение у каждой организации своё, и поэтому имя
 * возвращается вместе с видом. Нераспознанные имена не отбрасываются и не
 * угадываются — они возвращаются списком, чтобы инженер назначил вид сам, как
 * он это делает для ролей слоёв.
 */

export type StructureKind =
  | 'колодец канализации'
  | 'колодец ливневой канализации'
  | 'колодец водопровода'
  | 'колодец теплосети'
  | 'колодец связи'
  | 'колодец газопровода'
  | 'камера'
  | 'опора'

/**
 * Корни имён блоков. Проверяются по вхождению в нижнем регистре: имена в
 * чертежах пишут и через точку, и слитно, и в разном регистре.
 */
const KIND_ROOTS: Array<{ kind: StructureKind; roots: RegExp }> = [
  { kind: 'колодец ливневой канализации', roots: /кол.*(лив|ливн|дожд)/ },
  { kind: 'колодец канализации', roots: /кол.*(кан|фек|быт)/ },
  { kind: 'колодец водопровода', roots: /кол.*(вод|впр|в1)/ },
  { kind: 'колодец теплосети', roots: /кол.*(тепл|тс)/ },
  { kind: 'колодец связи', roots: /кол.*(связ|тлф|кс)/ },
  { kind: 'колодец газопровода', roots: /кол.*(газ)/ },
  { kind: 'камера', roots: /камер|павильон/ },
  { kind: 'опора', roots: /опор|столб/ },
]

export interface BlockStructure {
  /** Точка вставки блока — измеренное положение. */
  x: number
  y: number
  /** Вид, выведенный из имени блока. */
  kind: StructureKind
  /** Имя блока: соглашение съёмщика, а не норматив. Показывается рядом с видом. */
  blockName: string
  layer?: string
}

export interface BlockStructureResult {
  structures: BlockStructure[]
  /**
   * Имена блоков, вид которых не выведен, с числом вставок. Не отбрасываются:
   * среди них может быть сооружение с местным обозначением, и решение о нём
   * принимает инженер.
   */
  unrecognized: Array<{ blockName: string; count: number; layer?: string }>
  reason: string
}

/** Вид сооружения по имени блока; `null` — соглашение неизвестно. */
export function structureKindForBlockName(
  name: string,
  overrides: Readonly<Record<string, StructureKind>> = {},
): StructureKind | null {
  const trimmed = name.trim()
  if (overrides[trimmed]) return overrides[trimmed]
  const lower = trimmed.toLowerCase()
  for (const entry of KIND_ROOTS) {
    if (entry.roots.test(lower)) return entry.kind
  }
  return null
}

export function structuresFromBlocks(
  blocks: DxfBlockEntity[],
  overrides: Readonly<Record<string, StructureKind>> = {},
): BlockStructureResult {
  const structures: BlockStructure[] = []
  const unknown = new Map<string, { count: number; layer?: string }>()

  for (const block of blocks) {
    if (!Number.isFinite(block.x) || !Number.isFinite(block.y)) continue
    const name = (block.name ?? '').trim()
    if (name === '') continue
    const kind = structureKindForBlockName(name, overrides)
    if (kind === null) {
      const seen = unknown.get(name)
      unknown.set(name, { count: (seen?.count ?? 0) + 1, layer: seen?.layer ?? block.layer })
      continue
    }
    structures.push({ x: block.x, y: block.y, kind, blockName: name, layer: block.layer })
  }

  const unrecognized = [...unknown]
    .map(([blockName, item]) => ({ blockName, count: item.count, ...(item.layer ? { layer: item.layer } : {}) }))
    .sort((left, right) => right.count - left.count || left.blockName.localeCompare(right.blockName))

  const byKind = new Map<StructureKind, number>()
  for (const structure of structures) byKind.set(structure.kind, (byKind.get(structure.kind) ?? 0) + 1)

  return {
    structures,
    unrecognized,
    reason: structures.length === 0
      ? `Сооружений по именам блоков не опознано; нераспознанных имён ${unrecognized.length}.`
      : `Опознано сооружений: ${structures.length} (`
        + `${[...byKind].map(([kind, count]) => `${kind} — ${count}`).join(', ')}). `
        + `Нераспознанных имён блоков: ${unrecognized.length}. `
        + 'Точка вставки измерена съёмкой; вид выведен из имени блока — соглашения съёмщика.',
  }
}
