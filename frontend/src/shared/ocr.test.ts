import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { confidenceOfQuote, LOW_CONFIDENCE } from './ocr'
import type { OcrPage } from './ocr'

/**
 * Распознавание синтетического «скана».
 *
 * Настоящий скан ТУ в репозиторий не кладётся, поэтому «скан» рисуется здесь:
 * текст на белом холсте — ровно то, чем является страница отсканированного
 * документа для распознавателя.
 *
 * Без языковых данных проверка ЯВНО пропускается с причиной. Зелёный прогон,
 * в котором ничего не распознавалось, хуже красного — то же правило, что у
 * round-trip проверки конвертера.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const TRAINEDDATA = join(ROOT, 'frontend', 'public', 'tessdata', 'rus.traineddata.gz')
const hasLanguageData = existsSync(TRAINEDDATA)

/**
 * Шрифт для «скана» выбирается из установленных в системе.
 *
 * Кириллицу рисует не всякое начертание: с `sans-serif` подставлялся шрифт без
 * неё, холст выводил квадратики вместо букв, распознаватель честно читал их как
 * «0» — и «Д=450 мм» превращалось в «0=450 00». Это дефект оснастки, а не
 * поведение OCR; прежняя проверка выдавала его за измеренное свойство
 * распознавания, и вывод из неё был неверен.
 *
 * Список покрывает и Linux (DejaVu/Liberation/Noto), и Windows (Arial, Segoe
 * UI). Если ни одного нет — проверка ЯВНО пропускается с причиной.
 */
const CYRILLIC_FONTS = [
  'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial', 'Segoe UI', 'Tahoma', 'Verdana',
]
const { GlobalFonts } = await import('@napi-rs/canvas')
const installed = new Set(GlobalFonts.families.map((family) => family.family))
const CYRILLIC_FONT = CYRILLIC_FONTS.find((family) => installed.has(family)) ?? null
const canDrawCyrillic = CYRILLIC_FONT !== null

describe('распознавание скана', () => {
  // Без языковых данных — явный пропуск: `skipIf` печатает строку в отчёте,
  // и отсутствие проверки видно, а не растворяется в общем «ok».
  it.skipIf(!hasLanguageData || !canDrawCyrillic)(
    'синтетический скан читается дословно (нужен frontend/public/tessdata/rus.traineddata.gz)',
    async () => {
      const { createCanvas } = await import('@napi-rs/canvas')
      const canvas = createCanvas(700, 160)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, 700, 160)
      context.fillStyle = '#000'
      context.font = `48px "${CYRILLIC_FONT}"`
      context.fillText('Скважина Д=450 мм', 20, 95)

      const { createWorker } = await import('tesseract.js')
      // `cachePath` задан явно: без него tesseract.js распаковывает словарь в
      // ТЕКУЩУЮ папку процесса, и 5 МБ уже однажды ушли в коммит из корня
      // репозитория. Папка под node_modules игнорируется целиком.
      const worker = await createWorker('rus', 1, {
        langPath: join(ROOT, 'frontend', 'public', 'tessdata'),
        cachePath: join(ROOT, 'node_modules', '.cache', 'tessdata'),
        gzip: true,
      })
      try {
        const { data } = await worker.recognize(
          canvas.toBuffer('image/png'), {}, { text: true, blocks: true },
        )
        expect(data.text).toContain('Д=450')

        // Третий аргумент `recognize` — не украшение: без него `blocks` пуст,
        // и построчная уверенность, на которой держится предупреждение о
        // сомнительной строке, не приходит вовсе. Проверка держит это.
        const lines = (data.blocks ?? [])
          .flatMap((block) => block.paragraphs ?? [])
          .flatMap((paragraph) => paragraph.lines ?? [])
        expect(lines.length).toBeGreaterThan(0)
        expect(lines[0].words.length).toBeGreaterThan(1)
        expect(lines[0].words[0].bbox.x1).toBeGreaterThan(lines[0].words[0].bbox.x0)
      } finally {
        await worker.terminate()
      }
    },
    120_000,
  )

  it.skipIf(hasLanguageData && canDrawCyrillic)('пропуск объявляется причиной, а не тишиной', () => {
    expect(hasLanguageData && canDrawCyrillic).toBe(false)
  })
})

