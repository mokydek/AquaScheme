import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { docxText, documentXmlToText } from './docxText'

/** Собирает настоящий .docx-архив: тест не полагается на внешний файл. */
const buildDocx = (xml: string) => zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'word/document.xml': strToU8(xml),
})

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

describe('чтение .docx', () => {
  it('читает абзацы с кириллицей', () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>`
      + paragraph('Нормативная глубина промерзания по г. Алматы')
      + paragraph('Грунтовые воды в период изысканий не вскрыты.')
      + '</w:body></w:document>'
    expect(docxText(buildDocx(xml))).toBe(
      'Нормативная глубина промерзания по г. Алматы\nГрунтовые воды в период изысканий не вскрыты.',
    )
  })

  it('разделяет ячейки таблицы, а не склеивает строку', () => {
    // Без разделителя «ИГЭ - 1» и «суглинок твердый» слипаются в одно слово, и
    // прозовый разбор перестаёт различать графы.
    const xml = '<w:document><w:body><w:tbl><w:tr>'
      + `<w:tc>${paragraph('ИГЭ - 1')}</w:tc>`
      + `<w:tc>${paragraph('суглинок твердый')}</w:tc>`
      + '</w:tr></w:tbl></w:body></w:document>'
    expect(docxText(buildDocx(xml))).toBe('ИГЭ - 1\tсуглинок твердый')
  })

  it('сохраняет разрывы строк и табуляции внутри абзаца', () => {
    const xml = '<w:document><w:body><w:p><w:r>'
      + '<w:t>суглинки</w:t><w:tab/><w:t>0,79 м</w:t><w:br/><w:t>песок</w:t><w:tab/><w:t>1,03 м</w:t>'
      + '</w:r></w:p></w:body></w:document>'
    expect(docxText(buildDocx(xml))).toBe('суглинки\t0,79 м\nпесок\t1,03 м')
  })

  it('разворачивает сущности XML', () => {
    expect(documentXmlToText('<w:p><w:t>&quot;Архитектор&quot; &amp; Со</w:t></w:p>'))
      .toBe('"Архитектор" & Со')
  })

  it('файл без word/document.xml объявляется не .docx, а не читается пустым', () => {
    const archive = zipSync({ 'hello.txt': strToU8('hi') })
    expect(() => docxText(archive)).toThrow(/не \.docx/)
  })
})
