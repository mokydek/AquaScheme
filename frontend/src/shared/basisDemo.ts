export const SYNTHETIC_BASIS_NOTE =
  'Демо-комплект исходных данных сформирован и сохранён в проекте: 9 из 9 позиций. Это учебные файлы, созданные из синтетической модели; они позволяют проверить весь интерфейс, но не заменяют подписанные оригиналы и не разрешают финальный инженерный выпуск.'

export const SYNTHETIC_BASIS_ARTIFACTS = {
  assignment: {
    fileName: '01_Задание_на_проектирование_демо.json',
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify({
      document: 'Задание на проектирование',
      project: 'Учебный проект ливневого коллектора',
      system: 'К2 — ливневая канализация',
      stage: 'РД (демо)',
      purpose: 'Проверка полного расчётного и оформительского конвейера AquaScheme',
      status: 'synthetic-demo-only',
    }, null, 2),
  },
  apz: {
    fileName: '02_АПЗ_демо.json',
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify({
      document: 'Архитектурно-планировочное задание',
      territory: 'Условная территория синтетического демо',
      requirements: ['Размещение в проверочном коридоре', 'Учёт красных линий', 'Согласование окончательной трассы'],
      status: 'synthetic-demo-only',
    }, null, 2),
  },
  pdp: {
    fileName: '03_ПДП_демо.geojson',
    mimeType: 'application/geo+json;charset=utf-8',
    content: JSON.stringify({
      type: 'FeatureCollection',
      name: 'Синтетический ПДП',
      features: [{
        type: 'Feature',
        properties: { kind: 'planning_boundary', status: 'synthetic-demo-only' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1800, 0], [1800, 900], [0, 900], [0, 0]]] },
      }],
    }, null, 2),
  },
  route_act: {
    fileName: '04_Акт_выбора_трассы_демо.json',
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify({
      document: 'Акт выбора трассы',
      decision: 'Учебный коридор принят только для демонстрационного расчёта',
      approvals: [],
      finalApprovalRequired: true,
      status: 'synthetic-demo-only',
    }, null, 2),
  },
  genplan_scheme: {
    fileName: '05_Схема_сетей_генплана_демо.geojson',
    mimeType: 'application/geo+json;charset=utf-8',
    content: JSON.stringify({
      type: 'FeatureCollection',
      name: 'Синтетическая ось К2',
      features: [{
        type: 'Feature',
        properties: { layer: 'K2_AXIS', status: 'synthetic-demo-only' },
        geometry: { type: 'LineString', coordinates: [[120, 760], [410, 690], [760, 520], [1080, 310], [1480, 120]] },
      }],
    }, null, 2),
  },
  topo: {
    fileName: '06_Топографическая_съёмка_демо.csv',
    mimeType: 'text/csv;charset=utf-8',
    content: [
      'x,y,z,source',
      '120,760,347.80,synthetic-demo',
      '410,690,347.15,synthetic-demo',
      '760,520,346.30,synthetic-demo',
      '1080,310,345.55,synthetic-demo',
      '1480,120,344.70,synthetic-demo',
    ].join('\n'),
  },
  geology: {
    fileName: '07_Инженерная_геология_демо.csv',
    mimeType: 'text/csv;charset=utf-8',
    content: [
      'borehole,x,y,mouth_elevation_m,water_depth_m,ige,soil,status',
      'BH-01,180,730,347.70,3.5,D1,Суглинок,synthetic-demo-only',
      'BH-02,770,500,346.20,3.5,D2,Песок,synthetic-demo-only',
      'BH-03,1400,150,344.90,3.5,D2,Песок,synthetic-demo-only',
    ].join('\n'),
  },
  vertical: {
    fileName: '08_Вертикальная_планировка_демо.csv',
    mimeType: 'text/csv;charset=utf-8',
    content: [
      'station_m,existing_ground_m,proposed_ground_m,status',
      '0,347.80,347.80,synthetic-demo-only',
      '500,347.05,347.00,synthetic-demo-only',
      '1000,346.10,346.05,synthetic-demo-only',
      '1500,345.35,345.30,synthetic-demo-only',
      '2000,344.70,344.70,synthetic-demo-only',
    ].join('\n'),
  },
  tu: {
    fileName: '09_Технические_условия_демо.json',
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify({
      document: 'Технические условия',
      connectionPoint: 'Учебный выпуск',
      restrictions: ['Финальный выпуск заблокирован до загрузки подписанных ТУ', 'Отметка и допустимый расход требуют подтверждения владельца сети'],
      status: 'synthetic-demo-only',
    }, null, 2),
  },
} as const

export type SyntheticBasisItemId = keyof typeof SYNTHETIC_BASIS_ARTIFACTS

export const SYNTHETIC_BASIS_FILES: Record<SyntheticBasisItemId, string> = Object.fromEntries(
  Object.entries(SYNTHETIC_BASIS_ARTIFACTS).map(([itemId, artifact]) => [itemId, artifact.fileName]),
) as Record<SyntheticBasisItemId, string>

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Refreshes the complete persistent demo input pack without overwriting files uploaded by the owner. */
export function mergeSyntheticBasisContent(existingContent: unknown): JsonObject & { files: JsonObject } {
  return mergeSyntheticBasisContents([existingContent])
}

/**
 * Merges legacy duplicate rows ordered newest first. The newest row remains
 * canonical for every field except `files`; older rows only fill file keys
 * that are absent from newer rows. Real uploaded names win over demo defaults.
 */
export function mergeSyntheticBasisContents(existingContents: readonly unknown[]): JsonObject & { files: JsonObject } {
  const newest = isObject(existingContents[0]) ? existingContents[0] : {}
  let uploadedFiles: JsonObject = {}
  const existingReferences: string[] = []
  for (let index = existingContents.length - 1; index >= 0; index -= 1) {
    const candidate = existingContents[index]
    const content = isObject(candidate) ? candidate : {}
    if (isObject(content.files)) uploadedFiles = { ...uploadedFiles, ...content.files }
    existingReferences.push(...stringArray(content.referenceFiles))
  }
  return {
    ...newest,
    files: { ...SYNTHETIC_BASIS_FILES, ...uploadedFiles },
    // Preserve owner-managed private references, but never embed real-object
    // names or binaries into the public application bundle.
    referenceFiles: [...new Set(existingReferences)],
    mode: 'synthetic',
    note: SYNTHETIC_BASIS_NOTE,
  }
}

export function syntheticBasisArtifact(itemId: string, fileName: string | undefined) {
  if (!(itemId in SYNTHETIC_BASIS_ARTIFACTS)) return null
  const typedId = itemId as SyntheticBasisItemId
  const artifact = SYNTHETIC_BASIS_ARTIFACTS[typedId]
  return artifact.fileName === fileName ? artifact : null
}
