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

describe('распознавание скана', () => {
  // Без языковых данных — явный пропуск: `skipIf` печатает строку в отчёте,
  // и отсутствие проверки видно, а не растворяется в общем «ok».
  it.skipIf(!hasLanguageData)(
    'синтетический скан «Д=450 мм» распознаётся (нужен frontend/public/tessdata/rus.traineddata.gz)',
    async () => {
      const { createCanvas } = await import('@napi-rs/canvas')
      const canvas = createCanvas(900, 200)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, 900, 200)
      context.fillStyle = '#000'
      context.font = '64px sans-serif'
      context.fillText('Д=450 мм', 40, 120)

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
        const { data } = await worker.recognize(canvas.toBuffer('image/png'))
        // Число из документа доходит до разбора — это и требуется.
        expect(data.text.replace(/\s+/g, '')).toContain('450')

        // А вот буквы вокруг него — нет. На этом самом холсте распознаётся
        // «0=450 00» при уверенности 79: «Д» читается как «0», «мм» как «00».
        // Проверка закрепляет это как измеренный факт, а не прячет: ровно
        // поэтому ни одна распознанная величина не идёт в расчёт без
        // подтверждения инженером, и ровно поэтому уверенность строки
        // показывается рядом с находкой.
        expect(data.confidence).toBeLessThan(95)
      } finally {
        await worker.terminate()
      }
    },
    120_000,
  )

  it.skipIf(hasLanguageData)('без языковых данных проверка честно сообщает, что не выполнялась', () => {
    expect(hasLanguageData).toBe(false)
  })
})

describe('уверенность строки доходит до находки', () => {
  const pages: OcrPage[] = [{
    page: 1,
    text: 'п. 25. Проложить коллектор Д=450 мм.',
    lines: [
      { text: 'п. 25. Проложить коллектор Д=450 мм.', confidence: 62 },
      { text: 'Прочая строка документа', confidence: 96 },
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
