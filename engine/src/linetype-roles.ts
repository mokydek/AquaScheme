import type { DxfLayerRole } from './dxfread'

/**
 * Роль по типу линии чертежа.
 *
 * Роль сейчас выводится только из имени слоя, а на реальной топооснове это
 * теряет данные. У Талдыколя слой `0` — 4217 сегментов, роль `unknown`, инженер
 * помечает его как не инженерный, — а типы линий внутри него говорят прямо:
 * `KANALIZ_NAP` (напорная канализация), `ZABOR_MET` (забор металлический),
 * `VOD_LINE` (водопровод). Настоящая сеть выбрасывалась вместе со слоем.
 *
 * Цвет для этого не годится, и это проверено, а не предположено. У Станкевича
 * цвет 12 несут разом канализация, связь, теплотрасса и ограждения, а цвет 162
 * — газопровод, ЛЭП и здания. Классификация по цвету назначила бы забору роль
 * канализации; такой признак хуже отсутствующего.
 *
 * Тип линии отличается тем, что он именованный: имя задаёт съёмщик и оно
 * осмысленно. Поэтому здесь то же правило, что и для блоков — распознанное
 * возвращается вместе с именем типа, нераспознанное перечисляется и решается
 * инженером, а не угадывается.
 */

/**
 * Корни имён типов линий. Проверяются по вхождению в нижнем регистре: имена
 * пишут и латиницей, и с подчёркиваниями, и в разном регистре.
 */
const ROLE_ROOTS: Array<{ role: DxfLayerRole; roots: RegExp }> = [
  { role: 'utility', roots: /kanaliz|kan_|fekal|sewer/ },
  { role: 'utility', roots: /vod_|vodopr|water|vodo/ },
  { role: 'utility', roots: /teplo|heat|ts_/ },
  { role: 'utility', roots: /gaz|gas_/ },
  // «lap» и «tel» — короткие корни, поэтому привязаны к началу имени или к
  // разделителю: иначе они совпали бы внутри произвольного слова.
  { role: 'utility', roots: /kabel|kab_|svyaz|elektr|cable|^lep|_lep|^lap|_lap|telefon|^tel_/ },
  { role: 'utility', roots: /liv_|livn|storm/ },
  { role: 'utility', roots: /trub|pipe/ },
  { role: 'road', roots: /doroga|road|proezd|asfalt/ },
  { role: 'hydrography', roots: /gidro|reka|ozero|water_?body/ },
  { role: 'building', roots: /zdanie|building|stroen/ },
  { role: 'redLine', roots: /krasn|red_?line/ },
  { role: 'terrain', roots: /otkos|gorizont|relief|slope/ },
]

/**
 * Типы линий, которые прямо говорят «это не инженерная сеть». Они называются
 * отдельно от нераспознанных: забор — не пробел в данных, а известный ответ.
 */
const NON_ENGINEERING = /zabor|ograzhd|fence|kustarnik|rastit|derev|trava/

export interface LinetypeRoleResult {
  role: DxfLayerRole | null
  /** Тип линии распознан как заведомо не инженерный. */
  nonEngineering: boolean
  /**
   * Стандартный тип AutoCAD: роли не несёт и решения инженера не требует.
   *
   * Отделено от нераспознанного намеренно. На Талдыколе `Continuous` стоит у
   * 4243 сегментов, и попав в список «решает инженер», он хоронил под собой
   * 19 настоящих неизвестных имён.
   */
  standard: boolean
}

/**
 * Роль по имени типа линии. `null` в `role` при `nonEngineering: false` —
 * соглашение неизвестно, и решение остаётся за инженером.
 */
export function linetypeRole(lineType: string): LinetypeRoleResult {
  const name = lineType.trim().toLowerCase()
  // Стандартные типы AutoCAD роли не несут: ими рисуют что угодно.
  if (name === '' || ['bylayer', 'byblock', 'continuous', 'hidden', 'dashed', 'dot', 'center', 'phantom',
    'dashdot', 'divide', 'border', 'solid_line'].includes(name)) {
    return { role: null, nonEngineering: false, standard: true }
  }
  if (NON_ENGINEERING.test(name)) return { role: null, nonEngineering: true, standard: false }
  for (const entry of ROLE_ROOTS) {
    if (entry.roots.test(name)) return { role: entry.role, nonEngineering: false, standard: false }
  }
  return { role: null, nonEngineering: false, standard: false }
}

