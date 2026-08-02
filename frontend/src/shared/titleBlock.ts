/**
 * Основная надпись по форме 3 (ГОСТ Р 21.101-2020, приложение Ж).
 *
 * Форма 3 применяется «на листах основных комплектов рабочих чертежей и
 * листах графической части проектной документации» (п. 5.2, стр. 14). СН РК
 * 1.02-03-2022 форм основной надписи не содержит, поэтому ГОСТ используется
 * как методический образец — так же, как записано в реестре норм.
 *
 * Номера граф и их содержание — по стр. 43–44 стандарта:
 *   1 — обозначение документа
 *   2 — наименование объекта строительства
 *   3 — наименование здания (сооружения); при реконструкции — вид строительства
 *   4 — наименование изображений на листе; на общих данных — «Общие данные»
 *   6 — вид документации: П, Р или И
 *   7 — порядковый номер листа
 *   8 — общее количество листов (только на первом листе)
 *   9 — организация, разработавшая документ
 *   10 — характер работы, 11 — фамилия, 12 — подпись, 13 — дата
 *   14–19 — таблица изменений
 *
 * Ничего не выдумывается: графа, для которой проект не дал значения, остаётся
 * пустой. Подписи не воспроизводятся — их ставит человек.
 */

export type PdfNode = Record<string, unknown>

export interface TitleBlockSignatory {
  /** Графа 10: Разраб., Пров., Н.контр., ГИП. */
  role: string
  /** Графа 11. */
  name?: string
  /** Графа 13, обычно ММ.ГГ. */
  date?: string
}

export interface TitleBlockInput {
  /** Графа 1. */
  designation: string
  /** Графа 2. */
  objectName: string
  /** Графа 3. */
  buildingName?: string
  /** Графа 4. */
  sheetTitle: string
  /** Графа 6; по умолчанию «Р» — рабочая документация. */
  stage?: string
  /** Графа 7. */
  sheetNumber: number | string
  /** Графа 8; заполняется только на первом листе. */
  totalSheets?: number | string
  /** Графа 9. */
  organisation?: string
  /** Графы 10–13. */
  signatories?: TitleBlockSignatory[]
}

/** Ширины столбцов формы 3 в миллиметрах; в сумме 185 мм. */
const COLUMNS_MM = [10, 12, 15, 18, 15, 13, 60, 15, 12, 15]
const MM = 72 / 25.4

const DEFAULT_ROLES = ['Разраб.', 'Пров.', 'Н.контр.', 'ГИП']

const cell = (text: string, extra: PdfNode = {}): PdfNode => ({
  text, fontSize: 6, alignment: 'center', margin: [1, 1, 1, 1], ...extra,
})

/**
 * Собирает основную надпись как таблицу pdfmake. Возвращает узел, пригодный
 * и для footer, и для вставки в содержимое листа.
 */
export function buildTitleBlock(input: TitleBlockInput): PdfNode {
  const stage = input.stage ?? 'Р'
  // slice() копирует, поэтому дополнение пустыми строками не трогает массив
  // вызывающей стороны.
  const signatories: TitleBlockSignatory[] = (input.signatories && input.signatories.length > 0
    ? input.signatories
    : DEFAULT_ROLES.map((role): TitleBlockSignatory => ({ role }))).slice(0, 4)
  while (signatories.length < 4) signatories.push({ role: '' })

  const changeHeader = ['Изм.', 'Кол.уч.', 'Лист', '№ док.', 'Подп.', 'Дата']
    .map((label) => cell(label, { fontSize: 5 }))

  // Строка подписи: графы 10, 11, 12 (пустая — подпись ставит человек), 13.
  const signatureRow = (index: number, tail: PdfNode[]): PdfNode[] => {
    const person = signatories[index]
    return [
      cell(person.role, { colSpan: 2, alignment: 'left', bold: false }), {},
      cell(person.name ?? '', { colSpan: 2, alignment: 'left' }), {},
      cell(''),
      cell(person.date ?? ''),
      ...tail,
    ]
  }

  const body: PdfNode[][] = [
    [
      ...changeHeader,
      cell(input.designation, { colSpan: 4, rowSpan: 2, bold: true, fontSize: 8, margin: [2, 6, 2, 2] }),
      {}, {}, {},
    ],
    [...Array.from({ length: 6 }, () => cell('')), {}, {}, {}, {}],
    signatureRow(0, [
      // Графы 2, 3 и 4 занимают одно поле формы 3 и читаются сверху вниз:
      // объект строительства, здание (сооружение), наименование изображений.
      {
        rowSpan: 4,
        margin: [2, 2, 2, 1],
        stack: [
          { text: input.objectName, fontSize: 6, color: '#333' },
          ...(input.buildingName ? [{ text: input.buildingName, fontSize: 6, color: '#333' }] : []),
          { text: input.sheetTitle, fontSize: 7, bold: true, margin: [0, 1, 0, 0] },
        ],
      },
      cell('Стадия', { fontSize: 5 }),
      cell('Лист', { fontSize: 5 }),
      cell('Листов', { fontSize: 5 }),
    ]),
    signatureRow(1, [
      {},
      cell(stage, { bold: true, fontSize: 8 }),
      cell(String(input.sheetNumber), { bold: true, fontSize: 8 }),
      cell(input.totalSheets === undefined ? '' : String(input.totalSheets), { fontSize: 8 }),
    ]),
    signatureRow(2, [
      {},
      cell(input.organisation ?? '', { colSpan: 3, rowSpan: 2, fontSize: 7, margin: [2, 3, 2, 2] }),
      {}, {},
    ]),
    signatureRow(3, [{}, {}, {}, {}]),
  ]

  return {
    table: { widths: COLUMNS_MM.map((mm) => mm * MM), body, heights: 9 },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
        (i === 0 || i === node.table.body.length ? 0.9 : 0.5),
      vLineWidth: (i: number, node: { table: { widths: unknown[] } }) =>
        (i === 0 || i === node.table.widths.length ? 0.9 : 0.5),
      hLineColor: () => '#111',
      vLineColor: () => '#111',
      paddingLeft: () => 1,
      paddingRight: () => 1,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  }
}

/** Общая ширина основной надписи, мм — по ГОСТ она равна 185. */
export const TITLE_BLOCK_WIDTH_MM = COLUMNS_MM.reduce((sum, mm) => sum + mm, 0)
