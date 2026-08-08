import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadError, convertDrawing, uploadErrorText } from './upload'

/**
 * Что видит инженер, когда конвертер DWG недоступен.
 *
 * Путь деградации был написан, но не проверен ничем: ни отсутствие
 * `VITE_CONVERTER_URL`, ни отказ сервиса. А это тот случай, когда молчание
 * дороже всего — DWG не сформирован, и если сказать об этом невнятно, инженер
 * решит, что выгрузка сорвалась целиком, хотя DXF у него на руках.
 *
 * `CONVERTER_URL` читается из окружения сборки на уровне модуля, поэтому в
 * тестовой среде он пуст: это ровно случай «конвертер не настроен».
 */

const t = ((key: string) => key) as unknown as Parameters<typeof uploadErrorText>[0]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('конвертер не настроен', () => {
  it('отказ приходит с кодом, а не общей ошибкой', async () => {
    await expect(convertDrawing('0\nSECTION\n0\nEOF\n', 'dwg')).rejects.toBeInstanceOf(UploadError)
    await expect(convertDrawing('0\nSECTION\n0\nEOF\n', 'dwg')).rejects.toMatchObject({
      code: 'converterNotConfigured',
    })
  })

  it('сообщение объясняет причину, а не показывает стек', () => {
    const message = uploadErrorText(t, new UploadError('converterNotConfigured', 'dxf'))
    expect(message).toBe('upload.converterNeeded')
  })

  it('сообщение об отказе сервиса отличается от сообщения о ненастроенности', () => {
    const notConfigured = uploadErrorText(t, new UploadError('converterNotConfigured', 'dxf'))
    const failed = uploadErrorText(t, new UploadError('converterFailed', 'dxf'))
    expect(failed).toBe('upload.converterFailed')
    expect(failed).not.toBe(notConfigured)
  })

  it('чужая ошибка не выдаётся за ошибку конвертера', () => {
    expect(uploadErrorText(t, new Error('сеть отвалилась'))).toBeNull()
  })
})

describe('словарь покрывает оба исхода', () => {
  it('и «не настроен», и «недоступен» имеют текст на всех заявленных языках', async () => {
    const { ru } = await import('../i18n/locales/ru')
    const { en } = await import('../i18n/locales/en')
    for (const dictionary of [ru, en]) {
      const upload = dictionary.translation.upload as Record<string, unknown>
      expect(typeof upload.converterNeeded).toBe('string')
      expect(typeof upload.converterFailed).toBe('string')
      expect((upload.converterNeeded as string).length).toBeGreaterThan(10)
      expect((upload.converterFailed as string).length).toBeGreaterThan(10)
    }
  })

  it('сообщение о деградации выгрузки называет, что DXF всё равно получен', async () => {
    const { ru } = await import('../i18n/locales/ru')
    const notice = (ru.translation.project as unknown as Record<string, Record<string, string>>)
      .export.converterError
    expect(notice).toContain('DXF')
  })
})
