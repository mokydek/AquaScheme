import type { SystemType, WorkType } from './types'

/**
 * Norm registry (requirements update 2): every decision the system makes must
 * cite a normative clause. This module is the single source of truth for the
 * clauses the engine relies on. The app mirrors it into the DB (norm_documents,
 * norm_clauses) so nothing drifts.
 *
 * CRITICAL: clause numbers are NOT invented. An entry is 'verified' ONLY when
 * its wording was transcribed from an official PDF in docs/norms (sourceFile +
 * sourcePage recorded). Entries derived from general engineering knowledge
 * stay 'unverified'; a clause of null means TODO_NORM_REF (the exact number is
 * unknown). An invented clause number is worse than a missing one.
 */

export type NormStatus = 'verified' | 'unverified'

/** Whether a decision rests on a norm, or is a project/economic choice. */
export type Basis = 'normative' | 'engineering' | 'economic'

export interface NormDocument {
  code: string
  title: string
  edition: string
  status: NormStatus
  /** Repo-relative path of the official PDF, when it is in docs/norms. */
  sourceFile?: string
  note?: string
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
  /** Repo-relative path of the official PDF the wording was transcribed from. */
  sourceFile?: string
  /** PDF page (not print page) where the clause text sits. */
  sourcePage?: number
  /** OCR doubt: the digits must be re-checked against the PDF page by eye. */
  verifyPage?: boolean
  /** Free-form note (e.g. why a foreign standard is used as a template). */
  note?: string
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
const SEWER: SystemType[] = ['sewer']
const STORM: SystemType[] = ['storm']
const SEWER_STORM: SystemType[] = ['sewer', 'storm']
const ALL_SYSTEMS: SystemType[] = ['water', 'sewer', 'storm']
const BOTH_WORK: WorkType[] = ['new', 'reconstruction']

const SN_VODOOTVEDENIE_PDF = 'docs/norms/sn-rk-4-01-03-2013-vodootvedenie.pdf'

export const NORM_DOCUMENTS: NormDocument[] = [
  {
    code: 'СН РК 4.01-03-2013*',
    title: 'Водоотведение. Наружные сети и сооружения',
    edition: '2013 с изменениями (действующая редакция)',
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    note: 'Основной документ по водоотведению (К1, К2). Применяется по умолчанию вместо издания 2011 года.',
  },
  {
    code: 'СН РК 4.01-03-2011*',
    title: 'Водоотведение. Наружные сети и сооружения',
    edition: '2011 с изм. 2021',
    status: 'verified',
    sourceFile: 'docs/norms/sn-rk-4-01-03-2011-vodootvedenie-izm-2021.pdf',
    note: 'Раннее издание. Зарегистрировано для сравнения, см. docs/norms/CONFLICTS.md. Решения по нему не принимаются, пока пользователь не выберет иное.',
  },
  {
    code: 'СП РК 4.01-103-2013',
    title: 'Наружные сети и сооружения водоснабжения и канализации',
    edition: '2013',
    status: 'verified',
    sourceFile: 'docs/norms/sp-rk-4-01-103-2013-naruzhnye-seti-vik.pdf',
    note: 'Свод правил к СН; формы актов испытаний, промывки, скрытых работ.',
  },
  {
    code: 'СН РК 1.02-03-2022',
    title: 'Порядок разработки, согласования и утверждения проектной документации',
    edition: '2022',
    status: 'verified',
    sourceFile: 'docs/norms/sn-rk-1-02-03-2022-sostav-psd.pdf',
    note: 'Состав ПСД, задание на проектирование, ТЭП, паспорт проекта.',
  },
  {
    code: 'ГОСТ 21.110-2013',
    title: 'СПДС. Спецификация оборудования, изделий и материалов',
    edition: '2013',
    status: 'verified',
    sourceFile: 'docs/norms/gost-21-110-2013-specifikaciya.pdf',
  },
  {
    code: 'ГОСТ Р 21.101-2020',
    title: 'СПДС. Основные требования к проектной и рабочей документации',
    edition: '2020',
    status: 'verified',
    sourceFile: 'docs/norms/gost-r-21-101-2020-osnovnye-trebovaniya.pdf',
    note: 'Российский стандарт. Используется как методический образец оформления; при расхождении приоритет у норм РК.',
  },
  {
    code: 'Водный кодекс РК',
    title: 'Водный кодекс Республики Казахстан',
    edition: '2025',
    status: 'verified',
    sourceFile: 'docs/norms/vodny-kodeks-rk-2025.pdf',
  },
  {
    code: 'Земельный кодекс РК',
    title: 'Земельный кодекс Республики Казахстан',
    edition: '2003 (действующая редакция)',
    status: 'verified',
    sourceFile: 'docs/norms/zemelny-kodeks-rk-2003.pdf',
  },
  {
    code: 'Экологический кодекс РК',
    title: 'Экологический кодекс Республики Казахстан',
    edition: '2021 (действующая редакция)',
    status: 'verified',
    sourceFile: 'docs/norms/ekologichesky-kodeks-rk-2021.pdf',
  },
  {
    code: 'Строительный кодекс РК',
    title: 'Строительный кодекс Республики Казахстан',
    edition: '2026 (вводится)',
    status: 'verified',
    sourceFile: 'docs/norms/stroitelny-kodeks-rk-2026.pdf',
  },
  {
    code: 'АГСК-3',
    title:
      'Архитектурный, градостроительный и строительный каталог. Перечень строительных конструкций, изделий и строительных материалов (СҚҚК-3)',
    edition: 'по состоянию на 3 апреля 2026 года',
    status: 'verified',
    note: 'Официальный каталог-классификатор материалов и изделий РК; источник кодов продукции для спецификации (ГОСТ 21.110). Точная позиция подбирается по разделам каталога.',
  },
  { code: 'СП РК 4.01-101-2012', title: 'Водоснабжение. Наружные сети и сооружения', edition: '2012', status: 'unverified' },
  { code: 'СНиП 2.04.02-84*', title: 'Водоснабжение. Наружные сети и сооружения', edition: '1984 (справочно)', status: 'unverified' },
  { code: 'СНиП 2.04.01-85*', title: 'Внутренний водопровод и канализация зданий', edition: '1985 (справочно)', status: 'unverified' },
  { code: 'СП РК 2.03-30-2017', title: 'Строительство в сейсмических зонах', edition: '2017', status: 'unverified' },
  {
    code: 'ГОСТ 21.704-2011',
    title: 'СПДС. Правила выполнения рабочей документации наружных сетей водоснабжения и канализации',
    edition: '2011',
    status: 'verified',
    sourceFile: 'docs/norms/gost-21-704-2011-rd-nvk.pdf',
  },
  { code: 'СП РК 2.04-01-2017', title: 'Строительная климатология', edition: '2017', status: 'unverified' },
  { code: 'СНиП 2.01.15-90', title: 'Инженерная защита территорий, зданий и сооружений от опасных геологических процессов', edition: '1990 (справочно)', status: 'unverified' },
  { code: 'СНиП 2.04.03-85', title: 'Канализация. Наружные сети и сооружения', edition: '1985 (справочно)', status: 'unverified' },
  { code: 'ТЗ на проектирование', title: 'Задание на проектирование объекта (утверждается заказчиком, реквизиты — в проекте)', edition: 'по проекту', status: 'unverified' },
]

/**
 * An entry is 'unverified' until confirmed against the official text
 * (docs/norms PDF, sourceFile + sourcePage). clause: null means TODO_NORM_REF.
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
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.5.1',
    requirement:
      'Расчетное удельное среднесуточное (за год) водоотведение бытовых сточных вод от жилых зданий принимается равным расчетному удельному среднесуточному (за год) водопотреблению согласно СНиП РК 4.01-02 без учета расхода воды на полив территорий и зеленых насаждений',
    valueText: 'водоотведение = водопотребление без полива',
    units: '—',
    appliesSystem: ['sewer'],
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 32,
  },

  // ============================================================
  // СН РК 4.01-03-2013* — записи сверены с официальным PDF
  // (docs/norms/sn-rk-4-01-03-2013-vodootvedenie.pdf, страницы PDF).
  // ============================================================
  {
    id: 'storm.runoff.limitIntensity',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.4.1, формулы 5.8–5.9',
    requirement: 'Расход дождевых вод определяется методом предельных интенсивностей; расчётный расход для гидравлики равен beta, умноженному на q_r',
    valueText: 'q_r = z_mid·A^1.2·F / t_r^(1.2n-0.1); q_cal = beta·q_r',
    units: 'л/с',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 27,
  },
  {
    id: 'storm.rain.parameters',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.4.2, формула 5.10',
    requirement: 'Параметры A и n определяются по обработанным записям дождемеров; при их отсутствии A допускается определять по q20, P, m_r и gamma',
    valueText: 'A = q20·20^n·(1 + lg(P)/lg(m_r))^gamma',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 28,
  },
  {
    id: 'storm.runoff.travelTime',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.4.5–5.4.6, формулы 5.11–5.13',
    requirement: 'Продолжительность дождя равна сумме времени поверхностной концентрации и протекания по лоткам и трубам',
    valueText: 't_r = t_con + t_can + t_p; t_can = 0.021·Σ(l/v); t_p = 0.017·Σ(l/v)',
    units: 'мин',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 31,
  },
  {
    id: 'storm.runoff.surface',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.4.7–5.4.8, Таблицы 5.10–5.11',
    requirement: 'Средний коэффициент поверхности z_mid определяется как средневзвешенный по площадям; для водосборов свыше 50 га выполняются проверочные расчёты частей',
    valueText: 'z_mid = Σ(z_i·F_i) / ΣF_i',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 31,
  },
  {
    id: 'storm.runoff.beta',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.4.9, Таблица 5.12',
    requirement: 'Коэффициент beta принимается по n с корректировками по уклону и числу участков',
    valueText: 'beta = 0.80; 0.75; 0.70; 0.65 при n = ≤0.40; 0.50; 0.60; ≥0.70',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 32,
  },
  {
    id: 'sewer.demand.noSewer',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.5.4',
    requirement: 'Удельное водоотведение в районах с отсутствием системы водоотведения',
    valueText: '25',
    units: 'л/сут на жителя',
    appliesSystem: SEWER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 33,
  },
  {
    id: 'sewer.demand.local',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.5.5',
    requirement:
      'Сточные воды предприятий местной промышленности, обслуживающих население, и неучтённые расходы допускается принимать дополнительно в размере 5% суммарного среднесуточного водоотведения населённого пункта (при соответствующем обосновании)',
    valueText: '5',
    units: '% суммарного среднесуточного водоотведения',
    appliesSystem: SEWER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 33,
  },
  {
    id: 'sewer.kgen',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.5.7, Таблица 5.13',
    requirement:
      'Общие коэффициенты неравномерности притока (максимальные и минимальные) при отсутствии данных моделирования; при среднем расходе менее 5 л/с максимальный коэффициент принимается 3',
    valueText: 'Таблица 5.13: K_gen.max 3.0..1.6 (1%), K_gen.min 0.2..0.56 (1%)',
    units: '—',
    appliesSystem: SEWER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 34,
  },
  {
    id: 'sewer.infiltration',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.5.12',
    requirement:
      'Самотечные линии, коллекторы и напорные трубопроводы проверяются на пропуск суммарного расчетного максимального расхода и дополнительного притока поверхностных и грунтовых вод (формула 5.14, q_ad по длине сети и суточному максимуму осадков); проверочный расчет — при наполнении 0,95 высоты',
    valueText: 'проверка при наполнении 0.95',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 34,
  },
  {
    id: 'sewer.roughness',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.8.1',
    requirement:
      'Коэффициент шероховатости n1 для гидравлического расчета: самотечные коллекторы круглого сечения 0,014, напорные трубопроводы 0,013; эквивалентная шероховатость и коэффициент a2 по Таблице 5.18',
    valueText: 'n1 = 0.014 (самотечные), 0.013 (напорные)',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 38,
  },
  {
    id: 'sewer.minDiameter',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.9.1',
    requirement:
      'Наименьшие диаметры труб самотечных сетей бытового и производственного водоотведения: уличная сеть 200 мм, внутриквартальная 150 мм; в населенных пунктах с расходом до 300 м3/сут допускается 150 мм для обеих',
    valueText: 'улица 200, квартал 150',
    units: 'мм',
    appliesSystem: SEWER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 39,
  },
  {
    id: 'storm.minDiameter',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.9.1',
    requirement:
      'Наименьшие диаметры труб дождевой и общесплавной сети: уличная 250 мм, внутриквартальная 200 мм',
    valueText: 'улица 250, квартал 200',
    units: 'мм',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 39,
  },
  {
    id: 'sewer.design.minBurial',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: null,
    requirement:
      'Критерий подбора самотёчного коллектора на плоском рельефе: минимизация заглубления — больший диаметр с минимально необходимым уклоном вместо минимального диаметра с крутым уклоном; оба решения удовлетворяют нормам наполнения и скоростей — выбор является проектным решением',
    valueText: 'минимизация заглубления',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'route.redLines',
    documentCode: 'ТЗ на проектирование',
    clause: 'п. 6.1',
    requirement:
      'Коллектор укладывать в границах красных линий улиц и дорог в соответствии с ПДП района; трасса — в коридоре земельного отвода по акту выбора',
    valueText: 'трасса в границах коридора',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'crossing.casing',
    documentCode: 'ТЗ на проектирование',
    clause: 'п. 6.1',
    requirement: 'Переходы через существующие и проектируемые дороги выполнить в футляре',
    valueText: 'футляр на каждом переходе',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'manhole.grille',
    documentCode: 'ТЗ на проектирование',
    clause: 'п. 6.1',
    requirement: 'Предусмотреть в смотровых колодцах защитные решётки с антикоррозийным покрытием',
    valueText: 'решётка в каждом смотровом колодце',
    units: 'шт',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'pump.liftStation',
    documentCode: 'ТЗ на проектирование',
    clause: 'п. 6.1',
    requirement:
      'При необходимости — подкачивающие насосные станции без надземной части, автоматический режим в максимальный дождь через аварийный перелив, без перекачки максимальных расходов насосами',
    valueText: 'НС по условиям профиля',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'scheme.masterPlanBasis',
    documentCode: 'ТЗ на проектирование',
    clause: 'п. 6.1',
    requirement:
      'Состав сооружений, диаметры и параметры определить и обосновать расчётами, приняв за основу ПДП (предварительную схему), разработанную генпланом; расхождения расчёта со схемой обосновываются явно',
    valueText: 'схема генплана — основа, отклонения обосновать',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'unverified',
  },
  {
    id: 'sewer.velocity.min',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.10.1, Таблица 5.19',
    requirement:
      'Наименьшие самоочищающие скорости при наибольшем расчетном наполнении: 0,70 м/с (150..250 мм, H/D 0,60) … 1,50 м/с (свыше 1500 мм, H/D 0,80); для дождевой сети при P = 0,33 года — 0,6 м/с',
    valueText: 'Таблица 5.19: 0.70..1.50',
    units: 'м/с',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 40,
  },
  {
    id: 'sewer.velocity.max',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.10.3',
    requirement:
      'Наибольшая расчетная скорость движения сточных вод: металлические трубы до 8 м/с, неметаллические до 4 м/с, дождевая сеть от 7 до 10 м/с',
    valueText: 'металл 8, неметалл 4, дождевая 7..10',
    units: 'м/с',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 40,
  },
  {
    id: 'sewer.filling.max',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.10.7',
    requirement:
      'Расчетное наполнение: не более 0,8 диаметра (высоты) для сечений любой формы, кроме прямоугольного (не более 0,75 высоты); для дождевой сети — полное наполнение',
    valueText: '0.8 D (0.75 прямоугольные, дождевая — полное)',
    units: 'доля диаметра',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 41,
  },
  {
    id: 'sewer.slope.min',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.11.1',
    requirement:
      'Наименьшие уклоны трубопроводов для всех систем водоотведения: 150 мм — 0,008, 200 мм — 0,007; при обосновании для отдельных участков 200 мм — 0,005, 150 мм — 0,007; уклон присоединения от дождеприемников 0,02; для диаметров более 200 мм — по пособию [1]',
    valueText: '150 мм: 0.008; 200 мм: 0.007',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 42,
  },
  {
    id: 'storm.slope.open',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '5.11.2, Таблица 5.22',
    requirement:
      'Наименьшие уклоны открытой дождевой сети: лотки проезжей части 0,003 (асфальтобетон), 0,004 (брусчатка, щебень), 0,005 (булыжник); отдельные лотки и кюветы 0,005; водоотводные канавы 0,003',
    valueText: 'Таблица 5.22: 0.003..0.005',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 42,
  },
  {
    id: 'sewer.parallel.spacing',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.1.4',
    requirement:
      'При параллельной прокладке двух коллекторов расстояние между ними принимается равным пяти диаметрам наибольшего из коллекторов, но не менее 10 м',
    valueText: '5D, не менее 10 м',
    units: 'м',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 47,
  },
  {
    id: 'sewer.aboveGround.ban',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.1.7',
    requirement:
      'Надземная и наземная прокладка трубопроводов сетей водоотведения на территории населенных пунктов не допускается',
    valueText: 'запрещена',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 48,
  },
  {
    id: 'sewer.junction.angle',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.2.1',
    requirement:
      'Угол между присоединяемой и отводящей трубами должен быть не менее 90°; любой угол допускается при устройстве перепада в виде стояка и присоединении дождеприемников с перепадом',
    valueText: '>= 90',
    units: 'градусы',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 48,
  },
  {
    id: 'sewer.depth.min',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.2.4',
    requirement:
      'Минимальная глубина заложения лотка при отсутствии данных эксплуатации: для труб до 500 мм — на 0,3 м, большего диаметра — на 0,5 м менее большей глубины проникания в грунт нулевой температуры, но не менее 0,7 м до верха трубы от поверхности земли или планировки',
    valueText: 'промерзание − 0.3 (D<=500) / − 0.5, но >= 0.7 до верха',
    units: 'м',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 49,
  },
  {
    id: 'sewer.pressure.slope',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.3.4',
    requirement:
      'Уклон напорных трубопроводов по направлению к выпуску не менее 0,001; диаметр выпусков — из условия опорожнения участка не более чем за 3 часа',
    valueText: '0.001',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 50,
  },
  {
    id: 'sewer.manhole.spacing',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.4.1',
    requirement:
      'Смотровые колодцы: в местах присоединений, изменения направления, уклонов и диаметров; на прямых участках через 35 м (150 мм), 50 м (200..450), 75 м (500..600), 100 м (700..900), 150 м (1000..1400), 200 м (1500..2000), 250..300 м (свыше 2000)',
    valueText: '35..300 по диаметру',
    units: 'м',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 50,
  },
  {
    id: 'sewer.manhole.size',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.4.2',
    requirement:
      'Размеры колодцев бытовой и производственной сети: до 600 мм — длина и ширина 1000 мм (круглые диаметром 1000 мм); 700 мм и более — длина D + 400 мм, ширина D + 500 мм; при глубине свыше 1,8 м диаметр колодца не менее 1500 мм',
    valueText: 'до 600: 1000; от 700: D+400 x D+500',
    units: 'мм',
    appliesSystem: SEWER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 51,
  },
  {
    id: 'sewer.drop.wells',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.5.1',
    requirement:
      'Перепадные колодцы: для уменьшения глубины заложения, во избежание превышения максимальной скорости, при пересечении с подземными сооружениями, при затопленных выпусках; перепады до 0,5 м на трубах до 600 мм допускаются сливом в смотровом колодце',
    valueText: 'перечень случаев',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 52,
  },
  {
    id: 'storm.inlet.spacing',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.6.6',
    requirement:
      'Расстояния между дождеприемниками при ширине улиц до 30 м: 50 м (уклон до 0,004), 60 м (до 0,006), 70 м (до 0,01), 80 м (до 0,03); при ширине улицы более 30 м — не более 60 м; ширина потока в лотке перед решеткой не более 2,0 м',
    valueText: '50..80 по уклону; > 30 м ширины: 60',
    units: 'м',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 54,
  },
  {
    id: 'storm.inlet.connection',
    documentCode: 'СН РК 4.01-03-2013*',
    clause: '7.6.7',
    requirement:
      'Длина присоединения от дождеприемника до смотрового колодца не более 40 м с установкой не более одного промежуточного дождеприемника; диаметр присоединения по расчетному притоку при уклоне 0,02, но не менее 200 мм',
    valueText: '<= 40 м; D >= 200 мм; уклон 0.02',
    units: '—',
    appliesSystem: STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: SN_VODOOTVEDENIE_PDF,
    sourcePage: 54,
  },

  // ============================================================
  // СП РК 4.01-103-2013 — обязательные формы актов испытаний и приемки.
  // Сверено с docs/norms/sp-rk-4-01-103-2013-naruzhnye-seti-vik.pdf.
  // ============================================================
  {
    id: 'act.pressureTest',
    documentCode: 'СП РК 4.01-103-2013',
    clause: 'Приложения А, В, Г',
    requirement:
      'Испытание трубопроводов: приемочное гидравлическое испытание напорного трубопровода на прочность и герметичность (прил. А), пневматическое испытание напорного трубопровода (прил. В), приемочное гидравлическое испытание безнапорного трубопровода на герметичность (прил. Г)',
    valueText: 'формы актов А/В/Г',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/sp-rk-4-01-103-2013-naruzhnye-seti-vik.pdf',
    sourcePage: 111,
  },
  {
    id: 'act.disinfection',
    documentCode: 'СП РК 4.01-103-2013',
    clause: 'Приложение Е',
    requirement:
      'Форма акта о проведении промывки и дезинфекции трубопроводов (сооружений) хозяйственно-питьевого водоснабжения хлорированием с заключением СЭС',
    valueText: 'форма акта Е',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/sp-rk-4-01-103-2013-naruzhnye-seti-vik.pdf',
    sourcePage: 122,
  },
  {
    id: 'act.inputControl',
    documentCode: 'СП РК 4.01-103-2013',
    clause: 'Приложение Ж',
    requirement:
      'Форма акта о проведении входного контроля партии труб (соединительных деталей) на соответствие стандартам РК и сопроводительным сертификатам',
    valueText: 'форма акта Ж',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/sp-rk-4-01-103-2013-naruzhnye-seti-vik.pdf',
    sourcePage: 124,
  },

  // ============================================================
  // СН РК 1.02-03-2022 — состав ПСД: задание, ТЭП, паспорт проекта.
  // Сверено с docs/norms/sn-rk-1-02-03-2022-sostav-psd.pdf.
  // ============================================================
  {
    id: 'psd.designTask',
    documentCode: 'СН РК 1.02-03-2022',
    clause: 'раздел 5; Приложения Б, В',
    requirement:
      'Задание на проектирование составляется заказчиком (раздел 5). Перечень основных данных и требований для объектов производственного назначения (прил. Б) и жилищно-гражданского назначения (прил. В)',
    valueText: 'перечень данных задания',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/sn-rk-1-02-03-2022-sostav-psd.pdf',
    sourcePage: 107,
  },
  {
    id: 'psd.tep',
    documentCode: 'СН РК 1.02-03-2022',
    clause: 'Приложение Г',
    requirement:
      'Примерный перечень технико-экономических показателей (ТЭП). Для инженерных сооружений включаются производительность (суточная, годовая), протяженность трассы и общая длина трубопроводов (примечание 2)',
    valueText: 'перечень ТЭП',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/sn-rk-1-02-03-2022-sostav-psd.pdf',
    sourcePage: 111,
  },
  {
    id: 'psd.passport',
    documentCode: 'СН РК 1.02-03-2022',
    clause: 'Приложение Д, форма Ф-2',
    requirement:
      'Паспорт проекта (рабочего проекта) на строительство инженерных сетей и систем (форма Ф-2); обязательная часть проекта, объем не более 2 страниц А4',
    valueText: 'форма Ф-2',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/sn-rk-1-02-03-2022-sostav-psd.pdf',
    sourcePage: 119,
  },

  // ============================================================
  // ГОСТы оформления рабочей документации (СПДС).
  // ============================================================
  {
    id: 'drawing.generalData',
    documentCode: 'ГОСТ 21.704-2011',
    clause: '4',
    requirement:
      'Общие данные по рабочим чертежам наружных сетей: ситуационный план сетей (без масштаба), основные показатели сетей ВиК по форме 1 (наименование сети, расчетный расход воды м3/сут, м3/ч, л/с); в общих указаниях приводят ссылки на нормативы, инженерно-геологическую характеристику, особые требования, требования к изготовлению, монтажу, испытанию, антикоррозионной защите (п. 4.5)',
    valueText: 'состав листа «Общие данные»',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/gost-21-704-2011-rd-nvk.pdf',
    sourcePage: 7,
  },
  {
    id: 'drawing.plan',
    documentCode: 'ГОСТ 21.704-2011',
    clause: '5.1',
    requirement:
      'Планы сетей: подоснова тонкой линией, проектируемый участок толстой основной линией; наносят координаты или привязки, числовые значения углов поворотов (кроме 90°), диаметры до и после точек изменения, сооружения на сети (колодцы, камеры, дождеприемники, дюкеры, переходы) с обозначениями и нумерацией',
    valueText: 'состав плана сетей',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/gost-21-704-2011-rd-nvk.pdf',
    sourcePage: 7,
  },
  {
    id: 'drawing.profile',
    documentCode: 'ГОСТ 21.704-2011',
    clause: '5.2',
    requirement:
      'Продольные профили — развертки по осям трубопроводов. Наносят поверхность земли (проектную тонкой сплошной, натурную тонкой штриховой), уровень грунтовых вод штрихпунктирной, данные о грунтах колонками, трубопровод и колодцы. Боковик таблицы под профилем — по форме 2: проектная отметка низа/лотка трубы, проектная отметка земли, натурная отметка земли, обозначение трубы и тип изоляции, основание, уклон и длина, расстояние, номер колодца (точки, угла поворота)',
    valueText: 'форма 2 боковика профиля',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/gost-21-704-2011-rd-nvk.pdf',
    sourcePage: 8,
  },
  {
    id: 'spec.form',
    documentCode: 'ГОСТ 21.110-2013',
    clause: '4; форма 1',
    requirement:
      'Спецификацию оборудования, изделий и материалов составляют по форме 1. Графы: «Поз.», «Наименование и техническая характеристика», «Тип, марка, обозначение документа, опросного листа», «Код продукции», «Поставщик», «Ед. измерения», «Кол.», «Масса 1 ед., кг», «Примечание». Изделия и материалы размещают по группам в порядке возрастания основных параметров (тип, марка, диаметр). Наименование для наружных сетей ВиК: «Спецификация оборудования, изделий и материалов наружных сетей водоснабжения и канализации»',
    valueText: 'форма 1, графы спецификации',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/gost-21-110-2013-specifikaciya.pdf',
    sourcePage: 3,
  },
  {
    id: 'drawing.stamp',
    documentCode: 'ГОСТ Р 21.101-2020',
    clause: '5.2; Приложение Ж, форма 3',
    requirement:
      'Основную надпись (штамп) располагают в правом нижнем углу листа; на листах основных комплектов рабочих чертежей — по форме 3 (Приложение Ж). На листах формата А4 основную надпись располагают вдоль короткой стороны. Общие данные по рабочим чертежам (п. 4.3): ведомость рабочих чертежей, ведомость ссылочных и прилагаемых документов, условные обозначения, общие указания',
    valueText: 'форма 3, правый нижний угол',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/gost-r-21-101-2020-osnovnye-trebovaniya.pdf',
    sourcePage: 41,
    note: 'ГОСТ Р — российский стандарт, применяется как методический образец; приоритет у норм РК',
  },

  // ============================================================
  // Кодексы РК: водоохранные и санитарные требования, экология,
  // земельные права, ответственность (для пояснительной записки).
  // ============================================================
  {
    id: 'water.protectionZone',
    documentCode: 'Водный кодекс РК',
    clause: 'статьи 85, 86',
    requirement:
      'Для поверхностных водных объектов устанавливаются водоохранные зоны и полосы с особыми условиями пользования (ст. 85). В водоохранных зонах и полосах запрещаются сброс сточных вод, не очищенных до нормативов допустимых сбросов, и работы, связанные со строительной деятельностью, без согласования с бассейновой водной инспекцией (ст. 86)',
    valueText: 'водоохранные зоны и полосы',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/vodny-kodeks-rk-2025.pdf',
    sourcePage: 82,
  },
  {
    id: 'water.sanitaryZone',
    documentCode: 'Водный кодекс РК',
    clause: 'статьи 88, 91',
    requirement:
      'В целях охраны вод питьевого водоснабжения устанавливаются зоны санитарной охраны и санитарные защитные полосы (ст. 88). Запрещается ввод в эксплуатацию водозаборных и иных гидротехнических сооружений без установления зон санитарной охраны, предусмотренных проектной документацией (ст. 91)',
    valueText: 'зоны санитарной охраны',
    units: '—',
    appliesSystem: WATER,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/vodny-kodeks-rk-2025.pdf',
    sourcePage: 86,
  },
  {
    id: 'eco.wastewaterDischarge',
    documentCode: 'Экологический кодекс РК',
    clause: 'статья 222',
    requirement:
      'Сброс сточных вод в водные объекты допускается только при наличии экологического разрешения. Не допускается сброс сточных вод независимо от степени очистки в зонах санитарной охраны источников централизованного питьевого водоснабжения. В сбрасываемых сточных водах не должны содержаться вещества, агрессивно действующие на бетон и металл; температура не выше 30 °C',
    valueText: 'требования к сбросу сточных вод',
    units: '—',
    appliesSystem: SEWER_STORM,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/ekologichesky-kodeks-rk-2021.pdf',
    sourcePage: 219,
  },
  {
    id: 'land.servitude',
    documentCode: 'Земельный кодекс РК',
    clause: 'глава 7 (статья 67)',
    requirement:
      'Право ограниченного целевого пользования чужим земельным участком (сервитут) может устанавливаться, в том числе для прокладки и эксплуатации инженерных коммуникаций (линейных объектов) по чужим участкам',
    valueText: 'сервитут для линейных объектов',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/zemelny-kodeks-rk-2003.pdf',
    sourcePage: 137,
  },
  {
    id: 'construction.techSurvey',
    documentCode: 'Строительный кодекс РК',
    clause: 'статья 60',
    requirement:
      'Техническое обследование надежности и устойчивости зданий и сооружений выполняется для оценки их технического состояния (основание для решений при реконструкции и АТО)',
    valueText: 'техническое обследование',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: ['reconstruction'],
    status: 'verified',
    sourceFile: 'docs/norms/stroitelny-kodeks-rk-2026.pdf',
    sourcePage: 93,
  },
  {
    id: 'construction.responsibility',
    documentCode: 'Строительный кодекс РК',
    clause: 'статья 146',
    requirement:
      'Субъекты архитектурной, градостроительной и строительной деятельности несут ответственность за качество и соответствие проектных решений; проектная документация подлежит экспертизе в установленном порядке. Окончательные решения принимает проектировщик',
    valueText: 'ответственность проектировщика',
    units: '—',
    appliesSystem: ALL_SYSTEMS,
    appliesWork: BOTH_WORK,
    status: 'verified',
    sourceFile: 'docs/norms/stroitelny-kodeks-rk-2026.pdf',
    sourcePage: 176,
  },
]

const CLAUSE_BY_ID = new Map(NORM_REGISTRY.map((c) => [c.id, c]))

export function getClause(id: string): NormClause | undefined {
  return CLAUSE_BY_ID.get(id)
}

export function unverifiedClauses(): NormClause[] {
  return NORM_REGISTRY.filter((c) => c.status === 'unverified')
}
