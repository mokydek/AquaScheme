import type { ExportInput } from '../exportdata'
import { materialLabel } from '../exportdata'
import { getClause } from '../normregistry'

/**
 * Project documents transcribed VERBATIM from the official PDFs (НБ2):
 *   - acceptance / test / disinfection / input-control act forms
 *     (СП РК 4.01-103-2013, приложения А, В, Г, Е, Ж, страницы PDF 111..124);
 *   - the design task, TEP list and project passport form Ф-2
 *     (СН РК 1.02-03-2022, приложения Б/В/Г/Д, страницы PDF 107..119).
 *
 * The normative text is reproduced as-is (blanks kept as "____"); the generator
 * only prepends a small "заполнено из проекта" header and, for pipe test acts,
 * a reference table of segments drawn from the project. Nothing normative is
 * invented or paraphrased. The engine stays free of pdfmake; these builders
 * return plain objects compatible with pdfmake TDocumentDefinitions.
 */

export type FormDoc = Record<string, unknown>

/** A transcribed line: plain text, or a caption (the italic "(...)" hints). */
type Line = { t: string } | { c: string }

export interface ActForm {
  id: string
  appendix: string
  mandatory: boolean
  /** norm_clause id backing this form. */
  clauseId: string
  pdfPage: number
  title: string[]
  lines: Line[]
  /** For pipe pressure/leak tests, append a reference table of segments. */
  segmentTable?: boolean
}

const SIGNATURES_STANDARD: Line[] = [
  { t: 'РЕШЕНИЕ КОМИССИИ' },
  { t: 'Представитель строительно-монтажной организации' },
  { c: '(подпись)' },
  { t: 'Представитель технического надзора заказчика' },
  { c: '(подпись)' },
  { t: 'Представитель эксплуатационной организации' },
  { c: '(подпись)' },
]

/**
 * Five obligatory act forms from СП РК 4.01-103-2013 (приложения А, В, Г, Е, Ж).
 * Text transcribed from docs/norms/sp-rk-4-01-103-2013-naruzhnye-seti-vik.pdf.
 */
