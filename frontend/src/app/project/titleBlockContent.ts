import type { TitleBlockSignatory } from '../../shared/titleBlock'

/**
 * Сборка граф 9–13 основной надписи из полей карточки.
 *
 * Отделено от отрисовки ради проверки главного правила: ничего не
 * подставляется. Роль без фамилии и без даты в штамп не идёт — пустая строка
 * графы 11 печатается самой формой, а запись о роли без человека создавала бы
 * впечатление назначенного ответственного.
 */

export interface TitleBlockContent {
  /** Графа 9. */
  organisation?: string
  /** Графы 10–13. */
  signatories?: TitleBlockSignatory[]
}

export function titleBlockContentFrom(
  organisation: string,
  roles: readonly string[],
  names: Record<string, string>,
  dates: Record<string, string>,
): TitleBlockContent {
  const signatories: TitleBlockSignatory[] = roles.flatMap((role) => {
    const name = (names[role] ?? '').trim()
    const date = (dates[role] ?? '').trim()
    if (name === '' && date === '') return []
    return [{ role, ...(name ? { name } : {}), ...(date ? { date } : {}) }]
  })
  const trimmed = organisation.trim()
  return {
    ...(trimmed ? { organisation: trimmed } : {}),
    ...(signatories.length > 0 ? { signatories } : {}),
  }
}
