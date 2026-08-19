/**
 * Объект «Станкевича»: реконструкция уличной канализации по ул. Станкевича от
 * ж/д №23 по ул. Молдагалиева до ул. Акынов, Турксибский район г. Алматы.
 *
 * Это настоящий объект, а не учебный. Величины получены из его комплекта —
 * топосъёмки, технических условий, технического обследования и геологического
 * отчёта. Демонстрация на нём показывает то, чего вымышленная сеть показать не
 * может: шлюз выпуска срабатывает на настоящих пробелах, а не на подстроенных,
 * и расхождение с документами видно как есть.
 *
 * Здесь лежат только производные величины. Сами DWG, PDF и отчёты остаются в
 * docs/benchmark/ под .gitignore: они тяжёлые и в истории не нужны.
 *
 * Камеры восстановлены из парных подписей отметок топосъёмки и перенесены с
 * позиции подписи на объект по выноскам. Порог глубины магистрали 2,5 м и
 * границы трассы — решения инженера, а не вывод из чертежа.
 */

export interface DemoChamber {
  label: string
  x: number
  y: number
  /** Отметка крышки, м. */
  rimElevationM: number
  /** Отметка лотка, м. */
  invertElevationM: number
  depthM: number
}

/** Технические условия 05-3-2723 от 18.10.2024, пункт 25. */
export const STANKEVICHA_CONDITIONS = {
  objectName: 'Реконструкция уличной канализационной сети по ул. Станкевича'
    + ' от ж/д №23 по ул. Молдагалиева до ул. Акынов, Турксибский район г. Алматы',
  customer: 'ТОО «Строительная группа Архитектор»',
  /** Обозначение и пункт документа: подтверждённую величину нечем подписать без них. */
  conditionsNumber: 'ТУ 05-3-2723 от 18.10.2024',
  conditionsClause: 'п. 25',
  designDiameterMm: 450,
  /** Строка документа, по которой прочитан диаметр. */
  designDiameterQuote: 'п. 25. Проложить сеть Д=450 мм',
  /**
   * Длина по техническому обследованию, м.
   *
   * ИМЕННО по обследованию. Прежний комментарий «по ТУ и техническому
   * обследованию» источники не различал, а в подтверждаемой модели ТУ
   * протяжённости нет вовсе — ни поля, ни шаблона извлечения. Пока её туда не
   * завели, называть величину подтверждённой двумя источниками нельзя.
   */
  declaredLengthM: 458.94,
  /** Колодцев по техническому обследованию. */
  declaredChambers: 14,
  /** Наименьший диаметр колодца на сетях водоотведения г. Алматы, мм. */
  minChamberDiameterMm: 1500,
  material: 'керамика',
  /** Глубина заложения по техническому обследованию, м. */
  declaredDepthRangeM: [3.7, 5.2],
  stage: 'РП',
} as const

/**
 * Геологический отчёт: 3 скважины по 6 м, грунтовые воды в период изысканий не
 * вскрыты, сейсмичность 9 баллов по MSK-64 (СП РК 2.03-30-2017*, подзона
 * III-А-1), грунты незасолённые и неагрессивные к бетону W4.
 */
