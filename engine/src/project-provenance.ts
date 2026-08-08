import {
  absent,
  assumed,
  auditProvenance,
  derived,
  fromCatalogue,
  fromJustified,
  measured,
  traced,
  weakest,
  type Provenance,
  type ProvenanceAudit,
  type Traced,
} from './provenance'
import type { Justified } from './normregistry'

/**
 * Происхождение ключевых величин проекта.
 *
 * Модель `Traced<T>` существовала с тестами, но её никто не заполнял: ни одно
 * значение в проекте не несло происхождения. Здесь собираются те величины, на
 * которые опирается выпуск, — и сразу видно, что измерено, что взято из
 * задания, а что принято по умолчанию и потому выпуску мешает.
 *
 * Модуль ничего не считает заново: он переводит уже известные состояния в один
 * язык. Поэтому он и не может разойтись с шлюзами набора чертежей — он читает
 * те же поля.
 */

export interface ProjectProvenanceInput {
  /** Отметки съёмки и откуда они взяты. */
  surveyPointCount?: number
  surveyPointSource?: 'geometry' | 'elevation_labels' | 'none'
  /** Геопривязка: вид и источник. */
  georeference?: { kind: string; source?: string } | null
  /** Расчётная глубина промерзания. */
  freezingDepth?: { valueM?: number | null; status?: string; source?: string } | null
  /** Правило пространственного покрытия геологией. */
  geologyCoverage?: { maxOffsetM?: number | null; status?: string; source?: string } | null
  /** Скважины с координатами. */
  spatialBoreholeCount?: number
  /**
   * Проектный диаметр из технических условий, мм.
   *
   * Не передан вовсе — величина к системе не относится и в аудит не входит.
   * Так же ведёт себя расчёт дождевого стока: у водопровода нет ни проектного
   * диаметра из ТУ в этом смысле, ни каталога конструкций колодцев, и показать
   * их отсутствующими значило бы выставить проекту стоп-фактор за то, чего у
   * него по определению нет.
   */
  designDiameterMm?: number | null
  /** Требуемый просвет в пересечении из ТУ, м. */
  requiredClearanceM?: number | null
  /** Утверждённый состав проектного комплекта. */
  deliverables?: { source?: string; verified?: boolean } | null
  /** Каталог труб и материалов подтверждён. */
  catalogReady?: boolean
  /** Каталог конструкций колодцев покрывает ведомость. */
  manholeCatalogReady?: boolean
  /**
   * Все применённые нормативные правила подтверждены.
   *
   * Не передано — вызывающий не может судить о состоянии реестра, и величина в
   * аудит не входит. Подставить сюда `false` значило бы показать красную
   * строку, которая ни из чего не следует.
   */
  normsVerified?: boolean
  /** Расчёт дождевого стока для К2. */
  stormRunoff?: { available?: boolean; verified?: boolean; source?: string } | null
  /**
   * Нормативные величины, применённые в расчёте, как их отдаёт движок.
   *
   * `Justified` уже несёт ссылки на пункты реестра и основание, и переводит их
   * в общий язык происхождения `fromJustified`: нормативное основание даёт
   * подтверждённую величину, инженерное или экономическое — принятую. До этого
   * аудит о нормативных величинах расчёта не знал вовсе, хотя именно на них
   * держится половина решений.
   */
  normativeValues?: Array<{ label: string; value: Justified<unknown> }>
}

export interface ProjectProvenance extends ProvenanceAudit {
  fields: Record<string, Traced<unknown>>
  /**
   * Наименее достоверное происхождение среди всех полей — им и ограничен
   * проект. Сводка по разрядам показывала, сколько чего, но не отвечала на
   * главный вопрос: чем всё упирается.
   */
  limitedBy: Provenance | null
}

