import { selectPumps } from '@aquascheme/engine'
import type { PressureMainResult, PumpSelection } from '@aquascheme/engine'
import type { PumpCatalogContent } from './PumpCatalogSection'

/**
 * Подбор насосов ЛНС по расчёту напорного участка и каталогу проекта.
 *
 * Отделено от отрисовки, чтобы проверить главное: чего именно не хватает.
 * Ни одно из недостающих значений не подставляется по умолчанию. Категория
 * надёжности определяет число резервных агрегатов по таблице 8.2, каталог —
 * марку в спецификации, требуемый напор — саму возможность подбора; принятое
 * за инженера значение попало бы в проектную документацию как подтверждённое.
 */
export type PumpSelectionOutcome =
  | { ok: true; selection: PumpSelection }
  | { ok: false; missing: string[] }

export function pumpSelectionFor(
  pressure: PressureMainResult,
  designFlowLps: number,
  catalog: PumpCatalogContent,
): PumpSelectionOutcome {
  const entries = catalog.entries ?? []
  const requiredHeadM = pressure.requiredPumpHeadM
  const missing: string[] = []
  if (requiredHeadM == null) missing.push('расчёт напорного участка не завершён')
  if (entries.length === 0) missing.push('каталог насосов не загружен')
  if (!catalog.category) missing.push('не выбрана категория надёжности ЛНС')
  if (!catalog.effluent) missing.push('не выбран характер сточных вод')
  if (missing.length > 0 || requiredHeadM == null) return { ok: false, missing }

  return {
    ok: true,
    selection: selectPumps({
      designFlowLps,
      // Требуемый напор берётся из расчёта, а не из геометрического подъёма:
      // подъём — только его слагаемое, и подстановка занизила бы агрегат.
      requiredHeadM,
      category: catalog.category!,
      effluent: catalog.effluent!,
      catalogue: entries,
      workingCount: catalog.workingCount,
      stormOverflowImpossible: catalog.stormOverflowImpossible,
    }),
  }
}
