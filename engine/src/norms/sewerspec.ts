import type { SpecItem } from '../specification'
import { AGSK_SECTIONS } from './agsk'
import type { RoadCrossing } from './structures'
import { protectiveGrilles } from './structures'
import type { SewerSchedule } from './gravity'

/**
 * Specification (ГОСТ 21.110, НК.С) for a gravity sewer/storm collector:
 * pipes by diameter from the schedule plus the structures the design task
 * demands — casings on road crossings, protective anti-corrosion grilles in
 * every inspection manhole, the lift pumping station, and the high
 * groundwater set (coating waterproofing of pipes, penetrating waterproofing
 * of manholes). Codes are АГСК-3 SECTION codes (the exact 7-digit position
 * codes are looked up by the engineer — never invented here).
 */
export interface SewerSpecInput {
  schedule: SewerSchedule
  /** Road crossings; each produces a steel casing position. */
  crossings?: RoadCrossing[]
  /** A lift pumping station is present in the scheme. */
  liftStation?: boolean
  /** High groundwater: waterproofing positions are added. */
  highGroundwater?: boolean
  /** Pipe material label; defaults to reinforced concrete non-pressure. */
  pipeMaterialLabel?: string
}

export function buildSewerSpecification(input: SewerSpecInput): SpecItem[] {
  const items: SpecItem[] = []
  let pos = 0
  const push = (item: Omit<SpecItem, 'pos'>) => {
    pos++
    items.push({ pos, ...item })
  }

  const material = input.pipeMaterialLabel ?? 'железобетонная безнапорная'
  for (const pipe of [...input.schedule.pipes].sort((a, b) => a.diameterMm - b.diameterMm)) {
    push({
      name: `Труба ${material}`,
      spec: `Ду${pipe.diameterMm}`,
      unit: 'м',
      quantity: Math.ceil(pipe.lengthM),
      code: pipe.agskCode,
    })
  }

  const manholes = input.schedule.manholes.length
  if (manholes > 0) {
    push({
      name: 'Колодец канализационный сборный ж/б',
      spec: 'по типовому проекту',
      unit: 'шт',
      quantity: manholes,
      code: AGSK_SECTIONS.wells.code,
    })
    // ТЗ п.6.1: защитные решётки с антикоррозийным покрытием в каждом
    // смотровом колодце (запись реестра manhole.grille).
    push({
      name: 'Решётка защитная с антикоррозийным покрытием',
      spec: 'в смотровые колодцы',
      unit: 'шт',
      quantity: protectiveGrilles(manholes).value,
      code: AGSK_SECTIONS.drainageProducts.code,
    })
  }

  for (const crossing of input.crossings ?? []) {
    push({
      name: 'Футляр стальной на переходе',
      spec: crossing.roadId,
      unit: 'м',
      quantity: Math.ceil(crossing.casingLengthM.value),
      code: AGSK_SECTIONS.pipesSteel.code,
    })
  }

  if (input.liftStation) {
    push({
      name: 'Насосная станция подкачивающая (без надземной части, с аварийным переливом)',
      spec: 'по отдельному проекту',
      unit: 'компл',
      quantity: 1,
    })
  }

  if (input.highGroundwater) {
    // Мокрые грунты: наружная обмазочная гидроизоляция труб в 2 слоя и
    // проникающая гидроизоляция колодцев (реестр geology.dewatering; состав
    // мероприятий — как в общих указаниях профессиональных НК-альбомов).
    push({
      name: 'Гидроизоляция труб обмазочная битумная в 2 слоя',
      spec: 'наружная',
      unit: 'м',
      quantity: Math.ceil(input.schedule.totalPipeLengthM),
    })
    if (manholes > 0) {
      push({
        name: 'Гидроизоляция колодцев проникающая (днище, стены, швы)',
        spec: 'комплект на колодец',
        unit: 'компл',
        quantity: manholes,
      })
    }
  }

  return items
}
