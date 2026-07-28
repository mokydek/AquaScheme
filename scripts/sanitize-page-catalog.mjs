#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const research = join(root, 'docs', 'research')
const jsonPath = join(research, 'page-catalog.json')
const catalog = JSON.parse(readFileSync(jsonPath, 'utf8'))

catalog.source.path = 'R01'
catalog.set_structure = {
  pdf_page_1: 'cover',
  pdf_pages_2_58: 'R01-MAIN sheets 1-57',
  pdf_pages_59_61: 'R01-SPEC sheets 1-3',
}

const counters = new Map()
for (const page of catalog.pages) {
  counters.set(page.page_type, (counters.get(page.page_type) ?? 0) + 1)
  const part = counters.get(page.page_type)
  page.drawing_designation = page.drawing_designation?.endsWith('.С') ? 'R01-SPEC'
    : page.drawing_designation ? 'R01-MAIN' : null
  page.title = ({
    cover: 'Титульный лист рабочего комплекта',
    general_data: `Общие данные, часть ${part}`,
    plan: `План К2, участок ${part}. М1:500`,
    network_plan: 'Сводный план сетей К2. М1:500',
    longitudinal_profile: `Продольный профиль К2, участок ${part}`,
    material_schedule: `Ведомость материалов колодцев, часть ${part}`,
    detail: 'Параметрический узел защитной сетки для колодцев',
    specification: `Спецификация оборудования, изделий и материалов, часть ${part}`,
  })[page.page_type] ?? `Лист ${page.pdf_page}`
}

writeFileSync(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

const counts = Object.entries(catalog.pages.reduce((result, page) => {
  result[page.page_type] = (result[page.page_type] ?? 0) + 1
  return result
}, {}))
const reviewed = catalog.extraction_quality.visual_reviewed_pdf_pages.join(', ')
const rows = catalog.pages.map((page) => {
  const scale = page.scale
    ? Object.entries(page.scale).map(([key, value]) => `${key}: ${value}`).join(', ')
    : '—'
  return `| ${page.pdf_page} | ${page.drawing_designation ?? '—'} / ${page.drawing_sheet ?? '—'} | \`${page.page_type}\` | ${page.title} | ${page.display_size_mm.width} × ${page.display_size_mm.height} мм (${page.media_box.detected_format}) | ${scale} | ${page.text_layer} |`
}).join('\n')

const markdown = `# Постраничный каталог эталонного комплекта R01

Дата каталога: ${catalog.catalog_date}. SHA-256 и размер R01 сохранены в машинном каталоге для контроля версии. Путь, обозначение объекта, организация, адрес, подписи и фактические пикетажные значения намеренно не публикуются.

## Доказанный состав

- PDF программно содержит ${catalog.source.page_count} последовательную страницу.
- Структура: страница 1 — титул; страницы 2–58 — R01-MAIN, листы 1–57; страницы 59–61 — отдельная серия R01-SPEC, листы 1–3.
- Все страницы отображаются в альбомной ориентации; часть исходных MediaBox повёрнута на 270°.
- Текстовый слой доступен на страницах 33–52. Остальные заголовки получены из ведомости листов и выборочной визуальной проверки.
- Визуально проверены страницы: ${reviewed}.

| Тип | Количество |
| --- | ---: |
${counts.map(([type, count]) => `| \`${type}\` | ${count} |`).join('\n')}

## Ограничение доказательности

Каталог фиксирует наблюдаемую структуру R01, но не превращает R01 в источник входных значений. Пикетаж, геометрия, отметки, диаметры, объёмы и нормативные решения должны формироваться из P01–P06 и N01–N14. Пока такая цепочка не доказана, соответствующие поля имеют статус \`reference_observed_upstream_unresolved\`.

## Страницы

| PDF | Серия / лист | Тип | Нейтральное наименование | Отображаемый размер | Масштаб | Текстовый слой |
| ---: | --- | --- | --- | --- | --- | --- |
${rows}

## Вывод для генератора

- Три вводные PDF-страницы должны предшествовать рабочим листам.
- Основная серия после общих данных содержит 28 секционных планов, один сводный план сетей, 20 профилей, пять ведомостей материалов и один параметрический узел.
- Спецификация — отдельная серия с собственной нумерацией.
- Число листов для нового проекта вычисляется по исходным данным и компоновке; число 61 является проверочным контрактом R01, а не универсальной константой продукта.
- Планы и профили R01 в основном имеют вычисляемый нестандартный формат, поэтому принудительный A3 для всех страниц не соответствует наблюдаемой структуре.
`
writeFileSync(join(research, 'page-catalog.md'), markdown, 'utf8')

const traceRows = catalog.pages.map((page) => {
  const components = page.observed_components.join('; ')
  const inputs = page.expected_upstream_inputs.join('; ')
  return `| ${page.pdf_page} / ${page.drawing_designation ?? '—'} лист ${page.drawing_sheet ?? '—'} | **${page.title}**; ${components} | ${inputs} | ${page.title_source} | \`unknown\` | ${page.traceability_status}; ${page.unresolved.join('; ')} |`
}).join('\n')

const traceability = `# Матрица прослеживаемости страниц R01

Эта матрица разделяет наблюдаемое содержимое эталона и доказанные входы. Ни одна строка R01 не считается источником проектного значения. Нейтральные названия исключают раскрытие фактического пикетажа и реквизитов объекта.

| Страница / серия | Наблюдаемые элементы | Требуемые входы генератора | Основание наблюдения | Подтверждённый нормативный пункт | Статус и разрыв |
| --- | --- | --- | --- | --- | --- |
${traceRows}

## Условия перевода \`unknown\` в подтверждённый статус

1. Импортировать P04 без потери X/Y/Z, layer/object id и единиц.
2. Связать каждый объект плана с исходным объектом, а каждый пикет профиля — с координатой на оси.
3. Связать землю с поверхностью, геологию со скважиной/ИГЭ, лоток с расчётом и нормативной проверкой.
4. Для каждой строки ведомости и спецификации хранить породившие объекты, формулу, округление, каталог и нормативный пункт.
5. Проверять инварианты план ↔ профиль ↔ расчёт ↔ спецификация.
6. Использовать R01 только для итогового сравнения с маскированием подписей и печатей.
`
writeFileSync(join(research, 'page-traceability-matrix.md'), traceability, 'utf8')

console.log(`Sanitized ${catalog.pages.length} catalog pages and regenerated Markdown reports.`)
