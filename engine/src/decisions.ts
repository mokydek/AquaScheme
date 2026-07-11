import type { Basis } from './normregistry'
import type { NormativeParams } from './norms'
import type { SizingIssue } from './sizing'
import type { MaterialReasonCode } from './equipment'

/**
 * Ties engine decisions to norm registry clauses (requirements update 2, N2).
 * Type only imports keep this module free of the EPANET runtime so it can live
 * in the main engine bundle. Decisions that norms do not regulate are marked
 * with an explicit non normative basis, never masked as normative.
 */

/** Norm clause ids that justify each sizing issue. */
export const ISSUE_REFS: Record<SizingIssue['kind'], string[]> = {
  lowPressure: ['freeHead.base', 'freeHead.perFloor'],
  highPressure: ['freeHead.max'],
  highVelocity: ['velocity.max'],
  lowVelocity: ['velocity.economic'],
  noSuitableItem: [],
}

/** Basis of each sizing issue (noSuitableItem is a catalog, not a norm, limit). */
export const ISSUE_BASIS: Record<SizingIssue['kind'], Basis> = {
  lowPressure: 'normative',
  highPressure: 'normative',
  highVelocity: 'normative',
  lowVelocity: 'normative',
  noSuitableItem: 'economic',
}

/** Norm basis for each material selection reason. */
export const REASON_REFS: Record<MaterialReasonCode, { refs: string[]; basis: Basis; note?: string }> = {
  corrosionProtection: {
    refs: [],
    basis: 'engineering',
    note: 'Выбор неметаллического материала по условиям грунтов; норматив конкретную марку не регламентирует',
  },
  seismicJoints: { refs: ['seismic.joints'], basis: 'normative' },
  subsidence: {
    refs: ['seismic.joints'],
    basis: 'engineering',
    note: 'Учёт просадочности; гибкость стыков по инженерному решению',
  },
  flood: {
    refs: [],
    basis: 'engineering',
    note: 'Защита от подтопления по инженерному решению; отдельным пунктом не регламентируется',
  },
  pressureClass: {
    refs: [],
    basis: 'economic',
    note: 'Класс давления принят с запасом от рабочего; выбор из ряда PN по минимальной стоимости',
  },
  freezingDepth: { refs: ['burial.depth'], basis: 'normative' },
}

export interface DecisionEntry {
  key: string
  valueText: string
  refs: string[]
  basis: Basis
  note?: string
}

/**
 * The journal of applied network level rules and their norm basis. Values come
 * from the active normative parameters; the clause ids point at the registry.
 */
export function buildDecisionLog(norms: NormativeParams): DecisionEntry[] {
  return [
    { key: 'Удельное водопотребление', valueText: `${norms.perCapitaDemandLpd} л/сут·чел`, refs: ['demand.perCapita'], basis: 'normative' },
    { key: 'Коэффициент суточной неравномерности', valueText: String(norms.dayMaxCoefficient), refs: ['demand.kDayMax'], basis: 'normative' },
    { key: 'Часовая неравномерность (alpha max)', valueText: String(norms.alphaMax), refs: ['demand.hourly'], basis: 'normative' },
    { key: 'Расход на пожаротушение', valueText: `${norms.fireFlowLps} л/с`, refs: ['fire.flow'], basis: 'normative' },
    { key: 'Экономичная скорость', valueText: '0.7..1.5 м/с', refs: ['velocity.economic'], basis: 'normative' },
    { key: 'Предельная скорость', valueText: '2.5 м/с', refs: ['velocity.max'], basis: 'normative' },
    {
      key: 'Свободный напор',
      valueText: `${norms.minFreeHeadBaseM} + ${norms.freeHeadPerFloorM}/этаж, до ${norms.maxFreeHeadM} м`,
      refs: ['freeHead.base', 'freeHead.perFloor', 'freeHead.max'],
      basis: 'normative',
    },
    { key: 'Кольцевание магистралей', valueText: 'кольцевая схема', refs: ['main.looped'], basis: 'normative' },
    { key: 'Шаг пожарных гидрантов', valueText: 'не более 150 м', refs: ['hydrant.spacing'], basis: 'normative' },
    { key: 'Глубина заложения', valueText: 'промерзание + 0.5 м', refs: ['burial.depth'], basis: 'normative' },
    {
      key: 'Материал труб',
      valueText: 'ПЭ100 / ВЧШГ по каталогу',
      refs: [],
      basis: 'economic',
      note: 'Из допустимых материалов принято по критерию минимальной стоимости; норматив выбор не регламентирует',
    },
    {
      key: 'Шероховатость старых труб (реконструкция)',
      valueText: 'оценка по износу',
      refs: [],
      basis: 'engineering',
      note: 'Инженерная оценка; уточняется по таблицам Шевелёва',
    },
  ]
}
