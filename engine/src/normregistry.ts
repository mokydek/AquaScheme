import type { SystemType, WorkType } from './types'

/**
 * Norm registry (requirements update 2): every decision the system makes must
 * cite a normative clause. This module is the single source of truth for the
 * clauses the engine relies on. The app mirrors it into the DB (norm_documents,
 * norm_clauses) so nothing drifts.
 *
 * CRITICAL: clause numbers are NOT invented. Every entry below starts as
 * 'unverified' because the numbers were derived from general engineering
 * knowledge, not from the official document text. A clause of null means
 * TODO_NORM_REF (the exact number is unknown). The engineer confirms each
 * entry against the official SP RK / GOST edition, which promotes it to
 * 'verified'. An invented clause number is worse than a missing one.
 */

export type NormStatus = 'verified' | 'unverified'

/** Whether a decision rests on a norm, or is a project/economic choice. */
export type Basis = 'normative' | 'engineering' | 'economic'

export interface NormDocument {
  code: string
  title: string
  edition: string
  status: NormStatus
}

export interface NormClause {
  /** Stable key referenced from engine decisions, e.g. 'freeHead.base'. */
  id: string
  documentCode: string
  /** Clause number, or null for TODO_NORM_REF (unknown exact number). */
  clause: string | null
  requirement: string
  valueText: string
  units: string
  appliesSystem: SystemType[]
  appliesWork: WorkType[]
  status: NormStatus
}

/** A value carried together with its normative (or explicit non-norm) basis. */
export interface Justified<T> {
  value: T
  /** norm_clause ids from the registry. */
  refs: string[]
  basis: Basis
  note?: string
}

export function justified<T>(value: T, refs: string[], basis: Basis = 'normative', note?: string): Justified<T> {
  return note ? { value, refs, basis, note } : { value, refs, basis }
}

const WATER: SystemType[] = ['water']
const BOTH_WORK: WorkType[] = ['new', 'reconstruction']

export const NORM_DOCUMENTS: NormDocument[] = [
  { code: 'СП РК 4.01-101-2012', title: 'Водоснабжение. Наружные сети и сооружения', edition: '2012', status: 'unverified' },
  { code: 'СНиП 2.04.02-84*', title: 'Водоснабжение. Наружные сети и сооружения', edition: '1984 (справочно)', status: 'unverified' },
  { code: 'СНиП 2.04.01-85*', title: 'Внутренний водопровод и канализация зданий', edition: '1985 (справочно)', status: 'unverified' },
  { code: 'СП РК 2.03-30-2017', title: 'Строительство в сейсмических зонах', edition: '2017', status: 'unverified' },
  { code: 'ГОСТ 21.704-2011', title: 'Правила выполнения рабочей документации наружных сетей', edition: '2011', status: 'unverified' },
  { code: 'СП РК 2.04-01-2017', title: 'Строительная климатология', edition: '2017', status: 'unverified' },
  { code: 'СНиП 2.01.15-90', title: 'Инженерная защита территорий, зданий и сооружений от опасных геологических процессов', edition: '1990 (справочно)', status: 'unverified' },
  { code: 'СНиП 2.04.03-85', title: 'Канализация. Наружные сети и сооружения', edition: '1985 (справочно)', status: 'unverified' },
]

/**
 * Every entry is 'unverified' until confirmed against the official text.
 * clause: null means TODO_NORM_REF.
 */
