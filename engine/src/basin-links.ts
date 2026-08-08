import { solvePressureMain } from './pressure'
import { selectPumps, type PumpCatalogueItem, type PumpSelection } from './norms/pumps'
import type { GravityLift } from './norms/gravity'

/**
 * Напорные перемычки между самотёчными бассейнами.
 *
 * Разбивка ставит перекачки, но сами напорные участки не считались — так и
 * было написано в докладе о возможностях: «Гидравлика напорных участков здесь
 * не считается». Между тем без них у перекачки нет ни требуемого напора, ни
 * агрегата, ни строки в спецификации: в проекте появлялась насосная станция,
 * о которой не сказано ничего.
 *
 * ЧТО ВЫВОДИТСЯ. Геометрический подъём — из самой разбивки: `liftHeightM`
 * есть насколько лоток поднимается до минимального заглубления в начале
 * следующего бассейна. Это измеренная величина профиля, а не допущение.
 *
 * ЧТО НЕ ВЫВОДИТСЯ И СПРАШИВАЕТСЯ. Длина напорного участка и его диаметр: от
 * места насосной станции зависит первое, от расчёта — второе, и ни то ни
 * другое из профиля не следует. Категория надёжности и характер стоков —
 * требования норм и задания. Каталог насосов — проектное решение.
 *
 * Без них расчёт честно останавливается и называет недостающее поимённо, а не
 * подставляет «типовые» 100 метров и Ø150.
 */

export interface BasinPressureLinkInput {
  /** Перекачки из подтверждённой разбивки. */
  lifts: GravityLift[]
  /** Расчётный приток на перекачку, л/с. */
  designFlowLps?: number | null
  /** Длина напорного участка, м: от места насосной станции. */
  pressureLengthM?: number | null
  /** Диаметр напорного участка, мм. */
  pressureDiameterMm?: number | null
  /** Число параллельных ниток. */
  parallelCount?: number
  catalogue?: PumpCatalogueItem[]
  category?: Parameters<typeof selectPumps>[0]['category']
  effluent?: Parameters<typeof selectPumps>[0]['effluent']
  roughnessMm?: number
}

export interface BasinPressureLink {
  liftNodeId: string
  chainageM: number
  /** Геометрический подъём, м — из разбивки, не из допущения. */
  geometricLiftM: number
  /** Потери по длине и местные, м. `null` — не посчитаны. */
  headlossM: number | null
  /** Требуемый напор, м: подъём плюс потери. `null` — не посчитан. */
  requiredHeadM: number | null
  pumps: PumpSelection | null
  blockers: string[]
}

export interface BasinPressureLinkPlan {
  links: BasinPressureLink[]
  /** Чего не хватает для расчёта — одним списком, без повторов. */
  missing: string[]
  reason: string
}

/** Считает напорную перемычку для каждой перекачки подтверждённой разбивки. */
export function planBasinPressureLinks(input: BasinPressureLinkInput): BasinPressureLinkPlan {
  const missing: string[] = []
  const flowLps = input.designFlowLps ?? 0
  const lengthM = input.pressureLengthM ?? 0
  const diameterMm = input.pressureDiameterMm ?? 0
  const catalogue = input.catalogue ?? []

  if (!(flowLps > 0)) missing.push('расчётный приток на перекачку, л/с')
  if (!(lengthM > 0)) missing.push('длина напорного участка, м (зависит от места насосной станции)')
  if (!(diameterMm > 0)) missing.push('диаметр напорного участка, мм')
  if (catalogue.length === 0) missing.push('каталог насосов проекта')
  if (!input.category) missing.push('категория надёжности насосной станции')
  if (!input.effluent) missing.push('характер перекачиваемых стоков')

  const computable = flowLps > 0 && lengthM > 0 && diameterMm > 0

  const links = input.lifts.map((lift): BasinPressureLink => {
    // Подъём известен всегда: он посчитан разбивкой по отметкам профиля.
    const geometricLiftM = lift.liftHeightM
    if (!computable) {
      return {
        liftNodeId: lift.nodeId,
        chainageM: lift.chainageM,
        geometricLiftM,
        headlossM: null,
        requiredHeadM: null,
        pumps: null,
        blockers: [`Напорный участок не посчитан: не задано — ${missing.join('; ')}.`],
      }
    }

    const solved = solvePressureMain({
      pipes: [{
        id: `НП-${lift.nodeId}`,
        lengthM,
        diameterMm,
        flowLps,
        parallelCount: input.parallelCount ?? 1,
        roughnessMm: input.roughnessMm ?? 0.3,
      }],
      // Отсчёт от нуля: важна разность, а она и есть геометрический подъём.
      inletElevationM: 0,
      outletElevationM: geometricLiftM,
    })
    // `frictionHeadM` — потери по длине и местные; `requiredPumpHeadM` уже
    // включает статический напор, но считается только когда решатель не
    // заблокирован, поэтому напор складывается здесь явно.
    const headlossM = solved.frictionHeadM
    const requiredHeadM = geometricLiftM + headlossM

    const pumps = catalogue.length > 0 && input.category && input.effluent
      ? selectPumps({
        designFlowLps: flowLps,
        requiredHeadM,
        catalogue,
        category: input.category,
        effluent: input.effluent,
      })
      : null

    return {
      liftNodeId: lift.nodeId,
      chainageM: lift.chainageM,
      geometricLiftM,
      headlossM,
      requiredHeadM,
      pumps,
      blockers: [
        ...solved.blockers,
        ...(pumps?.blockers ?? []),
        ...(pumps === null && catalogue.length === 0
          ? ['Агрегат не подобран: каталог насосов проекта не загружен.']
          : []),
      ],
    }
  })

  return {
    links,
    missing,
    reason: input.lifts.length === 0
      ? 'Перекачек в подтверждённой разбивке нет: напорных перемычек не требуется.'
      : missing.length > 0
        ? `Перемычек ${input.lifts.length}; расчёт не выполнен, не задано: ${missing.join('; ')}.`
        : `Перемычек ${input.lifts.length}; требуемый напор посчитан по подъёму из разбивки `
          + 'и потерям по Дарси-Вейсбаху.',
  }
}