export interface LinetypeSegment {
  layer?: string
  lineType?: string
}

export interface LinetypeRoleSummary {
  /** Сегменты, роль которых выведена из типа линии, по ролям. */
  byRole: Array<{ role: DxfLayerRole; lineTypes: string[]; segments: number }>
  /** Сегменты с типом линии, прямо говорящим «не инженерная сеть». */
  nonEngineering: Array<{ lineType: string; segments: number }>
  /** Типы линий без известного соглашения: решает инженер. */
  unrecognized: Array<{ lineType: string; segments: number; layers: string[] }>
  reason: string
}

/**
 * Свод по типам линий среди сегментов, роль которых по имени слоя неизвестна.
 *
 * Слои с уже назначенной ролью не трогаются: имя слоя — прямое утверждение
 * съёмщика, и перебивать его косвенным признаком нельзя.
 */
export function summarizeLinetypeRoles(
  segments: LinetypeSegment[],
  roleByLayer: Readonly<Record<string, DxfLayerRole>>,
): LinetypeRoleSummary {
  const roleTypes = new Map<DxfLayerRole, Map<string, number>>()
  const nonEng = new Map<string, number>()
  const unknown = new Map<string, { segments: number; layers: Set<string> }>()

  for (const segment of segments) {
    const layer = segment.layer ?? ''
    const layerRole = roleByLayer[layer]
    if (layerRole !== undefined && layerRole !== 'unknown') continue
    const lineType = (segment.lineType ?? '').trim()
    const verdict = linetypeRole(lineType)
    if (verdict.nonEngineering) {
      nonEng.set(lineType, (nonEng.get(lineType) ?? 0) + 1)
      continue
    }
    if (verdict.role === null) {
      // Стандартный тип решения не требует: он не соглашение, а умолчание CAD.
      if (verdict.standard) continue
      const seen = unknown.get(lineType) ?? { segments: 0, layers: new Set<string>() }
      seen.segments += 1
      seen.layers.add(layer)
      unknown.set(lineType, seen)
      continue
    }
    const types = roleTypes.get(verdict.role) ?? new Map<string, number>()
    types.set(lineType, (types.get(lineType) ?? 0) + 1)
    roleTypes.set(verdict.role, types)
  }

  const byRole = [...roleTypes]
    .map(([role, types]) => ({
      role,
      lineTypes: [...types.keys()].sort(),
      segments: [...types.values()].reduce((sum, count) => sum + count, 0),
    }))
    .sort((left, right) => right.segments - left.segments)
  const nonEngineering = [...nonEng]
    .map(([lineType, segments]) => ({ lineType, segments }))
    .sort((left, right) => right.segments - left.segments)
  const unrecognized = [...unknown]
    .map(([lineType, item]) => ({ lineType, segments: item.segments, layers: [...item.layers].sort() }))
    .sort((left, right) => right.segments - left.segments)

  const recovered = byRole.reduce((sum, item) => sum + item.segments, 0)
  return {
    byRole,
    nonEngineering,
    unrecognized,
    reason: recovered === 0
      ? `По типам линий роль не выведена ни для одного сегмента; нераспознанных типов ${unrecognized.length}.`
      : `Роль выведена по типу линии для ${recovered} сегментов на слоях без роли `
        + `(${byRole.map((item) => `${item.role} — ${item.segments}`).join(', ')}). `
        + `Заведомо не инженерных: ${nonEngineering.reduce((sum, item) => sum + item.segments, 0)}. `
        + `Нераспознанных типов: ${unrecognized.length}. `
        + 'Слои с назначенной ролью не затронуты: имя слоя — прямое утверждение съёмщика.',
  }
}
