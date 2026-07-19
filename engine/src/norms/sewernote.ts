import { NORM_DOCUMENTS } from '../normregistry'
import type { SpecItem } from '../specification'
import type { IgeDescription, GroundwaterRange } from '../geology'
import type { GravityNetworkResult } from './gravity'

/**
 * Explanatory note (пояснительная записка) for a gravity storm/sewer project
 * as a pdfmake docDefinition. Sections follow what the design task demands
 * from the working project: basis documents, survey geology, design flows,
 * the gravity hydraulic calculation, structures, environmental protection,
 * the АСУТП section (ТЗ п.6.2) and the landscaping/replanting statement
 * (ТЗ п.6.1, АПЗ) — the last two as explicit frameworks that cite their
 * source clause instead of invented content.
 */

export interface SewerNoteInput {
  projectName: string
  dateIso: string
  system: 'sewer' | 'storm'
  result: GravityNetworkResult
  spec: SpecItem[]
  /** ИГЭ descriptions parsed from the survey report prose, if available. */
  ige?: IgeDescription[]
  water?: GroundwaterRange | null
  /** Basis documents shown in section 1 (ТЗ, АПЗ, ПДП, акт выбора...). */
  basisDocuments?: string[]
  designStrategyNote?: string
}

function heading(text: string): unknown {
  return { text, style: 'h2', margin: [0, 10, 0, 4] }
}

export function buildSewerNoteDoc(input: SewerNoteInput): unknown {
  const mark = input.system === 'storm' ? 'К2' : 'К1'
  const pipes = [...input.result.pipes].sort((a, b) => b.flowLps - a.flowLps)
  const mainRows = pipes.slice(0, 40)

  const hydraulicBody: unknown[] = [
    ['Участок', 'Q, л/с', 'D, мм', 'Уклон', 'Наполнение', 'v, м/с'].map((t) => ({ text: t, bold: true })),
    ...mainRows.map((p) => [
      p.id,
      p.flowLps.toFixed(1),
      String(p.diameterMm),
      p.slope.toFixed(4),
      p.fillRatio.toFixed(2),
      p.velocityMs.toFixed(2),
    ]),
  ]

  const content: unknown[] = [
    { text: `Пояснительная записка. Наружные сети ${mark}`, style: 'h1' },
    { text: `Проект: ${input.projectName}`, margin: [0, 2, 0, 0] },
    { text: `Дата: ${input.dateIso.slice(0, 10)}`, margin: [0, 0, 0, 8] },

    heading('1. Основания для проектирования'),
    {
      ul: input.basisDocuments ?? ['Задание на проектирование (реквизиты — в проекте)'],
    },

    heading('2. Инженерно-геологические условия'),
    ...(input.ige && input.ige.length > 0
      ? [
          { text: 'Инженерно-геологические элементы по отчёту ИГИ:', margin: [0, 0, 0, 2] },
          {
            ul: input.ige.map((i) =>
              `ИГЭ ${i.code} — ${i.name}${i.openedFromM !== null ? `; вскрыт с ${i.openedFromM} м` : ''}${i.thicknessM !== null ? `; мощность до ${i.thicknessM} м` : ''}`,
            ),
          },
        ]
      : [{ text: 'Данные ИГИ загружаются из отчёта изысканий.', italics: true }]),
    ...(input.water
      ? [{ text: `Подземные воды вскрыты на глубине ${input.water.minDepthM}-${input.water.maxDepthM} м: высокий УГВ, предусмотрены гидроизоляция, водопонижение при производстве работ и защита от всплытия безнапорных труб.`, margin: [0, 4, 0, 0] }]
      : []),

    heading('3. Расчётные расходы'),
    { text: `Расчётный расход на выпуске: ${input.result.outletFlowLps.toFixed(1)} л/с.` },

    heading(`4. Гидравлический расчёт сети ${mark} (самотёчный режим)`),
    ...(input.designStrategyNote ? [{ text: input.designStrategyNote, italics: true, margin: [0, 0, 0, 4] }] : []),
    {
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body: hydraulicBody },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },

    heading('5. Сооружения на сети'),
    {
      ul: input.spec
        .filter((s) => !s.name.startsWith('Труба'))
        .map((s) => `${s.name} — ${s.quantity} ${s.unit}`),
    },

    heading('6. Охрана окружающей среды'),
    {
      text:
        'Раздел разрабатывается в соответствии с Экологическим кодексом РК и природоохранными требованиями задания на проектирование (инвентаризация и лесопатологическое обследование зелёных насаждений при необходимости).',
    },

    heading('7. Автоматизация и АСУТП'),
    {
      text:
        'КАРКАС РАЗДЕЛА (ТЗ п. 6.2): автоматизация и технологический контроль основных технических параметров выполняются по действующим нормам водоотведения с использованием современных средств и рекомендаций (АСУТП); автоматический режим насосной станции в период максимального дождя — за счёт устройства аварийного перелива, без перекачки максимальных расходов насосами (ТЗ п. 6.1). Состав средств АСУТП уточняется на следующей стадии.',
      italics: true,
    },

    heading('8. Восстановление благоустройства и пересадка насаждений'),
    {
      text:
        'КАРКАС РАЗДЕЛА (ТЗ п. 6.1; АПЗ п. 2-2 и обязательство 4): проектом предусматривается восстановление нарушенного благоустройства и компенсационная пересадка зелёных насаждений при их наличии по трассе прокладки; озеленение — по дендроплану в составе рабочего проекта; при сезонной посадке — гарантийное письмо с ведомостью насаждений. Ведомость восстановления заполняется по материалам обследования трассы.',
      italics: true,
    },

    heading('9. Перечень использованных нормативных документов'),
    {
      ul: NORM_DOCUMENTS.map((d) => `${d.code} — ${d.title}${d.status === 'unverified' ? ' (требует проверки)' : ''}`),
      fontSize: 8,
    },
  ]

  return {
    content,
    styles: {
      h1: { fontSize: 14, bold: true },
      h2: { fontSize: 11, bold: true },
    },
    defaultStyle: { fontSize: 9 },
  }
}
