/**
 * Мастер комплекта: порядок прогона файлов объекта и состояние слотов.
 *
 * Здесь нет ни разбора, ни отрисовки — только состав комплекта, порядок и
 * правила перехода состояний. Так порядок можно проверить тестом, не поднимая
 * браузер, а сам разбор остаётся в штатных конвейерах: съёмка идёт тем же
 * путём, что и подоснова коллектора, ТУ — той же секцией извлечения.
 *
 * ПОРЯДОК ЗНАЧИМ. Съёмка идёт первой, потому что от неё зависит всё
 * пространственное; ТУ — после неё, потому что подтверждённый диаметр ложится
 * на уже разобранную сеть. Остальное принимается basis-файлами и разбирается
 * следующими этапами: молчаливого игнорирования нет, у каждого слота сказано,
 * на каком этапе его разберут.
 */

/** Что слот делает с файлом на этом этапе. */
export type KitSlotHandling =
  /** Файл проходит штатный конвейер и даёт счётчики. */
  | 'parsed'
  /** Файл сохраняется basis-файлом, разбор объявлен следующим этапом. */
  | 'basis'

export interface KitSlotDefinition {
  id: string
  /** Ожидаемое имя файла у владельца — подсказка, а не требование. */
  hint: string
  /** Расширения, которые слот принимает. */
  accept: string
  handling: KitSlotHandling
  /** Этап, на котором слот начнут разбирать; `null` — разбирается сейчас. */
  parsedAtStage: number | null
}

/**
 * Состав комплекта Станкевича в порядке прогона.
 *
 * Имена-подсказки — те, под которыми файлы лежат у владельца. Эталон РП
 * (`_РП Станкевича — (2).dwg`) в комплект НЕ входит: это мерило, а не исходное
 * данное, и попасть в расчёт он не должен.
 */
export const STANKEVICHA_KIT_SLOTS: readonly KitSlotDefinition[] = [
  { id: 'surveyStankevicha', hint: '_топо станкевича.dwg → .dxf', accept: '.dxf', handling: 'parsed', parsedAtStage: null },
  { id: 'surveyMoldagalieva', hint: 'Молдагалиева.dwg → .dxf', accept: '.dxf', handling: 'basis', parsedAtStage: 2 },
  { id: 'technicalConditions', hint: 'ТУ_05-3-2723 (1).pdf', accept: '.pdf', handling: 'parsed', parsedAtStage: null },
  { id: 'designBrief', hint: 'ТЗ_5669_Станкевича.pdf', accept: '.pdf', handling: 'basis', parsedAtStage: 4 },
  { id: 'surveyReport', hint: 'ТО_5669_Станкевича (2).pdf', accept: '.pdf', handling: 'basis', parsedAtStage: 3 },
  { id: 'geologyReport', hint: 'Геологический Отчет.docx', accept: '.docx', handling: 'basis', parsedAtStage: 3 },
  { id: 'geologyAppendices', hint: 'Приложения 3, 4, 5 (.xls)', accept: '.xls,.xlsx', handling: 'basis', parsedAtStage: 3 },
  { id: 'routeScheme', hint: 'Станкевича_ схема трассы.pdf', accept: '.pdf', handling: 'basis', parsedAtStage: 5 },
] as const

/** Состояние одного слота. Четыре вида, пятого нет. */
export type KitSlotState =
  | { kind: 'empty' }
  | { kind: 'parsed'; fileName: string; counters: Array<{ label: string; value: number }> }
  | { kind: 'stored'; fileName: string; parsedAtStage: number }
  | { kind: 'failed'; fileName: string; reason: string }

export type KitState = Record<string, KitSlotState>

/** Пустой комплект: каждый слот явно «не загружено», а не отсутствует. */
export function emptyKitState(slots: readonly KitSlotDefinition[] = STANKEVICHA_KIT_SLOTS): KitState {
  return Object.fromEntries(slots.map((slot) => [slot.id, { kind: 'empty' } as KitSlotState]))
}

/** Сколько слотов заполнено — для строки «готово N из M». */
export function kitProgress(state: KitState, slots: readonly KitSlotDefinition[] = STANKEVICHA_KIT_SLOTS): {
  filled: number; total: number; failed: number
} {
  const values = slots.map((slot) => state[slot.id] ?? { kind: 'empty' as const })
  return {
    filled: values.filter((value) => value.kind === 'parsed' || value.kind === 'stored').length,
    total: slots.length,
    failed: values.filter((value) => value.kind === 'failed').length,
  }
}

/**
 * Прогон комплекта в порядке `slots`.
 *
 * Слот, упавший с ошибкой, не роняет остальные: ошибка становится состоянием
 * этого слота и прогон продолжается. Иначе один неудачный файл прятал бы
 * результат по всем прочим, и владелец не узнал бы, что разобралось.
 */
export async function runKit(
  files: Record<string, File | undefined>,
  handlers: Record<string, (file: File) => Promise<KitSlotState>>,
  slots: readonly KitSlotDefinition[] = STANKEVICHA_KIT_SLOTS,
  onSlot?: (id: string, state: KitSlotState) => void,
): Promise<KitState> {
  const state = emptyKitState(slots)
  for (const slot of slots) {
    const file = files[slot.id]
    if (!file) continue
    const handler = handlers[slot.id]
    let next: KitSlotState
    if (!handler) {
      next = { kind: 'failed', fileName: file.name, reason: `Обработчик слота «${slot.id}» не подключён.` }
    } else {
      try {
        next = await handler(file)
      } catch (cause) {
        next = { kind: 'failed', fileName: file.name, reason: cause instanceof Error ? cause.message : String(cause) }
      }
    }
    state[slot.id] = next
    onSlot?.(slot.id, next)
  }
  return state
}