describe('таблица скважин со скана', () => {
  it.skipIf(!hasLanguageData || !canDrawCyrillic)(
    'нарисованный на холсте буровой журнал доходит до экрана сопоставления колонок',
    async () => {
      const { createCanvas } = await import('@napi-rs/canvas')
      const width = 1400
      const height = 560
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      context.fillStyle = '#000'
      context.font = `34px "${CYRILLIC_FONT}"`
      const rows = [
        ['Скважина', 'Кровля', 'Подошва', 'ИГЭ', 'Грунт'],
        ['С-1', '0.0', '1.2', '1', 'Суглинок'],
        ['С-1', '1.2', '3.4', '2', 'Песок'],
        ['С-2', '0.0', '2.0', '1', 'Суглинок'],
        ['С-2', '2.0', '5.6', '3', 'Глина'],
      ]
      const columns = [60, 420, 700, 1000, 1130]
      rows.forEach((row, line) => row.forEach((cell, column) => {
        context.fillText(cell, columns[column], 80 + line * 90)
      }))

      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('rus', 1, {
        langPath: join(ROOT, 'frontend', 'public', 'tessdata'),
        cachePath: join(ROOT, 'node_modules', '.cache', 'tessdata'),
        gzip: true,
      })
      let recognized
      try {
        recognized = await worker.recognize(canvas.toBuffer('image/png'), {}, { text: true, blocks: true })
      } finally {
        await worker.terminate()
      }

      const lines = (recognized.data.blocks ?? [])
        .flatMap((block) => block.paragraphs ?? [])
        .flatMap((paragraph) => paragraph.lines ?? [])
        .map((line) => ({
          words: (line.words ?? [])
            .filter((word) => word.text.trim() !== '')
            .map((word) => ({ text: word.text.trim(), x0: word.bbox.x0, x1: word.bbox.x1 })),
        }))

      const { recoverTableFromScan, guessGeologyField } = await import('@aquascheme/engine')
      const table = recoverTableFromScan([{ page: 1, lines }])
      expect(table.refusal).toBeNull()
      expect(table.columnCount).toBe(5)
      expect(table.rows).toHaveLength(5)

      // Условие входа на экран сопоставления — то же, что у цифрового PDF:
      // заголовок должен опознаться хотя бы по двум полям модели.
      const known = table.rows[0].filter((cell) => guessGeologyField(cell) !== null).length
      expect(known).toBeGreaterThanOrEqual(2)
    },
    180_000,
  )
})

describe('уверенность строки доходит до находки', () => {
  const pages: OcrPage[] = [{
    page: 1,
    text: 'п. 25. Проложить коллектор Д=450 мм.',
    lines: [
      { text: 'п. 25. Проложить коллектор Д=450 мм.', confidence: 62, words: [] },
      { text: 'Прочая строка документа', confidence: 96, words: [] },
    ],
    confidence: 79,
  }]

  it('находится уверенность именно той строки, из которой взята цитата', () => {
    expect(confidenceOfQuote(pages, 1, 'п. 25. Проложить коллектор Д=450 мм.')).toBe(62)
  })

  it('низкая уверенность распознаётся как сомнительная', () => {
    const value = confidenceOfQuote(pages, 1, 'п. 25. Проложить коллектор Д=450 мм.')
    expect(value! < LOW_CONFIDENCE).toBe(true)
  })

  it('чужая страница уверенности не даёт', () => {
    expect(confidenceOfQuote(pages, 7, 'что угодно')).toBeNull()
  })
})
