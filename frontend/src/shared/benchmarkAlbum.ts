/**
 * Сборка альбома для измерения сходства с эталоном.
 *
 * Отдельный модуль — не для красоты. Экранный шлюз выпуска ослаблять нельзя, а
 * измерять прогресс, пока альбом не собирается, невозможно: показателя не
 * существует, и инструмент подтверждает финиш вместо того, чтобы мерить путь.
 * Разделение проведено так, чтобы ослабленный режим физически не встречался в
 * коде экранов: `frontend/src/app/**` этот модуль не импортирует, и проверка
 * `benchmarkAlbum.test.ts` за этим следит.
 *
 * Водяного знака здесь НЕТ намеренно: он отравил бы попиксельное сравнение,
 * ради которого файл и собирается. Отличимость даёт другое — тема документа
 * («НЕ ВЫПУСК») и статус каждого листа в метаданных PDF.
 *
 * Результат кладётся только в `docs/benchmark/out/` — папка вне git.
 */

import { buildAlbumDocument } from './projectAlbum'
import type { ProjectAlbumInput } from './projectAlbum'

export function buildBenchmarkAlbumDoc(input: ProjectAlbumInput): Record<string, unknown> {
  return buildAlbumDocument(input, 'benchmark')
}

/**
 * Сколько листов не дотягивают до расчётного состояния.
 *
 * Число идёт в отчёт измерения: сходство, посчитанное по альбому с
 * заблокированными листами, — это сходство черновика, и знать это обязательно.
 */
export function belowCalculated(input: ProjectAlbumInput): string[] {
  const ready = new Set(['CALCULATED', 'VERIFIED'])
  return input.drawingSet.sheets
    .filter((sheet) => !ready.has(sheet.status))
    .map((sheet) => `${sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}/${sheet.sheetNumber}:${sheet.status}`)
}
