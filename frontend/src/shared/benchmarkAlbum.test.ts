import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Ослабленный режим сборки существует ради измерения — и не должен утечь на
 * экраны. Проверка следит за этим по коду, а не по договорённости.
 */

const APP = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'app')

function everyFile(directory: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) out.push(...everyFile(path))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

describe('режим сборки для измерения из интерфейса недостижим', () => {
  const files = everyFile(APP)

  it('экраны приложения вообще есть — иначе проверка была бы пустой', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('ни один экран не импортирует модуль бенчмарк-сборки', () => {
    const guilty = files.filter((path) => /benchmarkAlbum/.test(readFileSync(path, 'utf8')))
    expect(guilty).toEqual([])
  })

  it('ни один экран не зовёт сборку в режиме benchmark напрямую', () => {
    // `buildAlbumDocument` экспортирована, и обойти модуль-обёртку технически
    // можно. Проверка закрывает и этот путь.
    const guilty = files.filter((path) => {
      const text = readFileSync(path, 'utf8')
      return /buildAlbumDocument/.test(text) || /'benchmark'/.test(text)
    })
    expect(guilty).toEqual([])
  })
})

describe('экранный шлюз выпуска не ослаблен', () => {
  it('выпуск по-прежнему запрещён, пока не все листы подтверждены', async () => {
    const { buildProjectAlbumDoc } = await import('./projectAlbum')
    const input = {
      projectName: 'Проверка', projectCode: '00-00',
      drawingSet: { summary: { finalExportAllowed: false, blocked: 3, stale: 1 }, sheets: [], manifest: { pages: [], pdfPageCount: 0 } },
    } as unknown as Parameters<typeof buildProjectAlbumDoc>[0]
    expect(() => buildProjectAlbumDoc(input)).toThrow(/Финальный выпуск запрещён/)
  })

  it('режим измерения тот же шлюз не проверяет — в этом и смысл', async () => {
    const { buildAlbumDocument } = await import('./projectAlbum')
    const input = {
      drawingSet: { summary: { finalExportAllowed: false, blocked: 3, stale: 1 }, sheets: [], manifest: { pages: [], pdfPageCount: 0 } },
    } as unknown as Parameters<typeof buildAlbumDocument>[0]
    // Падает он дальше, на проверке манифеста, — но НЕ на шлюзе выпуска.
    expect(() => buildAlbumDocument(input, 'benchmark')).not.toThrow(/Финальный выпуск запрещён/)
  })
})

describe('листы ниже расчётного состояния называются поимённо', () => {
  it('перечисляются с обозначением и статусом', async () => {
    const { belowCalculated } = await import('./benchmarkAlbum')
    const input = {
      drawingSet: {
        sheets: [
          { documentSet: 'working_drawings', sheetNumber: 1, status: 'VERIFIED' },
          { documentSet: 'working_drawings', sheetNumber: 2, status: 'BLOCKED' },
          { documentSet: 'specification', sheetNumber: 1, status: 'CALCULATED' },
          { documentSet: 'working_drawings', sheetNumber: 3, status: 'STALE' },
        ],
      },
    } as unknown as Parameters<typeof belowCalculated>[0]
    expect(belowCalculated(input)).toEqual(['MAIN/2:BLOCKED', 'MAIN/3:STALE'])
  })
})