export const ACT_FORMS: ActForm[] = [
  {
    id: 'pressureHydraulicNapor',
    appendix: 'А',
    mandatory: true,
    clauseId: 'act.pressureTest',
    pdfPage: 111,
    title: [
      'ФОРМА АКТА',
      'О ПРОВЕДЕНИИ ПРИЕМОЧНОГО ГИДРАВЛИЧЕСКОГО ИСПЫТАНИЯ',
      'НАПОРНОГО ТРУБОПРОВОДА НА ПРОЧНОСТЬ И ГЕРМЕТИЧНОСТЬ',
    ],
    segmentTable: true,
    lines: [
      { t: 'Город __________________  «___» _____________ 20___ г.' },
      { t: 'Комиссия в составе представителей: строительно-монтажной организации' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      { t: 'технического надзора заказчика ___________________' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      { t: 'эксплуатационной организации _______' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      {
        t: 'составили настоящий акт о проведении приемочного гидравлического испытания на прочность и герметичность участка напорного трубопровода',
      },
      {
        c: '(наименование объекта и номера пикетов на его границах, длина трубопровода, диаметр, материал труб и стыковых соединений)',
      },
      {
        t: 'Указанные в рабочей документации величины расчетного внутреннего давления испытываемого трубопровода Рр = _____ МПа (_____ кгс/см2) и испытательного давления Ри = _____ МПа (_____ кгс/см2).',
      },
      {
        t: 'Измерение давления при испытании производилось техническим манометром класса точности ___ с верхним пределом измерений ___ кгс/см2. Цена деления шкалы манометра _____ кгс/см2.',
      },
      { t: 'Манометр был расположен выше оси трубопровода на Z = ______ м.' },
      {
        t: 'Допустимый расход подкаченной воды, определенный по Таблице 10, на 1 км трубопровода, равен ________ л/мин или, в пересчете на длину испытываемого трубопровода, равен ______ л/мин.',
      },
      {
        t: 'Трубопровод признается выдержавшим приемочное испытание на прочность и герметичность.',
      },
      ...SIGNATURES_STANDARD,
    ],
  },
  {
    id: 'pneumaticNapor',
    appendix: 'В',
    mandatory: true,
    clauseId: 'act.pressureTest',
    pdfPage: 115,
    title: [
      'ФОРМА АКТА',
      'О ПРОВЕДЕНИИ ПНЕВМАТИЧЕСКОГО ИСПЫТАНИЯ',
      'НАПОРНОГО ТРУБОПРОВОДА НА ПРОЧНОСТЬ И ГЕРМЕТИЧНОСТЬ',
    ],
    segmentTable: true,
    lines: [
      { t: 'Город __________________  «___» _____________ 20___ г.' },
      { t: 'Комиссия в составе представителей: строительно-монтажной организации' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      { t: 'технического надзора заказчика ___________________' },
      { t: 'эксплуатационной организации ____________________' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      {
        t: 'составили настоящий акт о проведении пневматического испытания на прочность и герметичность участка напорного трубопровода ________________',
      },
      { c: '(наименование объекта и номера пикетов на его границах)' },
      { t: 'Длина трубопровода _______ м, материал труб ___________, диаметр труб _______ мм, материал стыков _______.' },
      { t: 'Величина внутреннего расчетного давления в трубопроводе Рр равна _________ МПа (______ кгс/см2).' },
      {
        t: 'Для испытания на прочность давление в трубопроводе было повышено до ________ МПа (______ кгс/см2) и поддерживалось в течение 30 мин. Нарушений целостности трубопровода не обнаружено.',
      },
      {
        t: 'Фактическая величина снижения давления в трубопроводе менее допустимой Таблицей 10 величины падения давления (y = 1 для воды и y = 0,87 для керосина).',
      },
      { t: 'Трубопровод признается выдержавшим пневматическое испытание на прочность и герметичность.' },
      ...SIGNATURES_STANDARD,
    ],
  },
  {
    id: 'hydraulicBeznapor',
    appendix: 'Г',
    mandatory: true,
    clauseId: 'act.pressureTest',
    pdfPage: 117,
    title: [
      'ФОРМА АКТА',
      'О ПРОВЕДЕНИИ ПРИЕМОЧНОГО ГИДРАВЛИЧЕСКОГО ИСПЫТАНИЯ',
      'БЕЗНАПОРНОГО ТРУБОПРОВОДА НА ГЕРМЕТИЧНОСТЬ',
    ],
    segmentTable: true,
    lines: [
      { t: 'Город __________________  «___» _____________ 20___ г.' },
      { t: 'Комиссия в составе представителей: строительно-монтажной организации ___________________________' },
      { t: 'технического надзора заказчика _________________________________' },
      { t: 'эксплуатационной организации ____________________________________' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      {
        t: 'составили настоящий акт о проведении приемочного гидравлического испытания участка безнапорного трубопровода ______________________',
      },
      { c: '(наименование объекта, номера пикетов на его границах, длина и диаметр)' },
      {
        t: 'Уровень грунтовых вод в месте расположения верхнего колодца находится на расстоянии ________ м от верха трубы в нем при глубине заложения труб (до верха) ________ м.',
      },
      {
        t: 'Гидростатическое давление величиной ______ м вод. ст. создавалось заполнением водой ___________.',
      },
      {
        t: 'Допустимый объем добавленной в трубопровод воды (приток грунтовой воды) на 10 м длины трубопровода за время испытания 30 мин равен ________ л. Фактический за время испытания объем составил ________ л, что меньше допустимого расхода.',
      },
      { t: 'Трубопровод признается выдержавшим приемочное гидравлическое испытание на герметичность.' },
      ...SIGNATURES_STANDARD,
    ],
  },
  {
    id: 'disinfection',
    appendix: 'Е',
    mandatory: true,
    clauseId: 'act.disinfection',
    pdfPage: 122,
    title: [
      'ФОРМА АКТА',
      'О ПРОВЕДЕНИИ ПРОМЫВКИ И ДЕЗИНФЕКЦИИ',
      'ТРУБОПРОВОДОВ (СООРУЖЕНИЙ) ХОЗЯЙСТВЕННО-ПИТЬЕВОГО ВОДОСНАБЖЕНИЯ',
    ],
    lines: [
      { t: 'Город __________________  «___» _____________ 20___ г.' },
      { t: 'Комиссия в составе представителей:' },
      { t: 'санитарно-эпидемиологической службы (СЭС) _______________' },
      { t: 'заказчика _______________' },
      { t: 'строительно-монтажной организации _______________' },
      { t: 'эксплуатационной организации _______________' },
      { c: '(наименование организации, должность, фамилия, и.о.)' },
      { t: 'составили настоящий акт о том, что трубопровод (сооружение) ___________________' },
      { c: '(наименование объекта, длина, диаметр, объем)' },
      {
        t: 'подвергнут промывке и дезинфекции хлорированием при концентрации активного хлора ___ мг/л (г/м3) и продолжительности контакта ____ ч.',
      },
      { t: 'Результаты физико-химического и бактериологического анализов воды на ___ листах прилагаются.' },
      { t: 'Представитель санитарно-эпидемиологической службы (СЭС) _______________' },
      { t: 'Представитель заказчика _______________' },
      { t: 'Представитель строительно-монтажной организации _______________' },
      { t: 'Представитель эксплуатационной организации _______________' },
      { c: '(подпись)' },
      {
        t: 'Заключение СЭС: трубопровод (сооружение) считать продезинфицированным и промытым и разрешить пуск его в эксплуатацию.',
      },
      { t: 'Главный врач СЭС: «___» ____________  ____________________' },
      { c: '(дата)  (фамилия, и.о., подпись)' },
    ],
  },
  {
    id: 'inputControl',
    appendix: 'Ж',
    mandatory: true,
    clauseId: 'act.inputControl',
    pdfPage: 124,
    title: ['ФОРМА АКТА', 'О ПРОВЕДЕНИИ ВХОДНОГО КОНТРОЛЯ ПАРТИИ ТРУБ', '(СОЕДИНИТЕЛЬНЫХ ДЕТАЛЕЙ)'],
    lines: [
      { t: 'полученных ________________________________________________________' },
      { c: '(наименование организации получателя)' },
      { t: 'Трубы (соединительные детали) получены для систем ____________________ давлением __________ МПа.' },
      { c: '(водопровод, канализация и др.)' },
      { t: 'Мы, нижеподписавшиеся, комиссия в составе представителей:' },
      { c: '(организация заказчика / подрядчика / эксплуатирующая, должность, Ф.И.О.)' },
      {
        t: 'провели входной контроль партии труб (соединительных деталей) № ___________ диаметром _______ мм, длиной _______ м (шт.), поставленных _________________',
      },
      { c: '(наименование фирмы, дата)' },
      { t: 'из полимера типа ________________________________________________________' },
      { t: 'Партия состоит из _______ шт. (бухт, барабанов, ящиков соединительных деталей) и соответствует ___________________' },
      { c: '(действующая нормативно-техническая документация)' },
      { t: 'Количество труб Ду __________ мм, длиной ___________ м __________________' },
      { t: 'Количество деталей Ду _______ мм _______ шт. ______________________________' },
      { c: '(маркировка по стандарту)' },
      { t: 'Данные о сопроводительном сертификате ___________________________________' },
      {
        t: 'Результат: партия труб (соединительных деталей) соответствует (не соответствует) стандартам РК и сопроводительным сертификатам и может (не может) быть допущена к монтажу.',
      },
      { t: 'Дата ____________  Подписи: от заказчика _________ от подрядчика _________ от эксплуатирующей организации _________' },
    ],
  },
]

/**
 * Design task point list, СН РК 1.02-03-2022 приложение Б (объекты
 * производственного назначения; наружные инженерные сети — линейные
 * инженерные сооружения, раздел 9.4). Text from PDF page 107.
 */
export const DESIGN_TASK_POINTS: string[] = [
  'Основание для проектирования.',
  'Вид строительства.',
  'Стадийность проектирования.',
  'Требования по вариантной и конкурсной разработке.',
  'Особые условия строительства.',
  'Основные технико-экономические показатели объекта, в том числе мощность, производительность, производственная программа.',
  'Основные требования к инженерному оборудованию.',
  'Требования к качеству, конкурентоспособности и экологическим параметрам продукции.',
  'Требования к технологии, режиму предприятия.',
  'Требования к архитектурно-строительным, объемно-планировочным и конструктивным решениям с учетом создания доступной для лиц с инвалидностью среды жизнедеятельности.',
  'Требования и объем разработки организации строительства.',
  'Выделение очередей, в том числе пусковых комплексов и этапов, требования по перспективному расширению.',
  'Требования и условия в разработке природоохранных мер и мероприятий.',
  'Требования к режиму безопасности и гигиене труда.',
  'Требования по разработке инженерно-технических мероприятий гражданской обороны.',
  'Требования по выполнению опытно-конструкторских и научно-исследовательских работ.',
  'Требования по энергосбережению.',
  'Состав демонстрационных материалов.',
  'Требования по применению строительных материалов, изделий, конструкций и оборудования казахстанского производства для объектов, финансируемых за счет государственных инвестиций и средств квазигосударственного сектора.',
]

/**
 * TEP rows for engineering structures (инженерные сооружения), СН РК 1.02-03-2022
 * приложение Г, страница PDF 111 (производственный перечень + примечание 2 об
 * инженерных сооружениях: производительность, протяженность трассы, общая длина
 * трубопроводов).
 */
export interface TepRow {
  name: string
  unit: string
  /** Filled from the project when available; blank otherwise. */
  key?: 'productivity' | 'routeLength' | 'diameters' | 'duration'
}

export const TEP_ROWS: TepRow[] = [
  { name: 'Производительность (пропускная способность)', unit: 'м3/сут', key: 'productivity' },
  { name: 'Протяженность трассы (общая длина трубопроводов)', unit: 'м', key: 'routeLength' },
  { name: 'Диаметры труб (основной трассы)', unit: 'мм', key: 'diameters' },
  { name: 'Общая площадь выделенной территории', unit: 'га' },
  { name: 'Общая сметная стоимость строительства в текущих ценах, в том числе СМР', unit: 'млн тенге' },
  { name: 'Продолжительность строительства', unit: 'месяцев', key: 'duration' },
]

const WORK_TYPE_LABEL: Record<string, string> = {
  new: 'новое строительство',
  reconstruction: 'реконструкция',
}

const SYSTEM_LABEL: Record<string, string> = {
  water: 'сети водоснабжения',
  sewer: 'сети водоотведения (канализации)',
  storm: 'сети дождевой канализации',
}

/** Total pipe length and the set of main/ring nominal diameters, from sizing. */
function networkFacts(input: ExportInput): { totalLengthM: number; diameters: number[]; productivityM3d: number } {
  const pipes = input.sizing.pipes
  const totalLengthM = pipes.reduce((s, p) => s + p.lengthM, 0)
  const mains = pipes.filter((p) => p.kind === 'main' || p.kind === 'ring' || p.kind === 'supply' || p.kind === 'cross')
  const diameters = [...new Set((mains.length ? mains : pipes).map((p) => p.nominalMm))].sort((a, b) => a - b)
  return { totalLengthM, diameters, productivityM3d: input.demand.maxDailyM3 }
}

function tepValue(row: TepRow, facts: ReturnType<typeof networkFacts>): string {
  switch (row.key) {
    case 'productivity':
      return facts.productivityM3d.toFixed(1)
    case 'routeLength':
      return facts.totalLengthM.toFixed(0)
    case 'diameters':
      return facts.diameters.join(', ')
    default:
      return ''
  }
}

// ---- pdfmake helpers (mirror note.ts styling) ----

function h1(text: string): Record<string, unknown> {
  return { text, style: 'h1', margin: [0, 0, 0, 4] }
}

function h2(text: string): Record<string, unknown> {
  return { text, style: 'h2', margin: [0, 14, 0, 6] }
}

function sourceLine(clauseId: string): Record<string, unknown> {
  const c = getClause(clauseId)
  const ref = c
    ? `${c.documentCode}${c.clause ? `, ${c.clause}` : ''}${c.status === 'unverified' ? ' (требует проверки)' : ''}`
    : clauseId
  return { text: `Источник формы: ${ref}`, fontSize: 8, italics: true, color: '#555555', margin: [0, 2, 0, 8] }
}

function renderLines(lines: Line[]): unknown[] {
  return lines.map((ln) =>
    'c' in ln
      ? { text: ln.c, fontSize: 8, italics: true, color: '#777777', margin: [0, 0, 0, 4] }
      : { text: ln.t, margin: [0, 0, 0, 4] },
  )
}

function projectHeader(input: ExportInput): Record<string, unknown> {
  return {
    table: {
      widths: ['auto', '*'],
      body: [
        [{ text: 'Заполнено из проекта', color: '#555555' }, { text: input.projectName, bold: true }],
        [
          { text: 'Объект', color: '#555555' },
          { text: `${SYSTEM_LABEL[input.systemType ?? 'water']}; ${WORK_TYPE_LABEL[input.workType ?? 'new']}` },
        ],
        [{ text: 'Дата', color: '#555555' }, { text: input.dateIso.slice(0, 10) }],
      ],
    },
    layout: 'lightHorizontalLines',
    fontSize: 9,
    margin: [0, 0, 0, 8],
  }
}

function segmentTable(input: ExportInput): Record<string, unknown> {
  const facts = networkFacts(input)
  const body: unknown[] = [
    ['Показатель', 'Значение'].map((t) => ({ text: t, bold: true })),
    ['Материал труб', materialLabel(input)],
    ['Диаметры основной трассы, мм', facts.diameters.join(', ')],
    ['Общая длина трубопроводов, м', facts.totalLengthM.toFixed(0)],
  ]
  return {
    stack: [
      { text: 'Справочные данные из проекта (для заполнения полей формы):', fontSize: 9, margin: [0, 4, 0, 2] },
      { table: { widths: ['*', 'auto'], body }, layout: 'lightHorizontalLines', fontSize: 9, margin: [0, 0, 0, 6] },
    ],
  }
}

const PDF_BASE = {
  pageSize: 'A4',
  pageMargins: [40, 40, 40, 40] as [number, number, number, number],
  styles: { h1: { fontSize: 16, bold: true }, h2: { fontSize: 12, bold: true } },
  defaultStyle: { fontSize: 10, lineHeight: 1.2 },
}

function footer(currentPage: number, pageCount: number): Record<string, unknown> {
  return {
    text: `${currentPage} / ${pageCount}`,
    alignment: 'center',
    fontSize: 8,
    color: '#8a8a8a',
    margin: [0, 8, 0, 0],
  }
}

/** All five act forms as one PDF, headers auto-filled from the project. */
export function buildActFormsDoc(input: ExportInput): FormDoc {
  const content: unknown[] = [
    h1('Формы актов испытаний и приемки'),
    {
      text: 'Формы приведены дословно по СП РК 4.01-103-2013 (приложения А, В, Г, Е, Ж). Пустые поля заполняет комиссия при испытаниях и приемке.',
      italics: true,
      color: '#555555',
      margin: [0, 2, 0, 8],
    },
    projectHeader(input),
  ]
  for (const form of ACT_FORMS) {
    content.push(h2(`Приложение ${form.appendix}${form.mandatory ? ' (обязательное)' : ''}`))
    for (const t of form.title) content.push({ text: t, bold: true, alignment: 'center', margin: [0, 0, 0, 2] })
    content.push(sourceLine(form.clauseId))
    if (form.segmentTable) content.push(segmentTable(input))
    content.push(...renderLines(form.lines))
  }
  return { ...PDF_BASE, content, footer }
}

/**
 * The project documents (ПСД) as one PDF: design task (приложение Б),
 * TEP list (приложение Г) and project passport form Ф-2 (приложение Д),
 * СН РК 1.02-03-2022. Auto-filled from the project where the norm allows.
 */
export function buildProjectDocsDoc(input: ExportInput): FormDoc {
  const facts = networkFacts(input)
  const work = WORK_TYPE_LABEL[input.workType ?? 'new']
  const system = SYSTEM_LABEL[input.systemType ?? 'water']

  const taskBody: unknown[] = [
    ['№', 'Перечень основных данных и требований', 'Данные проекта'].map((t) => ({ text: t, bold: true })),
  ]
  DESIGN_TASK_POINTS.forEach((point, i) => {
    let filled = ''
    if (i === 1) filled = work // Вид строительства
    if (i === 5) filled = `производительность ${facts.productivityM3d.toFixed(1)} м3/сут; протяженность ${facts.totalLengthM.toFixed(0)} м`
    taskBody.push([{ text: String(i + 1) }, { text: point }, { text: filled, italics: !!filled, color: '#333333' }])
  })

  const tepBody: unknown[] = [
    ['№', 'Наименование показателя', 'Ед. изм.', 'Значение'].map((t) => ({ text: t, bold: true })),
  ]
  TEP_ROWS.forEach((row, i) => {
    tepBody.push([String(i + 1), row.name, row.unit, tepValue(row, facts)])
  })

  const passportBody: unknown[] = [
    ['Реквизит', 'Значение'].map((t) => ({ text: t, bold: true })),
    ['Заказчик', ''],
    ['Наименование проекта', input.projectName],
    ['Разработчик (генпроектировщик)', ''],
    ['Источник финансирования', ''],
    ['Место расположения', ''],
    ['Производительность (пропускная способность), м3/сут', facts.productivityM3d.toFixed(1)],
    ['Протяженность трассы (общая длина трубопроводов), м', facts.totalLengthM.toFixed(0)],
    ['Диаметры труб основной трассы, мм', facts.diameters.join(', ')],
    ['Количество подключаемых населенных пунктов', ''],
    ['Общая сметная стоимость строительства', ''],
    ['Продолжительность строительства', ''],
  ]

  const content: unknown[] = [
    h1('Проектные документы'),
    { text: `Проект: ${input.projectName}. Объект: ${system}; ${work}.`, margin: [0, 2, 0, 8] },

    h2('Задание на проектирование'),
    sourceLine('psd.designTask'),
    {
      text: 'Задание составляет заказчик (СН РК 1.02-03-2022, раздел 5). Ниже приведен перечень основных данных и требований; графа «Данные проекта» заполнена там, где значения известны из модели.',
      fontSize: 9,
      italics: true,
      color: '#555555',
      margin: [0, 0, 0, 6],
    },
    {
      table: { headerRows: 1, widths: ['auto', '*', 'auto'], body: taskBody },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },

    h2('Технико-экономические показатели (ТЭП)'),
    sourceLine('psd.tep'),
    {
      table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto'], body: tepBody },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    },

    h2('Паспорт проекта. Форма Ф-2 (инженерные сети и системы)'),
    sourceLine('psd.passport'),
    {
      text: 'Паспорт проекта является обязательной частью проекта; объем не более 2 страниц формата А4 (СН РК 1.02-03-2022, приложение Д).',
      fontSize: 9,
      italics: true,
      color: '#555555',
      margin: [0, 0, 0, 6],
    },
    {
      table: { widths: ['*', 'auto'], body: passportBody },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    },
    {
      text: 'Окончательные значения стоимости, сроков и организационных реквизитов вносит проектная организация; система заполняет только технические показатели, вычисленные по модели.',
      fontSize: 8,
      italics: true,
      color: '#555555',
      margin: [0, 10, 0, 0],
    },
  ]
  return { ...PDF_BASE, content, footer }
}