export const NORM_REGISTRY: NormClause[] = [
  {
    id: 'freeHead.base',
    documentCode: 'СНиП 2.04.02-84*',
    clause: '2.26',
    requirement: 'Минимальный свободный напор в сети при одноэтажной застройке',
    valueText: '10',
    units: 'м',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'freeHead.perFloor',
    documentCode: 'СНиП 2.04.02-84*',
    clause: '2.26',
    requirement: 'Добавка к свободному напору на каждый этаж выше первого',
    valueText: '4',
    units: 'м на этаж',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'freeHead.max',
    documentCode: 'СНиП 2.04.02-84*',
    clause: '2.28',
    requirement: 'Максимальный свободный напор в сети хозяйственно-питьевого водопровода',
    valueText: '60',
    units: 'м',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'demand.perCapita',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement: 'Удельное среднесуточное водопотребление на жителя',
    valueText: '200',
    units: 'л/сут на человека',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'demand.kDayMax',
    documentCode: 'СНиП 2.04.02-84*',
    clause: '2.2',
    requirement: 'Коэффициент суточной неравномерности водопотребления',
    valueText: '1.1..1.3',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'demand.hourly',
    documentCode: 'СНиП 2.04.02-84*',
    clause: '2.2',
    requirement: 'Коэффициент часовой неравномерности K_ч.max = alpha_max × beta_max(N)',
    valueText: 'таблица beta_max',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'fire.flow',
    documentCode: 'СНиП 2.04.02-84*',
    clause: '2.12..2.14 (табл.)',
    requirement: 'Расчётный расход воды на наружное пожаротушение',
    valueText: '15',
    units: 'л/с',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'velocity.economic',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement: 'Экономичный диапазон скоростей движения воды в трубах',
    valueText: '0.7..1.5',
    units: 'м/с',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'velocity.max',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement: 'Предельно допустимая скорость движения воды в трубах',
    valueText: '2.5',
    units: 'м/с',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'burial.depth',
    documentCode: 'СНиП 2.04.02-84*',
    clause: null,
    requirement: 'Глубина заложения: низ трубы ниже расчётной глубины промерзания',
    valueText: 'промерзание + 0.5',
    units: 'м',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'hydrant.spacing',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement: 'Максимальное расстояние между пожарными гидрантами вдоль проездов',
    valueText: '150',
    units: 'м',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'main.looped',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement: 'Магистральные сети населённых пунктов проектируются кольцевыми',
    valueText: 'кольцевание',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'seismic.joints',
    documentCode: 'СП РК 2.03-30-2017',
    clause: null,
    requirement: 'Сейсмичность 7 баллов и выше: сварные соединения или гибкие стыки, компенсаторы',
    valueText: '>= 7 баллов',
    units: 'баллы',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'drawing.layers',
    documentCode: 'ГОСТ 21.704-2011',
    clause: null,
    requirement: 'Правила выполнения рабочей документации и оформления слоёв чертежа',
    valueText: 'слои В1',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'preset.nonResidential',
    documentCode: 'СНиП 2.04.01-85*',
    clause: 'прил. 3',
    requirement: 'Удельные нормы водопотребления для нежилых зданий (справочно)',
    valueText: 'таблица',
    units: 'л/сут на единицу',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'region.seismicMap',
    documentCode: 'СП РК 2.03-30-2017',
    clause: null,
    requirement: 'Сейсмичность площадки принимается по картам сейсмического зонирования региона',
    valueText: 'по региону',
    units: 'баллы',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'region.freezing',
    documentCode: 'СП РК 2.04-01-2017',
    clause: null,
    requirement: 'Нормативная глубина промерзания грунтов принимается по климатическим данным региона',
    valueText: 'по региону',
    units: 'м',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'hazard.flood',
    documentCode: 'СНиП 2.04.02-84*',
    clause: null,
    requirement:
      'На подтопляемых территориях: герметичные колодцы, обратные клапаны на выпусках, отметки люков выше расчётного горизонта воды',
    valueText: 'мероприятия',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'hazard.slopes',
    documentCode: 'СНиП 2.01.15-90',
    clause: null,
    requirement:
      'Сели, оползни, карст: специальные инженерные мероприятия по отдельному проекту инженерной защиты',
    valueText: 'предупреждение',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'geology.corrosion',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement:
      'Защита труб от коррозии по степени агрессивности грунтов и подземных вод вдоль трассы',
    valueText: 'по агрессивности',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'geology.bedding',
    documentCode: 'СП РК 4.01-101-2012',
    clause: null,
    requirement: 'Тип основания и постели (обсыпки) труб принимается по виду грунта вдоль трассы',
    valueText: 'по грунту',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'geology.dewatering',
    documentCode: 'СНиП 2.04.02-84*',
    clause: null,
    requirement: 'При уровне грунтовых вод выше дна траншеи предусматривается водопонижение',
    valueText: 'УГВ выше дна',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'drainage.equalsWater',
    documentCode: 'СНиП 2.04.03-85',
    clause: null,
    requirement:
      'Удельное водоотведение принимается равным удельному водопотреблению без учёта расхода на полив',
    valueText: 'водоотведение = водопотребление без полива',
    units: '—',
    appliesSystem: ['sewer'],
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
]

const CLAUSE_BY_ID = new Map(NORM_REGISTRY.map((c) => [c.id, c]))

export function getClause(id: string): NormClause | undefined {
  return CLAUSE_BY_ID.get(id)
}

export function unverifiedClauses(): NormClause[] {
  return NORM_REGISTRY.filter((c) => c.status === 'unverified')
}
