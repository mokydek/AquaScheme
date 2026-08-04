import type { SizingResult } from './sizing'

/**
 * Требуемый напор на источнике В1.
 *
 * Подбор диаметров считается при заданном напоре источника и отвечает «сошлось»
 * или «не сошлось». Сколько напора на самом деле нужно, он не сообщал никогда —
 * а без этого нельзя ни подобрать насос водозабора, ни назначить высоту
 * водонапорной башни, ни понять, насколько велик запас.
 *
 * Расчёт точен, а не приближён. Расходы задаются потребителями и от напора не
 * зависят, поэтому подъём пьезометрического уровня источника на Δ поднимает
 * напор в каждом узле ровно на Δ: потери по длине те же. Значит недостающий
 * напор — это наибольший дефицит по узлам, а запас — наименьший избыток.
 */

export interface SourceHeadAssessment {
  /** Пьезометрический уровень источника в расчёте, м. */
  sourceHeadM: number
  /** Наибольший дефицит по узлам, м; 0 — дефицита нет. */
  deficitM: number
  /** Требуемый уровень источника, м: расчётный плюс дефицит. */
  requiredSourceHeadM: number
  /** Наименьший запас свободного напора по узлам, м; отрицателен при дефиците. */
  reserveM: number
  /** Узел, определивший требование. */
  governingNodeId: string | null
  reason: string
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function assessSourceHead(result: SizingResult): SourceHeadAssessment {
  // Узлы без заданного требования к свободному напору не участвуют: транзитный
  // узел ничего не требует, и включать его значило бы занизить требование.
  const demanding = (result.nodes ?? []).filter((node) =>
    node.requiredPressureM != null
    && Number.isFinite(node.requiredPressureM)
    && Number.isFinite(node.pressureM))

  if (demanding.length === 0) {
    return {
      sourceHeadM: round2(result.sourceHeadM),
      deficitM: 0,
      requiredSourceHeadM: round2(result.sourceHeadM),
      reserveM: 0,
      governingNodeId: null,
      reason: 'Ни один узел не предъявляет требования к свободному напору: требуемый напор не определяется.',
    }
  }

  let worst = demanding[0]
  let worstMargin = demanding[0].pressureM - (demanding[0].requiredPressureM as number)
  for (const node of demanding) {
    const margin = node.pressureM - (node.requiredPressureM as number)
    if (margin < worstMargin) {
      worstMargin = margin
      worst = node
    }
  }

  const deficitM = Math.max(0, -worstMargin)
  return {
    sourceHeadM: round2(result.sourceHeadM),
    deficitM: round2(deficitM),
    requiredSourceHeadM: round2(result.sourceHeadM + deficitM),
    reserveM: round2(worstMargin),
    governingNodeId: worst.id,
    reason: deficitM > 0
      ? `Напора не хватает: ${round2(deficitM)} м. Определяющий узел ${worst.id} — свободный напор `
        + `${round2(worst.pressureM)} м при требуемых ${round2(worst.requiredPressureM as number)} м. `
        + `Требуемый уровень источника ${round2(result.sourceHeadM + deficitM)} м.`
      : `Напора достаточно: наименьший запас ${round2(worstMargin)} м в узле ${worst.id}. `
        + `Требуемый уровень источника ${round2(result.sourceHeadM)} м — расчётный уже покрывает требование.`,
  }
}