export const STANKEVICHA_GEOLOGY = {
  boreholes: 3,
  boreholeDepthM: 6,
  groundwaterEncountered: false,
  seismicityPoints: 9,
  /**
   * Нормативная глубина сезонного промерзания — ТРИ КАНДИДАТА, а не величина.
   *
   * Отчёт по объекту (г. Алматы) даёт её по трём грунтам и не говорит, какой
   * лежит на отметке лотка. Выбрать грунт — решение инженера: между 0,79 и
   * 1,03 м разница в треть, а величина задаёт наименьшее заглубление.
   *
   * Здесь лежит цитата, а не вывод: подпись под выбранной величиной должна
   * ссылаться на строку отчёта, иначе подтверждать нечем.
   */
  freezingDepthCandidates: [
    { soil: 'суглинок, глина', valueM: 0.79 },
    { soil: 'песок пылеватый', valueM: 0.96 },
    { soil: 'песок средней крупности', valueM: 1.03 },
  ],
  freezingDepthQuote: 'Нормативная глубина сезонного промерзания для суглинков – 0,79м,'
    + ' для песка пылеватого – 0,96м, для песка средней крупности – 1,03м.',
  layers: [
    { code: 'ИГЭ-1', name: 'Суглинок твёрдый и полутвёрдый', unitWeightKnM3: 17.2, cohesionKpa: 20, frictionDeg: 21 },
    { code: 'ИГЭ-2', name: 'Песок средней крупности, маловлажный', unitWeightKnM3: 16.0, cohesionKpa: null, frictionDeg: 34 },
    { code: 'ИГЭ-3', name: 'Песок пылеватый, водонасыщенный', unitWeightKnM3: 16.0, cohesionKpa: 3, frictionDeg: 29 },
  ],
} as const

/** Порог, отделивший три врезки глубиной 1,70 / 1,75 / 2,06 м. */
export const STANKEVICHA_MIN_MAIN_DEPTH_M = 2.5

export const STANKEVICHA_CHAMBERS: DemoChamber[] = [
  { label: 'ВК-1', x: -3.08, y: 7859.94, rimElevationM: 688.22, invertElevationM: 684.78, depthM: 3.44 },
  { label: 'ВК-2', x: 30.32, y: 7899.75, rimElevationM: 688.07, invertElevationM: 683.6, depthM: 4.47 },
  { label: 'ВК-3', x: 51.96, y: 7966.06, rimElevationM: 687.34, invertElevationM: 684.37, depthM: 2.97 },
  { label: 'ВК-4', x: 66.19, y: 8005.25, rimElevationM: 687.16, invertElevationM: 683.12, depthM: 4.04 },
  { label: 'ВК-5', x: 21.16, y: 8014.14, rimElevationM: 687.33, invertElevationM: 682.83, depthM: 4.5 },
  { label: 'ВК-6', x: 0.25, y: 8033.34, rimElevationM: 687.04, invertElevationM: 683.2, depthM: 3.84 },
  { label: 'ВК-7', x: -12.91, y: 8030.79, rimElevationM: 686.95, invertElevationM: 683.35, depthM: 3.6 },
  { label: 'ВК-8', x: -42.11, y: 8049.36, rimElevationM: 686.31, invertElevationM: 682.35, depthM: 3.96 },
  { label: 'ВК-9', x: -88.12, y: 8065.71, rimElevationM: 685.86, invertElevationM: 682.06, depthM: 3.8 },
  { label: 'ВК-10', x: -101.75, y: 8071.98, rimElevationM: 685.7, invertElevationM: 682.01, depthM: 3.69 },
  { label: 'ВК-11', x: -126.24, y: 8082.45, rimElevationM: 685.35, invertElevationM: 681.85, depthM: 3.5 },
  { label: 'ВК-12', x: -155.85, y: 8094.09, rimElevationM: 685.23, invertElevationM: 681.61, depthM: 3.62 },
  { label: 'ВК-13', x: -201.83, y: 8096.24, rimElevationM: 685.11, invertElevationM: 681.47, depthM: 3.64 },
  { label: 'ВК-14', x: -224.15, y: 8115.31, rimElevationM: 685.21, invertElevationM: 682.3, depthM: 2.91 },
]

/** Длина ломаной по камерам, м. Считается, а не хранится: число должно
 * следовать из координат, иначе правка координат его молча рассогласует. */
export function stankevichaChainLengthM(chambers: DemoChamber[] = STANKEVICHA_CHAMBERS): number {
  let total = 0
  for (let i = 1; i < chambers.length; i++) {
    total += Math.hypot(chambers[i].x - chambers[i - 1].x, chambers[i].y - chambers[i - 1].y)
  }
  return Math.round(total * 100) / 100
}
