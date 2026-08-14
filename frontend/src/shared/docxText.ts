import { strFromU8, unzipSync } from 'fflate'

/**
 * Текст .docx без тяжёлых зависимостей.
 *
 * Формат — это zip, внутри которого `word/document.xml`: абзацы `w:p`, внутри
 * них прогоны `w:t`. Разбирать его целиком незачем — читателю отчёта нужен
 * связный текст, а не стили. Поэтому берётся распаковка (fflate в проекте уже
 * есть) и снятие разметки, а не ещё одна библиотека на мегабайты.
 *
 * Абзац закрывается переводом строки, ячейка таблицы — табуляцией: без этого
 * строка таблицы слипается в одно слово, и прозовый разбор отчёта перестаёт
 * различать «ИГЭ-1 суглинок» и соседнюю графу.
 *
 * Разрывы строк (`w:br`) и табуляции (`w:tab`) внутри абзаца сохраняются: в
 * отчётах ими разделены величины, и склейка меняла бы смысл.
 */
export function docxText(archive: Uint8Array): string {
  const files = unzipSync(archive)
  const document = files['word/document.xml']
  if (!document) {
    throw new Error('Это не .docx: внутри архива нет word/document.xml.')
  }
  return documentXmlToText(strFromU8(document))
}

/** Разбор `word/document.xml` в текст. Отделён, чтобы проверять без zip. */
export function documentXmlToText(xml: string): string {
  const withBreaks = xml
    // Перевод строки и табуляция — часть содержимого, а не оформления.
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    // Порядок значим. Абзац внутри ячейки заканчивается ДО конца ячейки, и
    // общее правило «конец абзаца — перевод строки» разрывало бы строку
    // таблицы на каждой графе. Поэтому сначала снимается конец абзаца,
    // сросшийся с концом ячейки, и только потом остальные.
    .replace(/(?:<\/w:p>\s*)?<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
  const text = withBreaks
    .replace(/<[^>]+>/g, '')
    // Сущности XML — только те, что встречаются в тексте документа.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, (run) => (run.includes('\t') ? '\t' : ' ')).trim())
    .filter((line) => line !== '')
    .join('\n')
}
