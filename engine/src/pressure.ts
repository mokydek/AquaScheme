/** Pure pressure-main hydraulics. Kept separate from gravity/free-surface flow. */

export interface PressurePipeInput {
  id: string
  lengthM: number
  diameterMm: number
  flowLps: number
  /** Number of identical parallel barrels sharing the total flow. */
  parallelCount?: number
  /**
   * Эквивалентная шероховатость трубы, мм.
   *
   * Отсутствие — это ОТСУТСТВИЕ, а не повод взять типовое значение: величина
   * уходит в коэффициент трения, оттуда в потери напора, в требуемый напор
   * насоса и в подбор оборудования. Участок без неё не считается и называется
   * в стоп-факторах.
   */
  roughnessMm?: number
}
export interface PressurePipeResult extends PressurePipeInput {
  velocityMs: number
  reynolds: number
  frictionFactor: number
  headlossM: number
}

export interface PressureMainResult {
  kind: 'pressure'
  status: 'calculated' | 'blocked'
  pipes: PressurePipeResult[]
  staticHeadM: number
  frictionHeadM: number
  requiredPumpHeadM: number | null
  availablePumpHeadM: number | null
  reserveHeadM: number | null
  blockers: string[]
}

const round = (value: number, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Darcy-Weisbach with Swamee-Jain friction factor, water at ~20 °C. */
export function solvePressureMain(input: {
  pipes: PressurePipeInput[]
  inletElevationM: number
  outletElevationM: number
  availablePumpHeadM?: number | null
  localLossCoefficient?: number
}): PressureMainResult {
  const blockers: string[] = []
  const pipes = input.pipes.map((pipe): PressurePipeResult => {
    const barrels = Math.max(1, Math.floor(pipe.parallelCount ?? 1))
    const diameterM = pipe.diameterMm / 1000
    const flowM3s = pipe.flowLps / 1000 / barrels
    const areaM2 = Math.PI * diameterM ** 2 / 4
    const velocityMs = areaM2 > 0 ? flowM3s / areaM2 : 0
    const reynolds = velocityMs * diameterM / 1.004e-6
    // Здесь стояло `?? 0.3`: участку без шероховатости молча доставалась чужая.
    // Ошибиться в ней вдвое — ошибиться в потерях напора вдвое, и заметить это
    // на экране было нечем. Потери по такому участку теперь не считаются.
    const relativeRoughness = (pipe.roughnessMm ?? 0) / 1000 / Math.max(diameterM, 1e-9)
    const frictionFactor = reynolds > 0
      ? 0.25 / Math.log10(relativeRoughness / 3.7 + 5.74 / Math.max(reynolds, 1) ** 0.9) ** 2
      : 0
    const headlossM = frictionFactor * pipe.lengthM / Math.max(diameterM, 1e-9) * velocityMs ** 2 / (2 * 9.80665)
    return {
      ...pipe,
      parallelCount: barrels,
      velocityMs: round(velocityMs),
      reynolds: round(reynolds, 0),
      frictionFactor: round(frictionFactor, 5),
      headlossM: round(headlossM),
    }
  })

  if (pipes.length === 0) blockers.push('Нет участков напорного трубопровода.')
  for (const pipe of pipes) {
    if (!(pipe.diameterMm > 0)) blockers.push(`Для участка ${pipe.id} не задан внутренний диаметр.`)
    if (!(pipe.flowLps >= 0)) blockers.push(`Для участка ${pipe.id} не задан расчётный расход.`)
    if (!(typeof pipe.roughnessMm === 'number' && pipe.roughnessMm > 0)) {
      blockers.push(`Для участка ${pipe.id} не задана шероховатость трубы: `
        + 'величину принимает инженер по материалу — раздел «Каталог труб и материалов».')
    }
  }
  const staticHeadM = Math.max(0, input.outletElevationM - input.inletElevationM)
  const frictionHeadM = pipes.reduce((sum, pipe) => sum + pipe.headlossM, 0)
  const last = pipes[pipes.length - 1]
  const velocityHeadM = last ? last.velocityMs ** 2 / (2 * 9.80665) : 0
  /**
   * Местные потери — доля скоростного напора, и её принимает инженер.
   *
   * ЭТО ИНЖЕНЕРНЫЙ FALLBACK, И ОН ЗДЕСЬ ОСТАЁТСЯ ОСОЗНАННО. Полтора скоростных
   * напора появляются сами и уходят в требуемый напор насоса; величина зависит
   * от арматуры и поворотов участка, вывести её из чертежа нечем.
   *
   * Заменить её стоп-фактором прямо сейчас нельзя: поля для ввода нет ни на
   * одном экране, и стоп получился бы без пути — ровно то, что запрещает
   * правило достижимости. Замена идёт вместе с полем; до тех пор подстановка
   * учтена аудитом `npm run audit:fallbacks` и записана в FALLBACKS.md как
   * незакрытая.
   */
  const localHeadM = (input.localLossCoefficient ?? 1.5) * velocityHeadM
  const requiredPumpHeadM = blockers.length === 0 ? round(staticHeadM + frictionHeadM + localHeadM) : null
  const availablePumpHeadM = input.availablePumpHeadM ?? null
  if (availablePumpHeadM == null) blockers.push('Не заданы характеристика насоса и доступный напор ЛНС.')

  return {
    kind: 'pressure',
    status: blockers.length === 0 ? 'calculated' : 'blocked',
    pipes,
    staticHeadM: round(staticHeadM),
    frictionHeadM: round(frictionHeadM),
    requiredPumpHeadM,
    availablePumpHeadM,
    reserveHeadM: requiredPumpHeadM == null || availablePumpHeadM == null
      ? null
      : round(availablePumpHeadM - requiredPumpHeadM),
    blockers,
  }
}