/** Переводит состояния исходных данных проекта в единый язык происхождения. */
export function auditProjectProvenance(input: ProjectProvenanceInput): ProjectProvenance {
  const fields: Record<string, Traced<unknown>> = {}

  const surveyCount = input.surveyPointCount ?? 0
  fields['Отметки съёмки'] = surveyCount === 0 || input.surveyPointSource === 'none'
    ? absent('топосъёмка не загружена')
    : measured(surveyCount, input.surveyPointSource === 'elevation_labels'
      ? `${surveyCount} отметок из подписей чертежа`
      : `${surveyCount} отметок из геометрии чертежа`)

  const georeference = input.georeference
  fields['Геопривязка'] = !georeference || georeference.kind === 'unreferenced'
    ? absent(georeference?.source ?? 'система координат не подтверждена')
    : derived(georeference.kind, georeference.source ?? georeference.kind, ['чертёж'])

  const frost = input.freezingDepth
  fields['Глубина промерзания'] = frost?.valueM == null || !Number.isFinite(frost.valueM)
    ? absent('расчётная глубина промерзания не задана')
    : frost.status === 'verified' && (frost.source ?? '').trim() !== ''
      ? traced(frost.valueM, { kind: 'normative', source: frost.source as string, verified: true })
      // Величина есть, но источник не подтверждён: к выпуску не пригодна.
      : assumed(frost.valueM, frost.source || 'источник не указан')

  const coverage = input.geologyCoverage
  fields['Допустимое удаление скважин'] = coverage?.maxOffsetM == null || !(coverage.maxOffsetM > 0)
    ? absent('правило покрытия геологией не задано')
    : coverage.status === 'verified' && (coverage.source ?? '').trim() !== ''
      ? traced(coverage.maxOffsetM, { kind: 'normative', source: coverage.source as string, verified: true })
      : assumed(coverage.maxOffsetM, coverage.source || 'источник не указан')

  const boreholes = input.spatialBoreholeCount ?? 0
  fields['Скважины с координатами'] = boreholes > 0
    ? measured(boreholes, `${boreholes} скважин изысканий`)
    : absent('скважин с координатами нет')

  if (input.designDiameterMm !== undefined) {
    fields['Проектный диаметр'] = input.designDiameterMm != null && input.designDiameterMm > 0
      ? traced(input.designDiameterMm, {
        kind: 'stated', source: 'технические условия', verified: true,
      })
      : absent('проектный диаметр не задан')
  }

  fields['Требуемый просвет в пересечении'] = input.requiredClearanceM != null && input.requiredClearanceM > 0
    ? traced(input.requiredClearanceM, {
      kind: 'stated', source: 'технические условия владельца сети', verified: true,
    })
    : absent('требуемый просвет не задан; отбор пересечений не выполняется')

  const deliverables = input.deliverables
  fields['Состав проектного комплекта'] = !deliverables || (deliverables.source ?? '').trim() === ''
    ? absent('состав комплекта не заявлен')
    : traced(deliverables.source as string, {
      kind: 'stated',
      source: deliverables.source as string,
      verified: deliverables.verified === true,
      note: deliverables.verified === true ? undefined : 'не подтверждён ответственным специалистом',
    })

  fields['Каталог труб и материалов'] = input.catalogReady
    ? fromCatalogue(true, 'активный каталог проекта')
    : absent('каталог не подтверждён')

  if (input.manholeCatalogReady !== undefined) {
    fields['Каталог конструкций колодцев'] = input.manholeCatalogReady
      ? fromCatalogue(true, 'каталог конструкций проекта')
      : absent('каталог конструкций не покрывает ведомость')
  }

  if (input.normsVerified !== undefined) {
    fields['Нормативные пункты'] = input.normsVerified
      ? traced(true, { kind: 'normative', source: 'все применённые пункты подтверждены', verified: true })
      : assumed(false, 'есть неподтверждённые пункты')
  }

  if (input.stormRunoff !== undefined) {
    const runoff = input.stormRunoff
    fields['Расчёт дождевого стока'] = !runoff?.available
      ? absent('расчёт дождевого стока отсутствует')
      : traced(true, {
        kind: 'derived',
        source: runoff.source ?? 'расчёт по водосборам',
        derivedFrom: ['площади водосборов', 'параметры дождя'],
        // Не `derived(...)`: тот всегда подтверждает, а подтверждённость
        // расчёта стока зависит от того, принят ли метод инженером.
        verified: runoff.verified === true,
      })
  }

  for (const item of input.normativeValues ?? []) {
    fields[item.label] = fromJustified(item.value)
  }

  return {
    ...auditProvenance(fields),
    fields,
    limitedBy: weakest(Object.values(fields).map((field) => field.provenance)),
  }
}
